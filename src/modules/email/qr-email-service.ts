import nodemailer from "nodemailer";
import { PrismaClient, QrStatus, TicketStatus } from "@prisma/client";
import { env } from "../../config/env";
import { getEventBySlug } from "../events/event-service";

type QrEmailPayload = {
  email: string;
  fullName: string;
  eventName: string;
  qrPayload: string;
  qrImageDataUrl: string;
};

type QrEmailSender = (input: QrEmailPayload) => Promise<void>;

type PendingQrEmailResult = {
  attempted: number;
  sent: number;
  failed: number;
  failures: Array<{
    qrTokenId: string;
    email: string;
    message: string;
  }>;
};

let transporter: nodemailer.Transporter | undefined;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER || env.SMTP_PASS
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
          }
        : undefined,
    });
  }

  return transporter;
}

function getQrImageBuffer(qrImageDataUrl: string) {
  const match = qrImageDataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) {
    throw new Error("QR code image is not a PNG data URL");
  }

  return Buffer.from(match[1], "base64");
}

export async function sendTicketQrEmail(input: QrEmailPayload) {
  if (!env.EMAIL_ENABLED) {
    return;
  }

  const transport = getTransporter();
  const qrImageBuffer = getQrImageBuffer(input.qrImageDataUrl);

  await transport.sendMail({
    from: env.EMAIL_FROM,
    to: input.email,
    replyTo: env.EMAIL_REPLY_TO || undefined,
    subject: `${input.eventName} entry QR code`,
    text: [
      `Hi ${input.fullName},`,
      "",
      `Your QR code for ${input.eventName} is attached to this email.`,
      `QR payload: ${input.qrPayload}`,
      "",
      "Present the attached QR code at entry.",
    ].join("\n"),
    html: [
      `<p>Hi ${input.fullName},</p>`,
      `<p>Your QR code for <strong>${input.eventName}</strong> is attached below.</p>`,
      `<p><img src="cid:ticket-qr" alt="Event QR code" /></p>`,
      `<p>Present this QR code at entry.</p>`,
    ].join(""),
    attachments: [
      {
        filename: "event-entry-qr.png",
        content: qrImageBuffer,
        cid: "ticket-qr",
      },
    ],
  });
}

export async function deliverQrTokenEmail(
  prisma: PrismaClient,
  qrTokenId: string,
  sender: QrEmailSender = sendTicketQrEmail,
) {
  if (!env.EMAIL_ENABLED) {
    return false;
  }

  const qrToken = await prisma.qrToken.findUnique({
    where: { id: qrTokenId },
    include: {
      ticket: {
        include: {
          event: true,
          registrant: true,
        },
      },
    },
  });

  if (
    !qrToken ||
    qrToken.emailedAt ||
    qrToken.status !== QrStatus.ACTIVE ||
    qrToken.ticket.ticketStatus !== TicketStatus.ACTIVE ||
    !qrToken.qrImageDataUrl
  ) {
    return false;
  }

  await sender({
    email: qrToken.ticket.registrant.email,
    fullName: qrToken.ticket.registrant.fullName,
    eventName: qrToken.ticket.event.name,
    qrPayload: qrToken.payload,
    qrImageDataUrl: qrToken.qrImageDataUrl,
  });

  const updated = await prisma.qrToken.updateMany({
    where: {
      id: qrToken.id,
      emailedAt: null,
    },
    data: {
      emailedAt: new Date(),
    },
  });

  return updated.count > 0;
}

export async function deliverPendingQrEmails(
  prisma: PrismaClient,
  input: {
    eventSlug: string;
    limit?: number;
  },
  sender: QrEmailSender = sendTicketQrEmail,
) : Promise<PendingQrEmailResult> {
  if (!env.EMAIL_ENABLED) {
    return { attempted: 0, sent: 0, failed: 0, failures: [] };
  }

  const event = await getEventBySlug(prisma, input.eventSlug);
  const pendingTokens = await prisma.qrToken.findMany({
    where: {
      status: QrStatus.ACTIVE,
      emailedAt: null,
      qrImageDataUrl: { not: null },
      ticket: {
        eventId: event.id,
        ticketStatus: TicketStatus.ACTIVE,
      },
    },
    include: {
      ticket: {
        include: {
          registrant: true,
        },
      },
    },
    orderBy: { issuedAt: "asc" },
    take: input.limit ?? 50,
  });

  let sent = 0;
  let failed = 0;
  const failures: PendingQrEmailResult["failures"] = [];

  for (const qrToken of pendingTokens) {
    try {
      const delivered = await deliverQrTokenEmail(prisma, qrToken.id, sender);
      if (delivered) {
        sent += 1;
      }
    } catch (error) {
      failed += 1;
      failures.push({
        qrTokenId: qrToken.id,
        email: qrToken.ticket.registrant.email,
        message: error instanceof Error ? error.message : "Unknown email delivery error",
      });
    }
  }

  return {
    attempted: pendingTokens.length,
    sent,
    failed,
    failures,
  };
}
