process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "file:./bootstrap.db";
process.env.JWT_SECRET = "test-secret-which-is-long-enough-for-jwt";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.QR_TOKEN_PREFIX = "evtqr_v1";
process.env.QR_TOKEN_BYTES = "32";
process.env.DEFAULT_EVENT_SLUG = "sample-2026";

import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { PrismaClient, UserRole } from "@prisma/client";
import { buildTestApp, loginAs, setupTestDatabase } from "./helpers";
import { deliverPendingQrEmails } from "../src/modules/email/qr-email-service";
import { syncRegistrantsFromSource } from "../src/modules/sync/sync-service";
import { revokeQrToken } from "../src/modules/tickets/qr-service";
import { RegistrationSource } from "../src/modules/sync/google-sheets-provider";
import { startGoogleSheetsSyncPolling } from "../src/modules/sync/sync-poller";

class FakeRegistrationSource implements RegistrationSource {
  constructor(private readonly rows: Array<Record<string, string | number | undefined>>) {}

  async listRows() {
    return this.rows.map((row) => ({
      rowNumber: Number(row.rowNumber),
      timestamp: row.timestamp as string | undefined,
      fullName: row.fullName as string | undefined,
      email: row.email as string | undefined,
      phone: row.phone as string | undefined,
      ticketType: row.ticketType as string | undefined,
      guestCategory: row.guestCategory as string | undefined,
      tags: row.tags as string | undefined,
    }));
  }
}

describe("QR event backend", () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeEach(async () => {
    prisma = await setupTestDatabase();

    await prisma.event.create({
      data: {
        slug: "sample-2026",
        name: "Sample Event",
      },
    });

    await prisma.user.create({
      data: {
        email: "admin@example.com",
        fullName: "Admin",
        passwordHash: await bcrypt.hash("ChangeMe123!", 10),
        role: UserRole.ADMIN,
      },
    });

    await prisma.user.create({
      data: {
        email: "scanner@example.com",
        fullName: "Scanner",
        passwordHash: await bcrypt.hash("ChangeMe123!", 10),
        role: UserRole.SCANNER,
      },
    });

    app = await buildTestApp(prisma);
  });

  afterEach(async () => {
    await app.close();
  });

  it("syncs new registrants without reprocessing old rows", async () => {
    const source = new FakeRegistrationSource([
      { rowNumber: 2, timestamp: "2026-04-01T10:00:00Z", fullName: "Alice Doe", email: "alice@example.com", ticketType: "vip" },
      { rowNumber: 3, timestamp: "2026-04-01T10:01:00Z", fullName: "Bob Doe", email: "bob@example.com", ticketType: "standard" },
    ]);

    const first = await syncRegistrantsFromSource(prisma, source, "sample-2026");
    const second = await syncRegistrantsFromSource(prisma, source, "sample-2026");

    expect(first.processed).toBe(2);
    expect(second.processed).toBe(0);
    expect(await prisma.registrant.count()).toBe(2);
    expect(await prisma.qrToken.count()).toBe(2);
  });

  it("auto-issues QR during sync and supports a successful check-in", async () => {
    await syncRegistrantsFromSource(prisma, new FakeRegistrationSource([
      { rowNumber: 2, fullName: "Alice Doe", email: "alice@example.com" },
    ]), "sample-2026");

    const ticket = await prisma.ticket.findFirstOrThrow();
    const qr = await prisma.qrToken.findFirstOrThrow({
      where: { ticketId: ticket.id, status: "ACTIVE" },
      orderBy: { issuedAt: "desc" },
    });
    const { token } = await loginAs(app, "scanner@example.com");

    const result = await app.inject({
      method: "POST",
      url: "/api/v1/checkins/scan",
      headers: { authorization: `Bearer ${token}` },
      payload: { qrPayload: qr.payload, eventSlug: "sample-2026", scannerDeviceId: "gate-1" },
    });
    const body = result.json();

    expect(result.statusCode).toBe(200);
    expect(body.status).toBe("valid");
    expect(await prisma.checkIn.count()).toBe(1);
  });

  it("blocks duplicate scan reuse", async () => {
    await syncRegistrantsFromSource(prisma, new FakeRegistrationSource([
      { rowNumber: 2, fullName: "Alice Doe", email: "alice@example.com" },
    ]), "sample-2026");

    const ticket = await prisma.ticket.findFirstOrThrow();
    const qr = await prisma.qrToken.findFirstOrThrow({
      where: { ticketId: ticket.id, status: "ACTIVE" },
      orderBy: { issuedAt: "desc" },
    });
    const { token } = await loginAs(app, "scanner@example.com");

    await app.inject({
      method: "POST",
      url: "/api/v1/checkins/scan",
      headers: { authorization: `Bearer ${token}` },
      payload: { qrPayload: qr.payload, eventSlug: "sample-2026", scannerDeviceId: "gate-1" },
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/checkins/scan",
      headers: { authorization: `Bearer ${token}` },
      payload: { qrPayload: qr.payload, eventSlug: "sample-2026", scannerDeviceId: "gate-2" },
    });

    expect(duplicate.json().status).toBe("already_used");
  });

  it("rejects revoked QR", async () => {
    await syncRegistrantsFromSource(prisma, new FakeRegistrationSource([
      { rowNumber: 2, fullName: "Alice Doe", email: "alice@example.com" },
    ]), "sample-2026");

    const ticket = await prisma.ticket.findFirstOrThrow();
    const qr = await prisma.qrToken.findFirstOrThrow({
      where: { ticketId: ticket.id, status: "ACTIVE" },
      orderBy: { issuedAt: "desc" },
    });
    await revokeQrToken(prisma, ticket.id, "Compromised");
    const { token } = await loginAs(app, "scanner@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/scans/validate",
      headers: { authorization: `Bearer ${token}` },
      payload: { qrPayload: qr.payload, eventSlug: "sample-2026", scannerDeviceId: "gate-1" },
    });

    expect(response.json().status).toBe("revoked");
  });

  it("prevents concurrent race condition from double check-in", async () => {
    await syncRegistrantsFromSource(prisma, new FakeRegistrationSource([
      { rowNumber: 2, fullName: "Alice Doe", email: "alice@example.com" },
    ]), "sample-2026");

    const ticket = await prisma.ticket.findFirstOrThrow();
    const qr = await prisma.qrToken.findFirstOrThrow({
      where: { ticketId: ticket.id, status: "ACTIVE" },
      orderBy: { issuedAt: "desc" },
    });
    const { token } = await loginAs(app, "scanner@example.com");

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/checkins/scan",
        headers: { authorization: `Bearer ${token}` },
        payload: { qrPayload: qr.payload, eventSlug: "sample-2026", scannerDeviceId: "gate-1" },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/checkins/scan",
        headers: { authorization: `Bearer ${token}` },
        payload: { qrPayload: qr.payload, eventSlug: "sample-2026", scannerDeviceId: "gate-2" },
      }),
    ]);

    const statuses = [first.json().status, second.json().status].sort();
    expect(statuses).toEqual(["already_used", "valid"]);
    expect(await prisma.checkIn.count()).toBe(1);
  });

  it("polls new sheet entries and auto-issues QR codes for them", async () => {
    process.env.EMAIL_ENABLED = "true";

    class MutableRegistrationSource implements RegistrationSource {
      rows: Array<Record<string, string | number | undefined>> = [];

      async listRows() {
        return this.rows.map((row) => ({
          rowNumber: Number(row.rowNumber),
          timestamp: row.timestamp as string | undefined,
          fullName: row.fullName as string | undefined,
          email: row.email as string | undefined,
          phone: row.phone as string | undefined,
          ticketType: row.ticketType as string | undefined,
          guestCategory: row.guestCategory as string | undefined,
          tags: row.tags as string | undefined,
        }));
      }
    }

    const source = new MutableRegistrationSource();
    const stopPolling = startGoogleSheetsSyncPolling({
      prisma,
      source,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      config: {
        DEFAULT_EVENT_SLUG: "sample-2026",
        GOOGLE_SHEETS_ENABLED: true,
        GOOGLE_SHEETS_POLL_INTERVAL_MS: 25,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await prisma.qrToken.count()).toBe(0);

    source.rows = [
      { rowNumber: 2, fullName: "Late Entry", email: "late@example.com" },
    ];

    await new Promise((resolve) => setTimeout(resolve, 75));

    const registrant = await prisma.registrant.findFirst({ where: { email: "late@example.com" } });
    const ticket = await prisma.ticket.findFirst({ where: { registrantId: registrant?.id } });

    expect(registrant).toBeTruthy();
    expect(ticket).toBeTruthy();
    expect(await prisma.qrToken.count()).toBe(1);

    stopPolling();
    process.env.EMAIL_ENABLED = "false";
  });

  it("emails active QR tokens that have not been delivered yet", async () => {
    process.env.EMAIL_ENABLED = "true";

    await syncRegistrantsFromSource(prisma, new FakeRegistrationSource([
      { rowNumber: 2, fullName: "Email User", email: "email-user@example.com" },
    ]), "sample-2026");

    const sentTo: string[] = [];
    const result = await deliverPendingQrEmails(
      prisma,
      { eventSlug: "sample-2026" },
      async (input) => {
        sentTo.push(input.email);
      },
    );

    const qrToken = await prisma.qrToken.findFirstOrThrow({
      where: { emailedAt: { not: null } },
    });

    expect(result.attempted).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(sentTo).toEqual(["email-user@example.com"]);
    expect(qrToken.emailedAt).toBeTruthy();

    process.env.EMAIL_ENABLED = "false";
  });
});
