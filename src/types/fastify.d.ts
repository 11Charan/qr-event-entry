import "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { PrismaClient, UserRole } from "@prisma/client";
import { AppEnv } from "../config/env";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    config: AppEnv;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (roles: UserRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user: {
      sub: string;
      role: UserRole;
      email: string;
    };
  }
}
