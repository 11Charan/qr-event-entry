import { AuditAction, AuditOutcome, PrismaClient } from "@prisma/client";
import { AppError } from "../../utils/errors";
import { verifyPassword } from "../../utils/password";
import { writeAuditLog } from "../audit/audit-service";

export async function loginUser(prisma: PrismaClient, email: string, password: string, ipAddress?: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    await writeAuditLog(prisma, {
      action: AuditAction.LOGIN_FAILURE,
      outcome: AuditOutcome.FAILURE,
      message: "Login failed",
      userId: user?.id,
      ipAddress,
      metadata: { email },
    });
    throw new AppError(401, "Invalid credentials");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await writeAuditLog(prisma, {
    action: AuditAction.LOGIN_SUCCESS,
    outcome: AuditOutcome.SUCCESS,
    message: "Login succeeded",
    userId: user.id,
    ipAddress,
  });

  return user;
}
