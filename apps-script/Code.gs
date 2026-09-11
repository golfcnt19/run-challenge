// Run Challenge — ตัวรับข้อมูลจากหน้า entry.html  (Google Apps Script ผูกกับชีต)
//
// วิธีติดตั้ง (ทำครั้งเดียว):
//   1. เปิดชีต → เมนู ส่วนขยาย (Extensions) → Apps Script
//   2. ลบโค้ดเดิม วางไฟล์นี้ทั้งไฟล์ → แก้ PIN ด้านล่าง → บันทึก (Ctrl+S)
//   3. ปุ่ม "ทำให้ใช้งานได้" (Deploy) → การทำให้ใช้งานได้ใหม่ (New deployment)
//        ประเภท: เว็บแอป (Web app)
//        ดำเนินการในฐานะ: ฉัน (Me)
//        ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน (Anyone)
//      → กด Deploy → อนุญาตสิทธิ์ → ก๊อป "URL ของเว็บแอป" (ลงท้าย /exec) ไปวางใน js/config.js ที่ ENTRY_URL
//   ถ้าแก้โค้ดภายหลัง ต้อง Deploy → จัดการการทำให้ใช้งานได้ → แก้ไข → เวอร์ชันใหม่ ไม่งั้น URL เดิมจะยังรันโค้ดเก่า

// ── PIN ของแต่ละทีม (แก้ได้เลย) ─────────────────────────────────────
// หัวหน้าทีมใช้ PIN ของทีมตัวเองกรอกได้เฉพาะสมาชิกในทีม   ADMIN กรอกให้ทีมไหนก็ได้
const PINS = {
  A: "1111",
  B: "2222",
  C: "3333",
  D: "4444",
  E: "5555",
  F: "6666",
  G: "7777",
  ADMIN: "9999",
};

const SHEET_RUNS = "runs";
const SHEET_TEAMS = "teams";
const SHEET_CONFIG = "config";

// ── HTTP ─────────────────────────────────────────────────────────────
function doGet() {
  return json_({ ok: true, service: "run-challenge", time: new Date().toISOString() });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents || "{}");
  } catch (err) {
    return json_({ ok: false, error: "อ่านข้อมูลไม่ออก" });
  }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    return json_(body.action === "delete" ? deleteEntry_(body) : addEntry_(body));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ── ตรรกะ ────────────────────────────────────────────────────────────
// ตรวจทีม + PIN + ชื่อสมาชิก (ใช้ร่วมกันทั้งเพิ่มและลบ) คืน {error} หรือ {team, teamId, member, isAdmin}
function authorize_(b, teams) {
  const teamId = String(b.team_id || "").trim().toUpperCase();
  const pin = String(b.pin || "").trim();
  const team = teams[teamId];
  if (!team) return { error: "ไม่พบทีม " + teamId };
  const isAdmin = PINS.ADMIN && pin === PINS.ADMIN;
  if (!isAdmin && pin !== PINS[teamId]) return { error: "PIN ไม่ถูกต้อง", code: "PIN" };
  const runner = String(b.runner || "").trim();
  const member = team.members.find((m) => m.toLowerCase() === runner.toLowerCase());
  if (!member) return { error: runner + " ไม่ได้อยู่ในทีม " + teamId };
  return { team: team, teamId: teamId, member: member, isAdmin: isAdmin };
}

// ลบรายการที่ตรงกับ date + runner + activity + amount (ถ้าซ้ำหลายแถว ลบแถวล่างสุด)
function deleteEntry_(b) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const auth = authorize_(b, readTeams_(ss));
  if (auth.error) return { ok: false, error: auth.error, code: auth.code };

  const date = normalizeDate_(b.date);
  const activity = normalizeActivity_(b.activity);
  const amount = Number(String(b.amount || "").replace(/,/g, ""));
  if (!date || !activity || !isFinite(amount)) return { ok: false, error: "ข้อมูลรายการไม่ครบ" };

  const sh = ss.getSheetByName(SHEET_RUNS);
  if (!sh) return { ok: false, error: "ไม่พบแท็บ " + SHEET_RUNS };
  const last = sh.getLastRow();
  if (last < 2) return { ok: false, error: "ไม่พบรายการ" };
  const rows = sh.getRange(2, 1, last - 1, 4).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const rDate = r[0] instanceof Date ? Utilities.formatDate(r[0], "Asia/Bangkok", "yyyy-MM-dd") : normalizeDate_(r[0]);
    if (rDate !== date) continue;
    if (String(r[1]).trim().toLowerCase() !== auth.member.toLowerCase()) continue;
    if (normalizeActivity_(r[2]) !== activity) continue;
    if (Math.abs(Number(String(r[3]).replace(/,/g, "")) - amount) > 0.005) continue;
    sh.deleteRow(i + 2);
    return { ok: true, row: i + 2 };
  }
  return { ok: false, error: "ไม่พบรายการนี้ในชีต (อาจถูกลบไปแล้ว)" };
}

function addEntry_(b) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const teams = readTeams_(ss);
  const config = readConfig_(ss);

  const auth = authorize_(b, teams);
  if (auth.error) return { ok: false, error: auth.error, code: auth.code };
  const teamId = auth.teamId, member = auth.member, isAdmin = auth.isAdmin;

  const date = normalizeDate_(b.date);
  if (!date) return { ok: false, error: "วันที่ไม่ถูกต้อง" };
  if (config.start_date && date < config.start_date) return { ok: false, error: "วันที่ก่อนเริ่มกิจกรรม (" + config.start_date + ")" };
  if (config.end_date && date > config.end_date) return { ok: false, error: "วันที่หลังจบกิจกรรม (" + config.end_date + ")" };
  const today = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
  if (date > today) return { ok: false, error: "กรอกล่วงหน้าไม่ได้" };

  const activity = normalizeActivity_(b.activity);
  if (!activity) return { ok: false, error: "กิจกรรมไม่ถูกต้อง" };

  const amount = Number(String(b.amount || "").replace(/,/g, ""));
  if (!isFinite(amount) || amount <= 0) return { ok: false, error: "จำนวนต้องมากกว่า 0" };
  if (activity === "walk" && amount > 100000) return { ok: false, error: "จำนวนก้าวมากผิดปกติ" };
  if (activity !== "walk" && amount > 300) return { ok: false, error: "ระยะทางมากผิดปกติ" };

  const note = String(b.note || "").trim().slice(0, 200);

  const sh = ss.getSheetByName(SHEET_RUNS);
  if (!sh) return { ok: false, error: "ไม่พบแท็บ " + SHEET_RUNS };
  ensureHeaders_(sh);

  // กันกรอกเกินเพดาน: ถ้าวันนั้นคนนี้ได้ครบ daily_cap แล้ว ไม่รับเพิ่ม
  const cap = parseFloat(config.daily_cap) || 5;
  const have = dayRawPoints_(sh, member, date, config);
  if (have >= cap) return { ok: false, error: member + " ได้ครบ " + cap + " คะแนนของวัน " + date + " แล้ว กรอกเพิ่มไม่ได้" };
  // คอลัมน์ date เป็นข้อความ เพื่อไม่ให้ชีตแปลงเป็นวันที่แล้ว export ผิดรูปแบบ
  const stamp = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss"); // เวลาไทยเสมอ ไม่ขึ้นกับ timezone ของโปรเจกต์
  sh.appendRow([date, member, activity, amount, note, stamp, teamId + (isAdmin ? " (admin)" : "")]);
  const row = sh.getLastRow();
  sh.getRange(row, 1).setNumberFormat("@");

  return { ok: true, row: row, entry: { date: date, runner: member, activity: activity, amount: amount, note: note } };
}

// คะแนนดิบรวมของคน+วัน จากแถวที่มีอยู่ (สูตรเดียวกับ js/scoring.js)
function dayRawPoints_(sh, member, date, config) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const cap = parseFloat(config.daily_cap) || 5;
  const perKm = parseFloat(config.points_per_run_km) || 1;
  const walkFull = parseFloat(config.walk_steps_for_full) || 10000;
  const bikeFull = parseFloat(config.bike_km_for_full) || 20;
  const rows = sh.getRange(2, 1, last - 1, 4).getValues();
  let sum = 0;
  for (const r of rows) {
    const d = r[0] instanceof Date ? Utilities.formatDate(r[0], "Asia/Bangkok", "yyyy-MM-dd") : normalizeDate_(r[0]);
    if (d !== date || String(r[1]).trim().toLowerCase() !== member.toLowerCase()) continue;
    const a = normalizeActivity_(r[2]);
    const n = Number(String(r[3]).replace(/,/g, "")) || 0;
    if (a === "run" || a === "treadmill") sum += n * perKm;
    else if (a === "walk") sum += (n / walkFull) * cap;
    else if (a === "bike") sum += (n / bikeFull) * cap;
  }
  return sum;
}

function ensureHeaders_(sh) {
  const want = ["date", "runner", "activity", "amount", "note", "submitted_at", "submitted_by"];
  const have = sh.getRange(1, 1, 1, want.length).getValues()[0];
  want.forEach((h, i) => {
    if (!have[i]) sh.getRange(1, i + 1).setValue(h);
  });
}

function readTeams_(ss) {
  const sh = ss.getSheetByName(SHEET_TEAMS);
  if (!sh) throw new Error("ไม่พบแท็บ " + SHEET_TEAMS);
  const rows = sh.getDataRange().getValues();
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const iId = head.indexOf("team_id"), iM = head.indexOf("members");
  const out = {};
  rows.slice(1).forEach((r) => {
    const id = String(r[iId] || "").trim().toUpperCase();
    if (!id) return;
    out[id] = { members: String(r[iM] || "").split(",").map((s) => s.trim()).filter(Boolean) };
  });
  return out;
}

function readConfig_(ss) {
  const sh = ss.getSheetByName(SHEET_CONFIG);
  const out = {};
  if (!sh) return out;
  sh.getDataRange().getValues().slice(1).forEach((r) => {
    const k = String(r[0] || "").trim();
    if (!k) return;
    let v = r[1];
    if (v instanceof Date) v = Utilities.formatDate(v, "Asia/Bangkok", "yyyy-MM-dd");
    out[k] = String(v).trim();
  });
  return out;
}

function normalizeDate_(s) {
  const v = String(s || "").trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(v))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return null;
  if (y > 2400) y -= 543;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const p = (n) => (n < 10 ? "0" : "") + n;
  return y + "-" + p(mo) + "-" + p(d);
}

function normalizeActivity_(s) {
  const v = String(s || "").trim().toLowerCase();
  const map = {
    run: ["run", "วิ่ง", "วิ่งสวน", "outdoor", "road"],
    treadmill: ["treadmill", "วิ่งลู่", "ลู่", "ลู่วิ่ง"],
    walk: ["walk", "เดิน", "steps", "ก้าว"],
    bike: ["bike", "ปั่น", "ปั่นจักรยาน", "จักรยาน", "cycling", "cycle", "ride"],
  };
  for (const k in map) if (map[k].indexOf(v) >= 0) return k;
  return null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
