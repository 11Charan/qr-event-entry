import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

async function main() {
  const event = await prisma.event.upsert({
    where: { slug: "sample-2026" },
    update: {},
    create: {
      slug: "sample-2026",
      name: "Sample Event 2026",
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
