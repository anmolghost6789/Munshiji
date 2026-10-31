/* India time. Bill dates, financial years and "today" follow IST, not the server's clock zone. */
const IST_OFFSET_MIN = 330;

export function istDate(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
export const istToday = () => istDate();

/** Financial year label for an IST date, e.g. 2026-10-26 → "26-27", 2027-03-31 → "26-27", 2027-04-01 → "27-28". */
export function fyLabel(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/** SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") → IST date. */
export function istDateFromSql(ts: string): string {
  return istDate(new Date(ts.replace(" ", "T") + "Z"));
}
