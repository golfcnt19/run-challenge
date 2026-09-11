// โหลดข้อมูลจาก Google Sheets (CSV) หรือจาก sample-data/ ตอนพัฒนา
import { USE_SAMPLE, SHEET_ID, TABS } from "./config.js?v=mtx6fz6u";

// CSV parser เล็ก ๆ รองรับ quote, comma ในค่า, และ "" ที่หมายถึง "
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuote = false;
      } else cell += c;
    } else if (c === '"') inQuote = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// แปลงเป็น array ของ object โดยใช้แถวแรกเป็นชื่อคอลัมน์ (trim + ตัวพิมพ์เล็ก)
export function csvToObjects(text) {
  const rows = parseCsv(text).filter((r) => r.some((v) => v.trim() !== ""));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
    return o;
  });
}

function tabUrl(tab) {
  if (USE_SAMPLE) return `sample-data/${tab}.csv?t=${Date.now()}`;
  const u = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
  u.searchParams.set("tqx", "out:csv");
  u.searchParams.set("sheet", tab);
  u.searchParams.set("t", String(Date.now())); // กัน cache
  return u.toString();
}

async function fetchTab(tab) {
  const res = await fetch(tabUrl(tab), { cache: "no-store" });
  if (!res.ok) throw new Error(`โหลดแท็บ "${tab}" ไม่ได้ (${res.status})`);
  return csvToObjects(await res.text());
}

export async function loadAll() {
  const [teams, runs, config, cards] = await Promise.all([
    fetchTab(TABS.teams),
    fetchTab(TABS.runs),
    fetchTab(TABS.config),
    fetchTab(TABS.cards).catch(() => []), // แท็บการ์ดยังไม่มีก็ใช้งานได้
  ]);
  const cfg = {};
  for (const r of config) if (r.key) cfg[r.key] = r.value;
  return { teams, runs, config: cfg, cards, loadedAt: new Date() };
}
