import { RegistrationSource, SheetRegistrantRow } from "./google-sheets-provider";

const sampleRows: SheetRegistrantRow[] = [
  {
    rowNumber: 2,
    timestamp: "2026-04-06T09:00:00Z",
    fullName: "Alice Johnson",
    email: "alice.johnson@example.com",
    phone: "+491701112233",
    ticketType: "VIP",
    guestCategory: "Speaker",
    tags: "vip,speaker",
  },
  {
    rowNumber: 3,
    timestamp: "2026-04-06T09:02:00Z",
    fullName: "Bob Smith",
    email: "bob.smith@example.com",
    phone: "+491701112244",
    ticketType: "Standard",
    guestCategory: "Guest",
    tags: "standard",
  },
  {
    rowNumber: 4,
    timestamp: "2026-04-06T09:05:00Z",
    fullName: "Carla Mendes",
    email: "carla.mendes@example.com",
    phone: "+491701112255",
    ticketType: "Staff",
    guestCategory: "Organizer",
    tags: "staff,crew",
  },
  {
    rowNumber: 5,
    timestamp: "2026-04-06T09:08:00Z",
    fullName: "David Lee",
    email: "david.lee@example.com",
    phone: "+491701112266",
    ticketType: "Standard",
    guestCategory: "Attendee",
    tags: "standard",
  },
  {
    rowNumber: 6,
    timestamp: "2026-04-06T09:12:00Z",
    fullName: "Emma Brown",
    email: "emma.brown@example.com",
    phone: "+491701112277",
    ticketType: "VIP",
    guestCategory: "Media",
    tags: "vip,media",
  },
];

export class SampleRegistrationSource implements RegistrationSource {
  async listRows(): Promise<SheetRegistrantRow[]> {
    return sampleRows;
  }
}
