export const seatFields = {
  building: "ساختمان", floor: "طبقه", capacity: "ظرفیت قابل استفاده", people: "تعداد افراد نیازمند سیت",
  free: "تعداد سیت خالی", seat: "شناسه سیت", status: "وضعیت سیت", occupant: "شخص مستقر (خالی یعنی آزاد)",
} as const;

export type SeatField = keyof typeof seatFields;
export type SeatMapping = Partial<Record<SeatField, string>> & { mode: "counts" | "seats" };
export type SeatMappings = Record<string, SeatMapping>;
export interface SeatSource {
  id: string;
  name: string;
  columns: string[];
  mapping: SeatMapping;
}
export interface SeatStep {
  place: string;
  released: number;
  remaining: number;
  spare: number;
}
export interface SeatScenario { label: string; steps: SeatStep[]; next?: { place: string; shortfall: number } }
export interface SeatReport {
  kind: "seating";
  sources: SeatSource[];
  answer: string;
  scenarios: SeatScenario[];
}
