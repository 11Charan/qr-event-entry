-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "venue" TEXT,
    "capacity" INTEGER,
    "allowReentry" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Registrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "sheetRowRef" TEXT NOT NULL,
    "sheetRowNumber" INTEGER,
    "responseTimestamp" DATETIME,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "guestCategory" TEXT,
    "tags" TEXT,
    "rawDataJson" TEXT,
    "syncChecksum" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Registrant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "registrantId" TEXT NOT NULL,
    "ticketType" TEXT NOT NULL DEFAULT 'standard',
    "ticketStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "checkedInAt" DATETIME,
    "checkedInByUserId" TEXT,
    "checkInNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ticket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Ticket_registrantId_fkey" FOREIGN KEY ("registrantId") REFERENCES "Registrant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QrToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revokedReason" TEXT,
    "replacedByTokenId" TEXT,
    "payload" TEXT NOT NULL,
    "qrImageDataUrl" TEXT,
    "createdByUserId" TEXT,
    CONSTRAINT "QrToken_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "qrTokenId" TEXT,
    "checkedInAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannedByUserId" TEXT,
    "scannerDeviceId" TEXT,
    "method" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "notes" TEXT,
    CONSTRAINT "CheckIn_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CheckIn_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT,
    "ticketId" TEXT,
    "registrantId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadataJson" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lastSheetRowNumber" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" DATETIME,
    "cursorMetadataJson" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Registrant_email_idx" ON "Registrant"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Registrant_eventId_sheetRowRef_key" ON "Registrant"("eventId", "sheetRowRef");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_registrantId_key" ON "Ticket"("registrantId");

-- CreateIndex
CREATE INDEX "Ticket_eventId_ticketStatus_idx" ON "Ticket"("eventId", "ticketStatus");

-- CreateIndex
CREATE UNIQUE INDEX "QrToken_tokenHash_key" ON "QrToken"("tokenHash");

-- CreateIndex
CREATE INDEX "QrToken_ticketId_status_idx" ON "QrToken"("ticketId", "status");

-- CreateIndex
CREATE INDEX "CheckIn_ticketId_checkedInAt_idx" ON "CheckIn"("ticketId", "checkedInAt");

-- CreateIndex
CREATE INDEX "CheckIn_eventId_checkedInAt_idx" ON "CheckIn"("eventId", "checkedInAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "AuditLog_eventId_createdAt_idx" ON "AuditLog"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_ticketId_createdAt_idx" ON "AuditLog"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
