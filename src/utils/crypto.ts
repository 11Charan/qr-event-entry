import crypto from "crypto";

export function generateRandomToken(bytes: number) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createChecksum(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}
