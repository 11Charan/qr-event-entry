import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const syncSchema = z.object({
  eventSlug: z.string().min(1).optional(),
});

export const pastedSheetImportSchema = z.object({
  eventSlug: z.string().min(1).optional(),
  rowsText: z.string().min(10),
});

export const issueQrSchema = z.object({
  ticketId: z.string().min(1),
});

export const scanValidationSchema = z.object({
  qrPayload: z.string().min(10),
  eventSlug: z.string().min(1),
  scannerDeviceId: z.string().max(100).optional(),
});

export const manualCheckInSchema = z.object({
  eventSlug: z.string().min(1),
  ticketId: z.string().min(1).optional(),
  registrantQuery: z.string().min(2).optional(),
  notes: z.string().max(500).optional(),
  scannerDeviceId: z.string().max(100).optional(),
}).refine((value) => Boolean(value.ticketId || value.registrantQuery), {
  message: "ticketId or registrantQuery is required",
});

export const revokeQrSchema = z.object({
  ticketId: z.string().min(1),
  reason: z.string().min(3).max(300),
});

export const statusLookupSchema = z.object({
  eventSlug: z.string().min(1),
  query: z.string().min(1),
});
