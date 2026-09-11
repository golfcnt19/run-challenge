// ฟังก์ชันจัดรูปแบบ วันที่ไทย / ตัวเลข

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_DAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

// รับ "YYYY-MM-DD" → Date ตามเวลาเครื่อง (ไม่ใช่ UTC) เพื่อไม่ให้วันเลื่อน
export function parseDate(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

// รับวันที่ที่ Google Sheets อาจส่งมาหลายแบบ → "YYYY-MM-DD" หรือ null ถ้าอ่านไม่ออก
//   2026-09-15 · 2026-9-5 · 15/9/2026 · 15/09/2569 (พ.ศ.) · 9/15/2026 ถูกตีความเป็น d/m ก่อน ถ้าไม่ใช่ค่อยลอง m/d
export function normalizeDate(s) {
  const v = String(s || "").trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v);
  let y, mo, d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(v))) {
    [d, mo, y] = [+m[1], +m[2], +m[3]];
    if (d <= 12 && mo > 12) [d, mo] = [mo, d]; // ต้องเป็น m/d/y แน่ ๆ
  } else return null;
  if (y > 2400) y -= 543;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}`;
}

export function toIso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayIso() {
  return toIso(new Date());
}

export function addDays(iso, n) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

// จำนวนวันจาก a ถึง b นับรวมทั้งสองวัน
export function daysInclusive(a, b) {
  const da = parseDate(a), db = parseDate(b);
  return Math.round((db - da) / 86400000) + 1;
}

export function fmtDateShort(iso) {
  const d = parseDate(iso);
  return d ? `${d.getDate()} ${TH_MONTHS[d.getMonth()]}` : iso;
}

export function fmtDateLong(iso) {
  const d = parseDate(iso);
  return d ? `${TH_DAYS[d.getDay()]} ${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}` : iso;
}

export function fmtTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtNum(n, digits = 0) {
  return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// คะแนนแสดงทศนิยม 1 ตำแหน่งเฉพาะเมื่อไม่ใช่จำนวนเต็ม
export function fmtPts(n) {
  const v = Math.round(n * 100) / 100;
  return Number.isInteger(v) ? fmtNum(v) : fmtNum(v, 2).replace(/0$/, "");
}
