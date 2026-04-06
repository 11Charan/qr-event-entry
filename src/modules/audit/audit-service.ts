import { AuditAction, AuditOutcome, PrismaClient } from "@prisma/client";

export async function writeAuditLog(
  prisma: PrismaClient,
  input: {
    action: AuditAction;
    outcome: AuditOutcome;
    message: string;
    eventId?: string;
    ticketId?: string;
    registrantId?: string;
    userId?: string;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await prisma.auditLog.create({
    data: {
      action: input.action,
      outcome: input.outcome,
      message: input.message,
      eventId: input.eventId,
      ticketId: input.ticketId,
      registrantId: input.registrantId,
      userId: input.userId,
      ipAddress: input.ipAddress,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  });
}
