import { RegistrationSource, SheetRegistrantRow } from "./google-sheets-provider";

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

function splitLine(line: string) {
  return line.split("\t").map((cell) => cell.trim());
}

export class PastedSheetRegistrationSource implements RegistrationSource {
  constructor(private readonly rowsText: string) {}

  async listRows(): Promise<SheetRegistrantRow[]> {
    const lines = this.rowsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return [];
    }

    const headerRow = splitLine(lines[0]);
    const headers = new Map(headerRow.map((header, index) => [normalizeHeader(header), index]));

    return lines.slice(1).map((line, index) => {
      const row = splitLine(line);
      const workshopInterest = valueAt(row, headers, "Would you like to participate in the workshop?");

      return {
        rowNumber: index + 2,
        timestamp: valueAt(row, headers, "Timestamp"),
        email: valueAt(row, headers, "Email Address"),
        fullName: valueAt(row, headers, "Full Name"),
        phone: valueAt(row, headers, "Phone Number"),
        ticketType: "standard",
        guestCategory: workshopInterest?.toLowerCase().includes("yes") ? "workshop" : "attendee",
        tags: buildTags({
          organization: valueAt(row, headers, "University / Organization Name"),
          fieldOfStudy: valueAt(row, headers, "Field of Study / Stream(If Student)"),
          highestStudyLevel: valueAt(row, headers, "Highest Level of Study"),
          aiCloudExperience: valueAt(row, headers, "Do you have prior experience in AI/Cloud?"),
          workshopInterest,
          heardFrom: valueAt(row, headers, "How did you hear about this event?"),
        }),
      };
    });
  }
}
