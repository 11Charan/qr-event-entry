# QR Event Entry Backend

Production-oriented event check-in backend for Google Forms and Google Sheets registrations. It uses server-verified QR bearer tokens, a real database, RBAC for admin/scanner roles, transactional check-in, and auditable scan/check-in history.

## Stack

- Node.js 22
- TypeScript
- Fastify
- Prisma ORM
- SQLite for local development
- PostgreSQL-ready schema design for production migration

## Security Model

The QR payload does not contain personal data or a guessable sequential ID. Each QR contains a high-entropy random bearer token with a versioned prefix such as `evtqr_v1.<random>`. The raw token is only shown once to the user or downstream sender. The database stores only a SHA-256 hash of the token, so a database read does not directly expose valid gate credentials.

Server-side verification determines whether the token exists, belongs to the correct event, is still active, and has not already been consumed. Check-in is completed inside a database transaction with an atomic update guard on `checkedInAt`, which blocks duplicate entry caused by concurrent scans from multiple devices.

This is tamper-resistant and abuse-resistant, not magically unbreakable. If someone steals a valid QR image before entry, they can still present it first. Real events should combine server-side validation with operational controls such as staff-authenticated scanners, optional name or ID verification, and HTTPS-only deployment.

## Features

- Google Sheets registration sync through service account credentials
- Incremental row processing with sync cursor state
- Multi-event support
- Ticket types, guest categories, and tags such as VIP or staff
- QR issue, revoke, and reissue workflows
- Scanner and admin JWT login
- RBAC for `ADMIN` and `SCANNER`
- Manual lookup and manual check-in flow
- Audit logs for login, sync, scan validation, QR issuance, revocation, and check-in
- Rate limiting and input validation
- Swagger docs at `/docs`
- Test coverage for critical anti-replay flows

## Project Structure

```text
.
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/
│   ├── modules/
│   │   ├── audit/
│   │   ├── auth/
│   │   ├── checkins/
│   │   ├── events/
│   │   ├── registrants/
│   │   ├── sync/
│   │   └── tickets/
│   ├── routes/
│   ├── types/
│   └── utils/
├── tests/
├── Dockerfile
└── docker-compose.yml
```

## Setup

1. Copy `.env.example` to `.env`.
2. Set `JWT_SECRET` to a long random value.
3. For Google Sheets, create a Google Cloud service account, enable the Sheets API, and share the target sheet with the service account email.
4. Install dependencies:

```bash
npm install
```

5. Generate Prisma client and create the local database:

```bash
npx prisma db push
npm run seed
```

6. Start the API:

```bash
npm run dev
```

Swagger UI will be available at `http://localhost:3000/docs`.

## Google Sheets Expectations

The current parser is configured for this real header set:

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

Mapping behavior:

- `fullName` comes from `Full Name`
- `email` comes from the first `Email Address` match
- `phone` comes from `Phone Number`
- `ticketType` defaults to `standard`
- `guestCategory` becomes `workshop` if the workshop column contains `yes`, otherwise `attendee`
- `tags` are derived from organization, field of study, study level, AI/cloud experience, workshop interest, and referral source

If your form headers change again, update [google-sheets-provider.ts](/Users/sricharan/QR Event Entry/src/modules/sync/google-sheets-provider.ts).

Sample files are included for testing:

- [google-sheet-sample.csv](/Users/sricharan/QR%20Event%20Entry/samples/google-sheet-sample.csv)
- [google-form-responses-example.csv](/Users/sricharan/QR%20Event%20Entry/samples/google-form-responses-example.csv)

To test quickly with Google Sheets:

1. Create a new Google Sheet.
2. Import [google-sheet-sample.csv](/Users/sricharan/QR%20Event%20Entry/samples/google-sheet-sample.csv).
3. Name the tab `Form Responses 1` or update `GOOGLE_SHEETS_RANGE` in `.env`.
4. Share the sheet with your service account email.
5. Run the sync endpoint.

To test without Google APIs, copy rows directly from Google Sheets and send them to the dev import endpoint:

```bash
curl -X POST http://localhost:3000/api/v1/dev/import-sheet-rows \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d @payload.json
```

Where `payload.json` contains the tab-separated header row and data rows copied from the sheet:

```json
{
  "eventSlug": "sample-2026",
  "rowsText": "Timestamp\tEmail Address\tFull Name\tEmail Address\tPhone Number\tUniversity / Organization Name\tField of Study / Stream(If Student)\tHighest Level of Study\tDo you have prior experience in AI/Cloud?\tWould you like to participate in the workshop?\tHow did you hear about this event?\tEmail Sent\tSent At\n4/6/2026 10:00:00\talice@example.com\tAlice Johnson\talice@example.com\t+491701112233\tOpenAI University\tCSE\tUndergraduate\tYes\tYes\tInstagram\t\t"
}
```

## Default Seed Users

- `admin@example.com` / `ChangeMe123!`
- `scanner@example.com` / `ChangeMe123!`

Change both immediately outside local development.

## API Summary

### Auth

- `POST /api/v1/auth/login`

### Sync

- `POST /api/v1/sync/google-sheets`

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

## Example cURL

Login:

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}'
```

Manual Google Sheets sync:

```bash
curl -X POST http://localhost:3000/api/v1/sync/google-sheets \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"eventSlug":"sample-2026"}'
```

Issue a QR:

```bash
curl -X POST http://localhost:3000/api/v1/tickets/issue-qr \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"<TICKET_ID>"}'
```

Validate a scan:

```bash
curl -X POST http://localhost:3000/api/v1/scans/validate \
  -H "Authorization: Bearer <SCANNER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"qrPayload":"evtqr_v1.<TOKEN>","eventSlug":"sample-2026","scannerDeviceId":"gate-a"}'
```

Consume a check-in:

```bash
curl -X POST http://localhost:3000/api/v1/checkins/scan \
  -H "Authorization: Bearer <SCANNER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"qrPayload":"evtqr_v1.<TOKEN>","eventSlug":"sample-2026","scannerDeviceId":"gate-a"}'
```

## Operational Recommendations

- Require staff-authenticated scanner devices. Do not allow anonymous validation clients.
- Serve the API over HTTPS only. QR tokens are bearer credentials.
- Separate admin and scanner accounts with least privilege.
- Add anomaly alerting for repeated invalid scans from the same device or IP.
- Consider optional name or photo ID verification for higher-risk events.
- Use PostgreSQL in production and managed backups.
- Rotate JWT and QR token secrets operationally. The QR format is versioned to support this.
- If you need offline scanning later, treat it as a separate trust model with short-lived signed scan sessions and reconciliation.

## Limitations

- A copied QR can still be used by whoever reaches the gate first.
- Full offline-safe verification is not implemented in this MVP.
- Email delivery is a placeholder. Integrate SES, Resend, SendGrid, or similar for production QR delivery.
- The Google Sheets mapping is intentionally explicit and may need adjustment for your exact form columns.
