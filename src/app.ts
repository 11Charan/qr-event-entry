import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { PrismaClient } from "@prisma/client";
import { registerRoutes } from "./routes";
import { env } from "./config/env";
import { getPrismaClient } from "./config/prisma";
import { registerAuthDecorators } from "./modules/auth/auth-plugin";
import { errorHandler } from "./utils/error-handler";

type BuildAppOptions = {
  prisma?: PrismaClient;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : { transport: { target: "pino-pretty" } },
  });
  const prisma = options.prisma ?? getPrismaClient();

  app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((value) => value.trim()),
    credentials: true,
  });
  app.register(helmet);
  app.register(jwt, { secret: env.JWT_SECRET });
  app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
  });
  app.register(swagger, {
    openapi: {
      info: {
        title: "QR Event Entry API",
        version: "1.0.0",
      },
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.decorate("prisma", prisma);
  app.decorate("config", env);

  registerAuthDecorators(app);
  app.setErrorHandler(errorHandler);
  registerRoutes(app);

  return app;
}
