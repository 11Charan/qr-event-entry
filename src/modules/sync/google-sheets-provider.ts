import { google } from "googleapis";
import { env } from "../../config/env";

export type SheetRegistrantRow = {
  rowNumber: number;
  timestamp?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  ticketType?: string;
  guestCategory?: string;
  tags?: string;
};

export interface RegistrationSource {
  listRows(): Promise<SheetRegistrantRow[]>;
}

function normalizeHeader(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function valueAt(row: string[], headers: Map<string, number>, headerName: string) {
  const index = headers.get(normalizeHeader(headerName));
  return index === undefined ? undefined : row[index];
}

function buildTags(input: {
  organization?: string;
  fieldOfStudy?: string;
  highestStudyLevel?: string;
  aiCloudExperience?: string;
  workshopInterest?: string;
  heardFrom?: string;
}) {
  const tags: string[] = [];

  if (input.organization) {
    tags.push(`org:${input.organization}`);
  }

  if (input.fieldOfStudy) {
    tags.push(`stream:${input.fieldOfStudy}`);
  }

  if (input.highestStudyLevel) {
    tags.push(`study_level:${input.highestStudyLevel}`);
  }

  if (input.aiCloudExperience) {
    tags.push(`ai_cloud_experience:${input.aiCloudExperience}`);
  }

  if (input.workshopInterest) {
    tags.push(`workshop_interest:${input.workshopInterest}`);
  }

  if (input.heardFrom) {
    tags.push(`source:${input.heardFrom}`);
  }

  return tags.join(" | ");
}

export class GoogleSheetsRegistrationSource implements RegistrationSource {
  async listRows(): Promise<SheetRegistrantRow[]> {
    if (!env.GOOGLE_SHEETS_CLIENT_EMAIL || !env.GOOGLE_SHEETS_PRIVATE_KEY || !env.GOOGLE_SHEETS_SPREADSHEET_ID) {
      return [];
    }

    const auth = new google.auth.JWT({
      email: env.GOOGLE_SHEETS_CLIENT_EMAIL,
      key: env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
      range: env.GOOGLE_SHEETS_RANGE,
    });

    const rows = response.data.values ?? [];
    const headerRow = rows[0] ?? [];
    const headers = new Map(headerRow.map((header, index) => [normalizeHeader(header), index]));

    return rows.slice(1).map((row, index) => ({
      rowNumber: index + 2,
      timestamp: valueAt(row, headers, "Timestamp"),
      email: valueAt(row, headers, "Email Address"),
      fullName: valueAt(row, headers, "Full Name"),
      phone: valueAt(row, headers, "Phone Number"),
      ticketType: "standard",
      guestCategory: valueAt(row, headers, "Would you like to participate in the workshop?")?.toLowerCase().includes("yes")
        ? "workshop"
        : "attendee",
      tags: buildTags({
        organization: valueAt(row, headers, "University / Organization Name"),
        fieldOfStudy: valueAt(row, headers, "Field of Study / Stream(If Student)"),
        highestStudyLevel: valueAt(row, headers, "Highest Level of Study"),
        aiCloudExperience: valueAt(row, headers, "Do you have prior experience in AI/Cloud?"),
        workshopInterest: valueAt(row, headers, "Would you like to participate in the workshop?"),
        heardFrom: valueAt(row, headers, "How did you hear about this event?"),
      }),
    }));
  }
}
