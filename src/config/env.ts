import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("12h"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  QR_TOKEN_PREFIX: z.string().default("evtqr_v1"),
  QR_TOKEN_BYTES: z.coerce.number().min(16).max(64).default(32),
  QR_CODE_IMAGE_DIR: z.string().default("storage/qr"),
  DEFAULT_EVENT_SLUG: z.string().default("sample-2026"),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional().default(""),
  GOOGLE_SHEETS_RANGE: z.string().default("Form Responses 1!A:Z"),
  GOOGLE_SHEETS_CLIENT_EMAIL: z.string().optional().default(""),
  GOOGLE_SHEETS_PRIVATE_KEY: z.string().optional().default(""),
  GOOGLE_SHEETS_POLL_INTERVAL_MS: z.coerce.number().default(60000),
  GOOGLE_SHEETS_ENABLED: z.coerce.boolean().default(false),
  EMAIL_ENABLED: z.coerce.boolean().default(false),
  EMAIL_FROM: z.string().default("noreply@example.com"),
  EMAIL_REPLY_TO: z.string().optional().default(""),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(): AppEnv {
  return envSchema.parse(process.env);
}

export const env = new Proxy({} as AppEnv, {
  get(_target, prop) {
    return getEnv()[prop as keyof AppEnv];
  },
});
