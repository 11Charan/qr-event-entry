import { FastifyInstance } from "fastify";
import { loginSchema, issueQrSchema, manualCheckInSchema, pastedSheetImportSchema, revokeQrSchema, scanValidationSchema, statusLookupSchema, syncSchema } from "../utils/validation";
import { loginUser } from "../modules/auth/auth-service";
import { syncRegistrantsFromSource } from "../modules/sync/sync-service";
import { GoogleSheetsRegistrationSource } from "../modules/sync/google-sheets-provider";
import { PastedSheetRegistrationSource } from "../modules/sync/pasted-sheet-source";
import { SampleRegistrationSource } from "../modules/sync/sample-registration-source";
import { issueQrForTicket, reissueQrToken, revokeQrToken } from "../modules/tickets/qr-service";
import { getTicketStatus, lookupRegistrants } from "../modules/registrants/registrant-service";
import { checkInByQr, manualCheckIn, validateQrScan } from "../modules/checkins/checkin-service";
import { UserRole } from "@prisma/client";
import { getAuthUser } from "../utils/auth-user";
import { AppError } from "../utils/errors";

export function registerRoutes(app: FastifyInstance) {
  app.get("/", async () => ({
    name: "qr-event-entry",
    status: "ok",
    docs: "/docs",
    health: "/health",
  }));

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await loginUser(app.prisma, body.email.toLowerCase(), body.password, request.ip);
    const token = await reply.jwtSign(
      { role: user.role, email: user.email },
      { sign: { sub: user.id, expiresIn: app.config.JWT_EXPIRES_IN } },
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
      },
    };
  });

  app.post("/api/v1/sync/google-sheets", {
    preHandler: [app.authorize([UserRole.ADMIN])],
  }, async (request) => {
    const body = syncSchema.parse(request.body ?? {});
    return syncRegistrantsFromSource(
      app.prisma,
      new GoogleSheetsRegistrationSource(),
      body.eventSlug ?? app.config.DEFAULT_EVENT_SLUG,
    );
  });

  app.post("/api/v1/dev/load-sample-registrants", {
    preHandler: [app.authorize([UserRole.ADMIN])],
  }, async (request) => {
    if (app.config.NODE_ENV === "production") {
      throw new AppError(404, "Not found");
    }

    const body = syncSchema.parse(request.body ?? {});
    return syncRegistrantsFromSource(
      app.prisma,
      new SampleRegistrationSource(),
      body.eventSlug ?? app.config.DEFAULT_EVENT_SLUG,
    );
  });

  app.post("/api/v1/dev/import-sheet-rows", {
    preHandler: [app.authorize([UserRole.ADMIN])],
  }, async (request) => {
    if (app.config.NODE_ENV === "production") {
      throw new AppError(404, "Not found");
    }

    const body = pastedSheetImportSchema.parse(request.body);
    return syncRegistrantsFromSource(
      app.prisma,
      new PastedSheetRegistrationSource(body.rowsText),
      body.eventSlug ?? app.config.DEFAULT_EVENT_SLUG,
    );
  });

  app.post("/api/v1/tickets/issue-qr", {
    preHandler: [app.authorize([UserRole.ADMIN])],
  }, async (request) => {
    const body = issueQrSchema.parse(request.body);
    return issueQrForTicket(app.prisma, body.ticketId, getAuthUser(request).sub);
  });

  app.get("/api/v1/tickets/:ticketId/status", {
    preHandler: [app.authorize([UserRole.ADMIN, UserRole.SCANNER])],
  }, async (request) => {
    const ticketId = (request.params as { ticketId: string }).ticketId;
    return getTicketStatus(app.prisma, ticketId);
  });

  app.post("/api/v1/scans/validate", {
    preHandler: [app.authorize([UserRole.ADMIN, UserRole.SCANNER])],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request) => {
    const body = scanValidationSchema.parse(request.body);
    const user = getAuthUser(request);
    return validateQrScan(app.prisma, {
      qrPayload: body.qrPayload,
      eventSlug: body.eventSlug,
      scannerUserId: user.sub,
      scannerDeviceId: body.scannerDeviceId,
      ipAddress: request.ip,
    });
  });

  app.post("/api/v1/checkins/scan", {
    preHandler: [app.authorize([UserRole.ADMIN, UserRole.SCANNER])],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request) => {
    const body = scanValidationSchema.parse(request.body);
    const user = getAuthUser(request);
    return checkInByQr(app.prisma, {
      qrPayload: body.qrPayload,
      eventSlug: body.eventSlug,
      scannerUserId: user.sub,
      scannerDeviceId: body.scannerDeviceId,
      ipAddress: request.ip,
    });
  });

  app.post("/api/v1/checkins/manual", {
    preHandler: [app.authorize([UserRole.ADMIN, UserRole.SCANNER])],
  }, async (request) => {
    const body = manualCheckInSchema.parse(request.body);
    const user = getAuthUser(request);
    return manualCheckIn(app.prisma, {
      eventSlug: body.eventSlug,
      ticketId: body.ticketId,
      registrantQuery: body.registrantQuery,
      scannerUserId: user.sub,
      scannerDeviceId: body.scannerDeviceId,
      notes: body.notes,
    });
  });

  app.post("/api/v1/tickets/revoke-qr", {
    preHandler: [app.authorize([UserRole.ADMIN])],
  }, async (request) => {
    const body = revokeQrSchema.parse(request.body);
    await revokeQrToken(app.prisma, body.ticketId, body.reason, getAuthUser(request).sub);
    return { success: true };
  });

  app.post("/api/v1/tickets/reissue-qr", {
    preHandler: [app.authorize([UserRole.ADMIN])],
  }, async (request) => {
    const body = revokeQrSchema.parse(request.body);
    return reissueQrToken(app.prisma, body.ticketId, body.reason, getAuthUser(request).sub);
  });

  app.get("/api/v1/registrants/lookup", {
    preHandler: [app.authorize([UserRole.ADMIN, UserRole.SCANNER])],
  }, async (request) => {
    const query = statusLookupSchema.parse(request.query);
    return lookupRegistrants(app.prisma, query.eventSlug, query.query);
  });

  app.get("/api/v1/audit", {
    preHandler: [app.authorize([UserRole.ADMIN])],
  }, async (request) => {
    const { ticketId, eventId } = request.query as { ticketId?: string; eventId?: string };
    return app.prisma.auditLog.findMany({
      where: {
        ticketId,
        eventId,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });

  app.get("/api/v1/checkins/export", {
    preHandler: [app.authorize([UserRole.ADMIN])],
  }, async (request) => {
    const { eventSlug } = request.query as { eventSlug: string };
    const event = await app.prisma.event.findUniqueOrThrow({ where: { slug: eventSlug } });
    const results = await app.prisma.ticket.findMany({
      where: { eventId: event.id },
      include: { registrant: true },
      orderBy: { checkedInAt: "desc" },
    });
    return results.map((ticket: typeof results[number]) => ({
      ticketId: ticket.id,
      fullName: ticket.registrant.fullName,
      email: ticket.registrant.email,
      checkedInAt: ticket.checkedInAt,
      ticketType: ticket.ticketType,
    }));
  });
}
