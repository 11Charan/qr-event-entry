import { AuditAction, AuditOutcome, PrismaClient, TicketStatus } from "@prisma/client";
import { createChecksum } from "../../utils/crypto";
import { getEventBySlug } from "../events/event-service";
import { writeAuditLog } from "../audit/audit-service";
import { ensureActiveQrForTicket } from "../tickets/qr-service";
import { RegistrationSource } from "./google-sheets-provider";

type SyncRow = Awaited<ReturnType<RegistrationSource["listRows"]>>[number];

function parseTimestamp(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function buildRegistrantPayload(row: SyncRow) {
  const rawDataJson = JSON.stringify(row);
  return {
    fullName: row.fullName!,
    email: row.email!.toLowerCase(),
    phone: row.phone,
    guestCategory: row.guestCategory,
    tags: row.tags,
    responseTimestamp: parseTimestamp(row.timestamp),
    syncChecksum: createChecksum(rawDataJson),
    rawDataJson,
  };
}

export async function syncRegistrantsFromSource(
  prisma: PrismaClient,
  source: RegistrationSource,
  eventSlug: string,
) {
  const event = await getEventBySlug(prisma, eventSlug);
  const syncStateId = `google-sheets:${event.id}`;
  const rows = await source.listRows();
  const syncState = await prisma.syncState.upsert({
    where: { id: syncStateId },
    update: {},
    create: { id: syncStateId, lastSheetRowNumber: 0 },
  });

  const newRows = rows.filter((row) => row.rowNumber > syncState.lastSheetRowNumber);
  let processed = 0;
  let skipped = 0;

  for (const row of newRows) {
    if (!row.fullName || !row.email) {
      skipped += 1;
      await writeAuditLog(prisma, {
        action: AuditAction.REGISTRANT_SYNCED,
        outcome: AuditOutcome.FAILURE,
        eventId: event.id,
        message: "Skipped invalid Google Sheets row",
        metadata: { rowNumber: row.rowNumber },
      });
      continue;
    }

    const registrantData = buildRegistrantPayload(row);

    await prisma.$transaction(async (tx) => {
      const registrant = await tx.registrant.upsert({
        where: {
          eventId_sheetRowRef: {
            eventId: event.id,
            sheetRowRef: `${row.rowNumber}`,
          },
        },
        update: registrantData,
        create: {
          eventId: event.id,
          sheetRowRef: `${row.rowNumber}`,
          sheetRowNumber: row.rowNumber,
          ...registrantData,
        },
      });

      const ticket = await tx.ticket.upsert({
        where: { registrantId: registrant.id },
        update: {
          ticketType: row.ticketType || "standard",
        },
        create: {
          eventId: event.id,
          registrantId: registrant.id,
          ticketType: row.ticketType || "standard",
          ticketStatus: TicketStatus.ACTIVE,
        },
      });

      await ensureActiveQrForTicket(tx as PrismaClient, ticket.id);

      await writeAuditLog(tx as PrismaClient, {
        action: AuditAction.REGISTRANT_SYNCED,
        outcome: AuditOutcome.SUCCESS,
        eventId: event.id,
        registrantId: registrant.id,
        message: "Registrant synced from Google Sheets",
        metadata: { rowNumber: row.rowNumber },
      });
    });

    processed += 1;
  }

  const lastRowNumber = rows.reduce(
    (currentMax, row) => Math.max(currentMax, row.rowNumber),
    syncState.lastSheetRowNumber,
  );
  await prisma.syncState.update({
    where: { id: syncStateId },
    data: {
      lastSheetRowNumber: lastRowNumber,
      lastSyncedAt: new Date(),
    },
  });

  return { processed, skipped, lastRowNumber };
}
