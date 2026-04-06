import { PrismaClient } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { resetPrismaClient, getPrismaClient } from "../src/config/prisma";

export async function setupTestDatabase() {
  process.env.DATABASE_URL = "file:./test.db";
  process.env.JWT_SECRET = "test-secret-which-is-long-enough-for-jwt";
  process.env.CORS_ORIGIN = "http://localhost:5173";
  process.env.QR_TOKEN_PREFIX = "evtqr_v1";
  process.env.QR_TOKEN_BYTES = "32";
  process.env.DEFAULT_EVENT_SLUG = "sample-2026";
  process.env.NODE_ENV = "test";

  await resetPrismaClient();
  const prisma = getPrismaClient() as PrismaClient;

  await prisma.auditLog.deleteMany();
  await prisma.checkIn.deleteMany();
  await prisma.qrToken.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.registrant.deleteMany();
  await prisma.syncState.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  return prisma;
}

export async function buildTestApp(prisma: PrismaClient) {
  const app = buildApp({ prisma });
  await app.ready();
  return app;
}

export async function loginAs(app: FastifyInstance, email: string, password = "ChangeMe123!") {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });

  return response.json() as { token: string };
}
