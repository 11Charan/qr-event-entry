import { PrismaClient } from "@prisma/client";
import { FastifyBaseLogger } from "fastify";
import { AppEnv } from "../../config/env";
import { deliverPendingQrEmails } from "../email/qr-email-service";
import { syncRegistrantsFromSource } from "./sync-service";
import { GoogleSheetsRegistrationSource, RegistrationSource } from "./google-sheets-provider";

type SyncPollerOptions = {
  prisma: PrismaClient;
  config: Pick<AppEnv, "DEFAULT_EVENT_SLUG" | "GOOGLE_SHEETS_ENABLED" | "GOOGLE_SHEETS_POLL_INTERVAL_MS">;
  logger: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  source?: RegistrationSource;
};

export function startGoogleSheetsSyncPolling(options: SyncPollerOptions) {
  if (!options.config.GOOGLE_SHEETS_ENABLED) {
    return () => {};
  }

  const source = options.source ?? new GoogleSheetsRegistrationSource();
  let isSyncInFlight = false;
  const runSync = async () => {
    if (isSyncInFlight) {
      options.logger.warn("Skipping Google Sheets sync tick because the previous run is still active");
      return;
    }

    isSyncInFlight = true;

    try {
      const result = await syncRegistrantsFromSource(
        options.prisma,
        source,
        options.config.DEFAULT_EVENT_SLUG,
      );
      const emailResult = await deliverPendingQrEmails(options.prisma, {
        eventSlug: options.config.DEFAULT_EVENT_SLUG,
      });

      if (result.processed > 0 || result.skipped > 0 || emailResult.sent > 0 || emailResult.failed > 0) {
        options.logger.info({
          processed: result.processed,
          skipped: result.skipped,
          lastRowNumber: result.lastRowNumber,
          emailsAttempted: emailResult.attempted,
          emailsSent: emailResult.sent,
          emailFailures: emailResult.failed,
          emailFailureDetails: emailResult.failures,
        }, "Completed Google Sheets sync tick");
      }
    } catch (error) {
      options.logger.error({ err: error }, "Google Sheets sync tick failed");
    } finally {
      isSyncInFlight = false;
    }
  };

  void runSync();
  const intervalId = setInterval(() => {
    void runSync();
  }, options.config.GOOGLE_SHEETS_POLL_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
  };
}
