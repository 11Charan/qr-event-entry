import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();
const eventSlug = process.env.DEFAULT_EVENT_SLUG ?? "sample-2026";
const eventName = eventSlug
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

async function main() {
  const event = await prisma.event.upsert({
    where: { slug: eventSlug },
    update: {
      name: eventName,
      venue: "Main Hall",
      allowReentry: false,
      capacity: 500,
      isActive: true,
    },
    create: {
      slug: eventSlug,
      name: eventName,
      venue: "Main Hall",
      allowReentry: false,
      capacity: 500,
    },
  });

  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);

  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      passwordHash,
      fullName: "System Admin",
      role: UserRole.ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { email: "scanner@example.com" },
    update: {},
    create: {
      email: "scanner@example.com",
      passwordHash,
      fullName: "Gate Scanner",
      role: UserRole.SCANNER,
    },
  });

  await prisma.syncState.upsert({
    where: { id: `google-sheets:${event.id}` },
    update: {},
    create: {
      id: `google-sheets:${event.id}`,
      lastSheetRowNumber: 0,
    },
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
