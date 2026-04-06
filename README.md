# QR Event Entry Backend

QR-based event entry backend built with Fastify, Prisma, SQLite, Google Sheets sync, and SMTP email delivery.

The intended local flow is:

1. registrations land in Google Sheets
2. the app polls the sheet
3. new rows become registrants and tickets
4. a QR code is generated
5. the QR is emailed to the registrant
6. scanners validate and consume the QR at entry

## What This Project Does

- Syncs registrants from Google Sheets
- Creates one ticket per registrant
- Generates a QR token for each active ticket
- Emails the QR code to the registrant through SMTP
- Supports QR validation and check-in
- Stores audit logs for login, sync, QR issuance, and check-in

## Stack

- Node.js 22+
- TypeScript
- Fastify
- Prisma
- SQLite for local development
- Google Sheets API
- Nodemailer for SMTP delivery

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your environment file

Copy `.env.example` to `.env` and fill it in.

At minimum, these values matter:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL="file:./dev.db"
JWT_SECRET=change-me-to-a-long-random-secret
DEFAULT_EVENT_SLUG=your-event-slug

GOOGLE_SHEETS_ENABLED=true
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_SHEETS_RANGE=Form Responses 1!A:Z
GOOGLE_SHEETS_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_POLL_INTERVAL_MS=5000

EMAIL_ENABLED=true
EMAIL_FROM=you@gmail.com
EMAIL_REPLY_TO=you@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@gmail.com
SMTP_PASS=your-google-app-password
```

Notes:

- `DEFAULT_EVENT_SLUG` must exist in the database.
- `SMTP_SECURE=false` is correct for Gmail on port `587`.
- `SMTP_PASS` must be a Gmail app password, not your normal Gmail password.
- `GOOGLE_SHEETS_POLL_INTERVAL_MS=5000` is useful for testing. Increase it later if needed.

### 3. Create the database

```bash
npx prisma db push
```

### 4. Build the project

```bash
npm run build
```

### 5. Seed the local database

This creates:

- the event using `DEFAULT_EVENT_SLUG`
- an admin user
- a scanner user

Preferred:

```bash
npm run seed
```

If `tsx` causes issues in your environment, use the compiled seed instead:

```bash
node dist/prisma/seed.js
```

### 6. Start the API

For the most stable local run:

```bash
npm start
```

For watch mode during development:

```bash
npm run dev
```

Swagger UI:

```text
http://localhost:3000/docs
```

Health endpoint:

```text
http://localhost:3000/health
```

## Seeded Users

- `admin@example.com` / `ChangeMe123!`
- `scanner@example.com` / `ChangeMe123!`

These are for local development only.

## Google Sheets Setup

### Required Google Cloud setup

1. Create a Google Cloud project.
2. Enable the Google Sheets API.
3. Create a service account.
4. Download the service account credentials or copy the private key fields.
5. Put the service account email and private key into `.env`.
6. Share the Google Sheet with the service account email.

If the sheet is not shared with the service account, syncing will fail.

### Expected sheet headers

The parser currently expects these columns:

1. `Timestamp`
2. `Email Address`
3. `Full Name`
4. `Email Address`
5. `Phone Number`
6. `University / Organization Name`
7. `Field of Study / Stream(If Student)`
8. `Highest Level of Study`
9. `Do you have prior experience in AI/Cloud?`
10. `Would you like to participate in the workshop?`
11. `How did you hear about this event?`
12. `Email Sent`
13. `Sent At`

Current mapping:

- `fullName` comes from `Full Name`
- `email` comes from the first `Email Address`
- `phone` comes from `Phone Number`
- `ticketType` defaults to `standard`
- `guestCategory` becomes `workshop` when the workshop column contains `yes`, otherwise `attendee`
- `tags` are built from organization, study info, workshop interest, and referral source

If your form headers change, update [google-sheets-provider.ts](/Users/sricharan/QR%20Event%20Entry/src/modules/sync/google-sheets-provider.ts).

### Sample files

- [google-sheet-sample.csv](/Users/sricharan/QR%20Event%20Entry/samples/google-sheet-sample.csv)
- [google-form-responses-example.csv](/Users/sricharan/QR%20Event%20Entry/samples/google-form-responses-example.csv)

## Email Setup

The app sends QR emails automatically for new synced rows when:

- `EMAIL_ENABLED=true`
- SMTP settings are valid
- the registrant row has a valid email address
- the ticket has an active QR token

### Gmail SMTP settings

For Gmail, use:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
```

Requirements:

- 2-Step Verification must be enabled on the Gmail account
- `SMTP_PASS` must be a Google app password
- `EMAIL_FROM` should match the Gmail account or a valid alias

### What the email contains

- Subject: `<Event Name> entry QR code`
- Plain text fallback
- HTML body with the QR shown inline
- PNG attachment named `event-entry-qr.png`

## First End-to-End Local Test

Use this exact order.

### 1. Start the server

```bash
npm start
```

### 2. Confirm startup

You should see logs showing the server is listening.

If you see:

```text
Event not found
```

then your `DEFAULT_EVENT_SLUG` does not exist in the database. Run:

```bash
npx prisma db push
npm run build
node dist/prisma/seed.js
```

Then restart the server.

### 3. Add a new row to the Google Sheet

Add a brand-new row with:

- a real name in `Full Name`
- a real email in `Email Address`

Do not reuse an existing row number. The sync logic treats new entries by sheet row number.

### 4. Wait for the poller

If `GOOGLE_SHEETS_POLL_INTERVAL_MS=5000`, wait about 5 seconds.

### 5. Check the logs

A successful run looks like:

```text
processed: 1
skipped: 0
emailsAttempted: 1
emailsSent: 1
emailFailures: 0
```

### 6. Check the email inbox

Also check Spam.

### 7. Verify in Prisma if needed

```bash
npx prisma studio
```

Check:

- `Registrant`
- `Ticket`
- `QrToken`

If email was sent successfully, `QrToken.emailedAt` will be populated.

## Common Problems

### Event not found

Cause:

- `DEFAULT_EVENT_SLUG` in `.env` does not exist in the DB

Fix:

```bash
npx prisma db push
npm run build
node dist/prisma/seed.js
```

### Google Sheets sync is not picking up rows

Check:

- `GOOGLE_SHEETS_ENABLED=true`
- sheet is shared with the service account email
- `GOOGLE_SHEETS_SPREADSHEET_ID` is correct
- `GOOGLE_SHEETS_RANGE` matches the tab name
- the added row is below the last synced row

### Email failures with `wrong version number`

Cause:

- TLS mode does not match the SMTP port

Correct Gmail config:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
```

### Email auth failures

Check:

- Gmail 2-Step Verification is enabled
- `SMTP_PASS` is an app password
- `SMTP_USER` and `EMAIL_FROM` are aligned

### Emails fail for one specific row

Check the email address in the sheet. If the row contains something invalid like `vv`, the send will fail for that row.

## API Summary

### Auth

- `POST /api/v1/auth/login`

### Sync

- `POST /api/v1/sync/google-sheets`
- `POST /api/v1/dev/load-sample-registrants`
- `POST /api/v1/dev/import-sheet-rows`

### Ticket and QR

- `POST /api/v1/tickets/issue-qr`
- `POST /api/v1/tickets/revoke-qr`
- `POST /api/v1/tickets/reissue-qr`
- `GET /api/v1/tickets/:ticketId/status`

### Gate Entry

- `POST /api/v1/scans/validate`
- `POST /api/v1/checkins/scan`
- `POST /api/v1/checkins/manual`

### Admin Search and Audit

- `GET /api/v1/registrants/lookup`
- `GET /api/v1/audit`
- `GET /api/v1/checkins/export`

## Useful Commands

Install dependencies:

```bash
npm install
```

Apply schema:

```bash
npx prisma db push
```

Generate Prisma client:

```bash
npx prisma generate
```

Seed local DB:

```bash
npm run seed
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Open Prisma Studio:

```bash
npx prisma studio
```

## Security Notes

- QR codes are bearer credentials. Serve the app over HTTPS outside local development.
- Keep `JWT_SECRET`, Google credentials, and SMTP credentials out of source control.
- Do not use local seed users in production.
- If someone copies a QR before entry, whoever presents it first can still use it.

## Limitations

- Syncing is incremental by sheet row number, not by arbitrary edits to old rows.
- Editing an already-synced row does not automatically resend a QR email.
- Offline-safe verification is not implemented.
- The Google Sheets parser is intentionally tied to a specific form structure.
