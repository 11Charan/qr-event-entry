import { UserRole } from "@prisma/client";
import { FastifyRequest } from "fastify";

export type AuthUser = {
  sub: string;
  role: UserRole;
  email: string;
};

export function getAuthUser(request: FastifyRequest) {
  return request.user as AuthUser;
}
