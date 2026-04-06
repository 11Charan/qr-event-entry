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

function getDefaultEventSlug(app: FastifyInstance, eventSlug?: string) {
  return eventSlug ?? app.config.DEFAULT_EVENT_SLUG;
}

function getPathParam<T extends string>(request: { params: unknown }, key: T) {
  return (request.params as Record<T, string>)[key];
}

export function registerRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: [app.authorize([UserRole.ADMIN])] };
  const staffOnly = { preHandler: [app.authorize([UserRole.ADMIN, UserRole.SCANNER])] };

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

  app.post("/api/v1/sync/google-sheets", adminOnly, async (request) => {
    const body = syncSchema.parse(request.body ?? {});
    return syncRegistrantsFromSource(
      app.prisma,
      new GoogleSheetsRegistrationSource(),
      getDefaultEventSlug(app, body.eventSlug),
    );
  });

  app.post("/api/v1/dev/load-sample-registrants", adminOnly, async (request) => {
    if (app.config.NODE_ENV === "production") {
      throw new AppError(404, "Not found");
    }

    const body = syncSchema.parse(request.body ?? {});
    return syncRegistrantsFromSource(
      app.prisma,
      new SampleRegistrationSource(),
      getDefaultEventSlug(app, body.eventSlug),
    );
  });

  app.post("/api/v1/dev/import-sheet-rows", adminOnly, async (request) => {
    if (app.config.NODE_ENV === "production") {
      throw new AppError(404, "Not found");
    }

    const body = pastedSheetImportSchema.parse(request.body);
    return syncRegistrantsFromSource(
      app.prisma,
      new PastedSheetRegistrationSource(body.rowsText),
      getDefaultEventSlug(app, body.eventSlug),
    );
  });

  app.post("/api/v1/tickets/issue-qr", adminOnly, async (request) => {
    const body = issueQrSchema.parse(request.body);
    return issueQrForTicket(app.prisma, body.ticketId, getAuthUser(request).sub);
  });

  app.get("/api/v1/tickets/:ticketId/status", staffOnly, async (request) => {
    const ticketId = getPathParam(request, "ticketId");
    return getTicketStatus(app.prisma, ticketId);
  });

  app.post("/api/v1/scans/validate", {
    ...staffOnly,
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
    ...staffOnly,
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

  app.post("/api/v1/checkins/manual", staffOnly, async (request) => {
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

  app.post("/api/v1/tickets/revoke-qr", adminOnly, async (request) => {
    const body = revokeQrSchema.parse(request.body);
    await revokeQrToken(app.prisma, body.ticketId, body.reason, getAuthUser(request).sub);
    return { success: true };
  });

  app.post("/api/v1/tickets/reissue-qr", adminOnly, async (request) => {
    const body = revokeQrSchema.parse(request.body);
    return reissueQrToken(app.prisma, body.ticketId, body.reason, getAuthUser(request).sub);
  });

  app.get("/api/v1/registrants/lookup", staffOnly, async (request) => {
    const query = statusLookupSchema.parse(request.query);
    return lookupRegistrants(app.prisma, query.eventSlug, query.query);
  });

  app.get("/api/v1/audit", adminOnly, async (request) => {
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

  app.get("/api/v1/checkins/export", adminOnly, async (request) => {
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
