import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./errors";

export function errorHandler(error: FastifyError | Error, _request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    reply.code(error.statusCode).send({ error: error.message, details: error.details });
    return;
  }

  if (error instanceof ZodError) {
    reply.code(400).send({ error: "Validation failed", details: error.flatten() });
    return;
  }

  reply.code(500).send({ error: "Internal server error" });
}
