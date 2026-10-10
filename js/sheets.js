// โหลดข้อมูลจาก Google Sheets (CSV) หรือจาก sample-data/ ตอนพัฒนา
import { USE_SAMPLE, SHEET_ID, TABS } from "./config.js?v=mv2n85s8";
import { DEV, todayIso } from "./format.js?v=mv2n85s8";

// ข้อมูลจำลองทั้งเดือน (tools/simulate.js) — เฉพาะในเครื่อง: localhost:4174/?sim&today=2026-10-31
const SIM = DEV && new URLSearchParams(location.search).has("sim");

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
  if (SIM) return `sample-data/sim/${tab}.csv?t=${Date.now()}`;
  if (USE_SAMPLE) return `sample-data/${tab}.csv?t=${Date.now()}`;
  const u = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
  u.searchParams.set("tqx", "out:csv");
  // บังคับให้แถวแรกเป็นหัวคอลัมน์เสมอ — ถ้าไม่ใส่ gviz จะเดาเอง และถ้าทุกคอลัมน์เป็นข้อความ
  // (เช่นแท็บ cards) มันจะรวมแถวที่ 1+2 เป็นหัวตาราง ทำให้ข้อมูลแถวแรกหายและคอลัมน์เพี้ยนทั้งแท็บ
  u.searchParams.set("headers", "1");
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
  if (SIM) { // จำลองย้อนเวลา: ตัดข้อมูลหลัง ?today= ออก จะได้เห็นหน้าตาวันนั้นจริง ๆ
    const t = todayIso();
    return { teams, runs: runs.filter((r) => r.date <= t), config: cfg, cards: cards.filter((r) => r.date <= t), loadedAt: new Date() };
  }
  return { teams, runs, config: cfg, cards, loadedAt: new Date() };
}

// ส่งข้อมูลไป Apps Script — บางครั้ง (เน็ตมือถือสะดุด / เบราว์เซอร์ในแอป) บันทึกเข้าชีตแล้ว
// แต่คำตอบกลับมาไม่ใช่ JSON หรือหลุดกลางทาง → คืน { unknown: true } ให้หน้าเว็บไปเช็กในชีตเอง แทนการขึ้น "ส่งไม่สำเร็จ"
export async function postApi(url, payload) {
  let res, text;
  try {
    // ส่งเป็น text/plain เพื่อไม่ให้เบราว์เซอร์ยิง preflight (Apps Script ไม่รองรับ OPTIONS)
    res = await fetch(url, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow" });
    text = await res.text();
  } catch (err) {
    return { ok: false, unknown: true, error: err.message };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, unknown: true, error: `HTTP ${res.status} · ${text.slice(0, 40).replace(/\s+/g, " ")}` };
  }
}

// โหลดชีตใหม่ซ้ำ ๆ จนกว่า check(data) จะคืนค่า (สูงสุดราว 8 วินาที) — ไม่เจอคืน null
export async function confirmInSheet(check, tries = 5) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 1600));
    try {
      const hit = check(await loadAll());
      if (hit) return hit;
    } catch {}
  }
  return null;
}
