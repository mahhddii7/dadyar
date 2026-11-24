/** Shared cell semantics. Empty and invalid numeric cells are never treated as zero. */
export function normalizeText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/[يى]/g, "ی").replace(/ك/g, "ک")
    .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[\u200c\u0640]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isEmpty(value: unknown) {
  return value === null || value === undefined || typeof value === "string" && value.trim() === "";
}

export function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const text = normalizeText(value).replace(/٫/g, ".").replace(/٬/g, ",")
    .replace(/\s*(ریال|تومان|عدد|روز|ساعت|دقیقه|درصد)\s*$/u, "").trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return null;
  const result = Number(text.replace(/,/g, ""));
  return Number.isFinite(result) && Math.abs(result) <= Number.MAX_SAFE_INTEGER ? result : null;
}

export function cellText(value: unknown) {
  return isEmpty(value) ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function exactColumn(requested: string, columns: string[]) {
  if (columns.includes(requested)) return requested;
  const matches = columns.filter(column => normalizeText(column) === normalizeText(requested));
  if (matches.length !== 1) throw new Error(`ستون «${requested}» موجود نیست یا مبهم است. از نام دقیق ستون‌های فهرست استفاده کنید.`);
  return matches[0];
}
