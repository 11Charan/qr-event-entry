import { AuditAction, AuditOutcome, Prisma, PrismaClient, QrStatus, TicketStatus, UserRole } from "@prisma/client";
import { AppError } from "../../utils/errors";
import { resolveQrPayload } from "../tickets/qr-service";
import { getEventBySlug } from "../events/event-service";
import { writeAuditLog } from "../audit/audit-service";

export type ScanOutcome = "valid" | "already_used" | "revoked" | "not_found" | "wrong_event" | "error";

export async function validateQrScan(
  prisma: PrismaClient,
  input: {
    qrPayload: string;
    eventSlug: string;
    scannerUserId?: string;
    scannerDeviceId?: string;
    ipAddress?: string;
  },
) {
  const event = await getEventBySlug(prisma, input.eventSlug);
  const qrToken = await resolveQrPayload(prisma, input.qrPayload);

  if (!qrToken) {
    await writeAuditLog(prisma, {
      action: AuditAction.SCAN_VALIDATION,
      outcome: AuditOutcome.FAILURE,
      eventId: event.id,
      userId: input.scannerUserId,
      message: "QR not found",
      ipAddress: input.ipAddress,
      metadata: { scannerDeviceId: input.scannerDeviceId },
    });
    return { status: "not_found" as ScanOutcome };
  }

  if (qrToken.ticket.eventId !== event.id) {
    return { status: "wrong_event" as ScanOutcome, ticketId: qrToken.ticketId };
  }

  if (qrToken.status !== QrStatus.ACTIVE || qrToken.ticket.ticketStatus !== TicketStatus.ACTIVE) {
    return { status: "revoked" as ScanOutcome, ticketId: qrToken.ticketId };
  }

  if (qrToken.ticket.checkedInAt && !qrToken.ticket.event.allowReentry) {
    return { status: "already_used" as ScanOutcome, ticketId: qrToken.ticketId };
  }

  return {
    status: "valid" as ScanOutcome,
    ticketId: qrToken.ticketId,
    qrTokenId: qrToken.id,
    registrant: {
      fullName: qrToken.ticket.registrant.fullName,
      email: qrToken.ticket.registrant.email,
      ticketType: qrToken.ticket.ticketType,
      guestCategory: qrToken.ticket.registrant.guestCategory,
      tags: qrToken.ticket.registrant.tags,
    },
  };
}

export async function checkInByQr(
  prisma: PrismaClient,
  input: {
    qrPayload: string;
    eventSlug: string;
    scannerUserId?: string;
    scannerDeviceId?: string;
    ipAddress?: string;
  },
) {
  const validation = await validateQrScan(prisma, input);
  if (validation.status !== "valid" || !validation.ticketId) {
    await writeAuditLog(prisma, {
      action: AuditAction.CHECKIN_REJECTED,
      outcome: validation.status === "already_used" ? AuditOutcome.INFO : AuditOutcome.FAILURE,
      userId: input.scannerUserId,
      message: "Check-in rejected",
      ipAddress: input.ipAddress,
      metadata: validation,
    });
    return validation;
  }

  const event = await getEventBySlug(prisma, input.eventSlug);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.updateMany({
      where: {
        id: validation.ticketId,
        eventId: event.id,
        checkedInAt: null,
        ticketStatus: TicketStatus.ACTIVE,
      },
      data: {
        checkedInAt: new Date(),
        checkedInByUserId: input.scannerUserId,
      },
    });

    if (updated.count === 0 && !event.allowReentry) {
      await writeAuditLog(tx as unknown as PrismaClient, {
        action: AuditAction.CHECKIN_DUPLICATE,
        outcome: AuditOutcome.INFO,
        eventId: event.id,
        ticketId: validation.ticketId,
        userId: input.scannerUserId,
        message: "Duplicate check-in attempt blocked",
        metadata: { scannerDeviceId: input.scannerDeviceId },
      });

      return { status: "already_used" as ScanOutcome, ticketId: validation.ticketId };
    }

    const checkin = await tx.checkIn.create({
      data: {
        ticketId: validation.ticketId,
        eventId: event.id,
        qrTokenId: validation.qrTokenId,
        scannedByUserId: input.scannerUserId,
        scannerDeviceId: input.scannerDeviceId,
        method: "qr",
        result: "success",
      },
    });

    await writeAuditLog(tx as unknown as PrismaClient, {
      action: AuditAction.CHECKIN_SUCCESS,
      outcome: AuditOutcome.SUCCESS,
      eventId: event.id,
      ticketId: validation.ticketId,
      userId: input.scannerUserId,
      message: "Check-in succeeded",
      metadata: { checkinId: checkin.id, scannerDeviceId: input.scannerDeviceId },
    });

    return {
      status: "valid" as ScanOutcome,
      ticketId: validation.ticketId,
      checkInId: checkin.id,
      registrant: validation.registrant,
      checkedInAt: checkin.checkedInAt,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function manualCheckIn(
  prisma: PrismaClient,
  input: {
    eventSlug: string;
    ticketId?: string;
    registrantQuery?: string;
    scannerUserId?: string;
    scannerDeviceId?: string;
    notes?: string;
  },
) {
  const event = await getEventBySlug(prisma, input.eventSlug);
  let ticket = input.ticketId
    ? await prisma.ticket.findUnique({
        where: { id: input.ticketId },
        include: { registrant: true },
      })
    : null;

  if (!ticket && input.registrantQuery) {
    ticket = await prisma.ticket.findFirst({
      where: {
        eventId: event.id,
        registrant: {
          OR: [
            { email: { contains: input.registrantQuery.toLowerCase() } },
            { fullName: { contains: input.registrantQuery } },
          ],
        },
      },
      include: { registrant: true },
    });
  }

  if (!ticket || ticket.eventId !== event.id) {
    throw new AppError(404, "Ticket not found");
  }

  if (ticket.ticketStatus !== TicketStatus.ACTIVE) {
    throw new AppError(400, "Ticket is not active");
  }

  const updated = await prisma.ticket.updateMany({
    where: { id: ticket.id, checkedInAt: null },
    data: {
      checkedInAt: new Date(),
      checkedInByUserId: input.scannerUserId,
      checkInNotes: input.notes,
    },
  });

  if (updated.count === 0 && !event.allowReentry) {
    throw new AppError(409, "Ticket already used");
  }

  const checkin = await prisma.checkIn.create({
    data: {
      ticketId: ticket.id,
      eventId: event.id,
      scannedByUserId: input.scannerUserId,
      scannerDeviceId: input.scannerDeviceId,
      method: "manual",
      result: "success",
      notes: input.notes,
    },
  });

  await writeAuditLog(prisma, {
    action: AuditAction.MANUAL_CHECKIN,
    outcome: AuditOutcome.SUCCESS,
    eventId: event.id,
    ticketId: ticket.id,
    userId: input.scannerUserId,
    message: "Manual check-in succeeded",
    metadata: { checkinId: checkin.id },
  });

  return {
    ticketId: ticket.id,
    checkInId: checkin.id,
    registrant: {
      fullName: ticket.registrant.fullName,
      email: ticket.registrant.email,
    },
  };
}
