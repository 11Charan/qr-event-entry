import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient | undefined;

export function getPrismaClient() {
  if (!prisma) {
    prisma = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL,
    });
  }

  return prisma;
}

export async function resetPrismaClient() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
