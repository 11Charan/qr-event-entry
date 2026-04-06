import { AuditAction, AuditOutcome, PrismaClient, TicketStatus } from "@prisma/client";
import { createChecksum } from "../../utils/crypto";
import { getEventBySlug } from "../events/event-service";
import { writeAuditLog } from "../audit/audit-service";
import { ensureActiveQrForTicket } from "../tickets/qr-service";
import { RegistrationSource } from "./google-sheets-provider";

function parseTimestamp(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
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

    const rawData = JSON.stringify(row);
    const registrant = await prisma.registrant.upsert({
      where: {
        eventId_sheetRowRef: {
          eventId: event.id,
          sheetRowRef: `${row.rowNumber}`,
        },
      },
      update: {
        fullName: row.fullName,
        email: row.email.toLowerCase(),
        phone: row.phone,
        guestCategory: row.guestCategory,
        tags: row.tags,
        responseTimestamp: parseTimestamp(row.timestamp),
        syncChecksum: createChecksum(rawData),
        rawDataJson: rawData,
      },
      create: {
        eventId: event.id,
        sheetRowRef: `${row.rowNumber}`,
        sheetRowNumber: row.rowNumber,
        fullName: row.fullName,
        email: row.email.toLowerCase(),
        phone: row.phone,
        guestCategory: row.guestCategory,
        tags: row.tags,
        responseTimestamp: parseTimestamp(row.timestamp),
        syncChecksum: createChecksum(rawData),
        rawDataJson: rawData,
      },
    });

    const ticket = await prisma.ticket.upsert({
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

    await ensureActiveQrForTicket(prisma, ticket.id);

    processed += 1;
    await writeAuditLog(prisma, {
      action: AuditAction.REGISTRANT_SYNCED,
      outcome: AuditOutcome.SUCCESS,
      eventId: event.id,
      registrantId: registrant.id,
      message: "Registrant synced from Google Sheets",
      metadata: { rowNumber: row.rowNumber },
    });
  }

  const lastRowNumber = rows.length ? rows[rows.length - 1].rowNumber : syncState.lastSheetRowNumber;
  await prisma.syncState.update({
    where: { id: syncStateId },
    data: {
      lastSheetRowNumber: lastRowNumber,
      lastSyncedAt: new Date(),
    },
  });

  return { processed, skipped, lastRowNumber };
}
