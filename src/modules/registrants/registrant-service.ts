import { PrismaClient, QrStatus } from "@prisma/client";
import { getEventBySlug } from "../events/event-service";

export async function lookupRegistrants(prisma: PrismaClient, eventSlug: string, query: string) {
  const event = await getEventBySlug(prisma, eventSlug);
  const normalized = query.toLowerCase();
  return prisma.ticket.findMany({
    where: {
      eventId: event.id,
      OR: [
        { id: query },
        { registrant: { email: { contains: normalized } } },
        { registrant: { fullName: { contains: query } } },
      ],
    },
    include: {
      registrant: true,
      qrTokens: {
        where: { status: QrStatus.ACTIVE },
        orderBy: { issuedAt: "desc" },
        take: 1,
      },
    },
    take: 20,
  });
}

export async function getTicketStatus(prisma: PrismaClient, ticketId: string) {
  return prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      registrant: true,
      event: true,
      qrTokens: {
        orderBy: { issuedAt: "desc" },
      },
      checkins: {
        orderBy: { checkedInAt: "desc" },
      },
    },
  });
}
