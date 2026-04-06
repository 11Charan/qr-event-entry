import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { UserRole } from "@prisma/client";
import { getAuthUser } from "../../utils/auth-user";

export function registerAuthDecorators(app: FastifyInstance) {
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.decorate("authorize", (roles: UserRole[]) => async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply);

    if (reply.sent) {
      return;
    }

    const user = getAuthUser(request);
    if (!roles.includes(user.role)) {
      reply.code(403).send({ error: "Forbidden" });
    }
  });
}
