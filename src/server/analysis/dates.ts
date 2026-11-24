import { isValidJalaaliDate, toGregorian } from "jalaali-js";
import { normalizeText } from "./values";

export function dateValue(value: unknown, calendar: "jalali" | "gregorian"): number | null {
  if (typeof value !== "string") return null;
  const text = normalizeText(value);
  const parts = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[t ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?(z|[+-]\d{2}:\d{2})?$/i);
  if (!parts) return null;
  let year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const hour = Number(parts[4] ?? 0), minute = Number(parts[5] ?? 0), second = Number(parts[6] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (calendar === "jalali") {
    if (year < 1200 || year > 1633 || !isValidJalaaliDate(year, month, day) || parts[7]) return null;
    const date = toGregorian(year, month, day); year = date.gy; month = date.gm; day = date.gd;
  } else if (year < 1800 || year > 2256) return null;
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (parts[7] && parts[7] !== "z") {
    const offset = parts[7].match(/^([+-])(\d{2}):(\d{2})$/)!;
    if (Number(offset[2]) > 23 || Number(offset[3]) > 59) return null;
    return timestamp - (offset[1] === "+" ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60000;
  }
  return timestamp;
}
