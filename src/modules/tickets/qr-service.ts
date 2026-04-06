import QRCode from "qrcode";
import { AuditAction, AuditOutcome, PrismaClient, QrStatus, TicketStatus } from "@prisma/client";
import { env } from "../../config/env";
import { generateRandomToken, hashToken } from "../../utils/crypto";
import { AppError } from "../../utils/errors";
import { writeAuditLog } from "../audit/audit-service";

function buildPayload(rawToken: string) {
  return `${env.QR_TOKEN_PREFIX}.${rawToken}`;
}

function extractRawToken(payload: string) {
  const prefix = `${env.QR_TOKEN_PREFIX}.`;
  if (!payload.startsWith(prefix)) {
    throw new AppError(400, "Invalid QR payload format");
  }

  return payload.slice(prefix.length);
}

export async function issueQrForTicket(prisma: PrismaClient, ticketId: string, createdByUserId?: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { registrant: true, qrTokens: true },
  });

  if (!ticket) {
    throw new AppError(404, "Ticket not found");
  }

  if (ticket.ticketStatus !== TicketStatus.ACTIVE) {
    throw new AppError(400, "QR can only be issued for active tickets");
  }

  const rawToken = generateRandomToken(env.QR_TOKEN_BYTES);
  const payload = buildPayload(rawToken);
  const tokenHash = hashToken(rawToken);
  const qrImageDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 400,
  });

  const qrToken = await prisma.qrToken.create({
    data: {
      ticketId: ticket.id,
      tokenHash,
      payload,
      qrImageDataUrl,
      createdByUserId,
    },
  });

  await writeAuditLog(prisma, {
    action: AuditAction.QR_ISSUED,
    outcome: AuditOutcome.SUCCESS,
    eventId: ticket.eventId,
    ticketId: ticket.id,
    registrantId: ticket.registrant.id,
    userId: createdByUserId,
    message: "QR issued for ticket",
    metadata: { qrTokenId: qrToken.id },
  });

  return {
    qrTokenId: qrToken.id,
    payload,
    qrImageDataUrl,
    registrant: {
      fullName: ticket.registrant.fullName,
      email: ticket.registrant.email,
    },
  };
}

export async function revokeQrToken(prisma: PrismaClient, ticketId: string, reason: string, userId?: string) {
  const activeQr = await prisma.qrToken.findFirst({
    where: { ticketId, status: QrStatus.ACTIVE },
    include: { ticket: true },
    orderBy: { issuedAt: "desc" },
  });

  if (!activeQr) {
    throw new AppError(404, "Active QR token not found");
  }

  await prisma.qrToken.update({
    where: { id: activeQr.id },
    data: {
      status: QrStatus.REVOKED,
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });

  await writeAuditLog(prisma, {
    action: AuditAction.QR_REVOKED,
    outcome: AuditOutcome.SUCCESS,
    eventId: activeQr.ticket.eventId,
    ticketId,
    userId,
    message: "QR revoked",
    metadata: { reason, qrTokenId: activeQr.id },
  });
}

export async function reissueQrToken(prisma: PrismaClient, ticketId: string, reason: string, userId?: string) {
  await revokeQrToken(prisma, ticketId, reason, userId);
  const reissued = await issueQrForTicket(prisma, ticketId, userId);

  await writeAuditLog(prisma, {
    action: AuditAction.QR_REISSUED,
    outcome: AuditOutcome.SUCCESS,
    ticketId,
    userId,
    message: "QR reissued",
  });

  return reissued;
}

export async function getActiveQrForTicket(prisma: PrismaClient, ticketId: string) {
  return prisma.qrToken.findFirst({
    where: { ticketId, status: QrStatus.ACTIVE },
    orderBy: { issuedAt: "desc" },
  });
}

export async function ensureActiveQrForTicket(prisma: PrismaClient, ticketId: string, createdByUserId?: string) {
  const existing = await getActiveQrForTicket(prisma, ticketId);
  if (existing) {
    return existing;
  }

  return issueQrForTicket(prisma, ticketId, createdByUserId);
}

export async function resolveQrPayload(prisma: PrismaClient, payload: string) {
  const rawToken = extractRawToken(payload);
  const tokenHash = hashToken(rawToken);
  return prisma.qrToken.findUnique({
    where: { tokenHash },
    include: {
      ticket: {
        include: {
          registrant: true,
          event: true,
        },
      },
    },
  });
}
