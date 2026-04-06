import { PrismaClient } from "@prisma/client";
import { AppError } from "../../utils/errors";

export async function getEventBySlug(prisma: PrismaClient, slug: string) {
  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !event.isActive) {
    throw new AppError(404, "Event not found");
  }

  return event;
}
