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
//
// การ์ดพิเศษ: ต้องมีแท็บ "cards" ในชีต (สร้างแท็บเปล่าชื่อ cards สคริปต์จะใส่หัวคอลัมน์ให้เอง)

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
const SHEET_CARDS = "cards";
const CARD_TYPES = ["carry", "x2", "block"];
// กิจกรรมที่กรอกเป็นนาที (สูตรเดียวกันหมด: sport_minutes_for_full นาที = เต็มวัน) — ต้องตรงกับ ACTIVITIES ใน js/scoring.js
const TIMED_ACTIVITIES = ["badminton", "tennis", "football", "swim", "basketball", "gym", "yoga", "jumprope"];

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
    if (body.action === "delete") return json_(deleteEntry_(body));
    if (body.action === "card") return json_(useCard_(body));
    return json_(addEntry_(body));
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
  const timed = TIMED_ACTIVITIES.indexOf(activity) >= 0;
  if (activity === "walk" && amount > 100000) return { ok: false, error: "จำนวนก้าวมากผิดปกติ" };
  if (timed && amount > 600) return { ok: false, error: "เวลาเกิน 10 ชั่วโมง ผิดปกติ" };
  if (timed && amount < (parseFloat(config.sport_min_minutes) || 15)) return { ok: false, error: "กีฬาต้องอย่างน้อย " + (parseFloat(config.sport_min_minutes) || 15) + " นาทีถึงจะนับ" };
  if (!timed && activity !== "walk" && amount > 300) return { ok: false, error: "ระยะทางมากผิดปกติ" };

  const note = String(b.note || "").trim().slice(0, 200);

  const sh = ss.getSheetByName(SHEET_RUNS);
  if (!sh) return { ok: false, error: "ไม่พบแท็บ " + SHEET_RUNS };
  ensureHeaders_(sh);

  // 1 คน ส่งได้ 1 กิจกรรมต่อวัน (ทำใต้ lock ของ doPost อยู่แล้ว ส่งพร้อมกันไม่หลุด)
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const vals = sh.getRange(2, 1, lastRow - 1, 2).getValues();
    for (let i = 0; i < vals.length; i++) {
      const rDate = vals[i][0] instanceof Date ? Utilities.formatDate(vals[i][0], "Asia/Bangkok", "yyyy-MM-dd") : normalizeDate_(vals[i][0]);
      if (rDate === date && String(vals[i][1]).trim().toLowerCase() === member.toLowerCase())
        return { ok: false, error: member + " ส่งผลของวันที่ " + date + " ไปแล้ว (1 คน 1 กิจกรรม/วัน) — ถ้ากรอกผิด ให้ลบรายการเดิมก่อนแล้วกรอกใหม่", code: "DAY_TAKEN" };
    }
  }

  // คอลัมน์ date เป็นข้อความ เพื่อไม่ให้ชีตแปลงเป็นวันที่แล้ว export ผิดรูปแบบ
  const stamp = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss"); // เวลาไทยเสมอ ไม่ขึ้นกับ timezone ของโปรเจกต์
  sh.appendRow([date, member, activity, amount, note, stamp, teamId + (isAdmin ? " (admin)" : "")]);
  const row = sh.getLastRow();
  sh.getRange(row, 1).setNumberFormat("@");

  return { ok: true, row: row, entry: { date: date, runner: member, activity: activity, amount: amount, note: note } };
}


// ── การ์ดพิเศษ ───────────────────────────────────────────────────────
// ทีมละ 3 ใบ/วีค (จันทร์–อาทิตย์) ชนิดละ 1 ใบ · วันละ 1 ใบ · ใช้กับวันนี้ (เวลาไทย) เท่านั้น
//   carry: runner = ผู้ให้, target_runner = ผู้รับ (ทีมเดียวกัน)
//   x2:    สคริปต์สุ่มสมาชิกในทีมเอง (client ไม่ส่งชื่อ)
//   block: target_team + target_runner (ทีมอื่น)
function useCard_(b) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const teams = readTeams_(ss);
  const config = readConfig_(ss);

  const teamId = String(b.team_id || "").trim().toUpperCase();
  const pin = String(b.pin || "").trim();
  const team = teams[teamId];
  if (!team) return { ok: false, error: "ไม่พบทีม " + teamId };
  const isAdmin = PINS.ADMIN && pin === PINS.ADMIN;
  if (!isAdmin && pin !== PINS[teamId]) return { ok: false, error: "PIN ไม่ถูกต้อง", code: "PIN" };

  const card = String(b.card || "").trim().toLowerCase();
  if (CARD_TYPES.indexOf(card) < 0) return { ok: false, error: "ไม่รู้จักการ์ด " + card };

  const today = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
  if (config.start_date && today < config.start_date) return { ok: false, error: "ยังไม่ถึงวันเริ่มกิจกรรม" };
  if (config.end_date && today > config.end_date) return { ok: false, error: "กิจกรรมจบแล้ว" };

  const sh = ss.getSheetByName(SHEET_CARDS);
  if (!sh) return { ok: false, error: "ไม่พบแท็บ " + SHEET_CARDS + " (แอดมินต้องสร้างก่อน)" };
  ensureCardHeaders_(sh);

  // โควตา: วันนี้ยังไม่ใช้ และวีคนี้ยังไม่ใช้ชนิดนี้
  const week = weekKey_(today);
  const last = sh.getLastRow();
  const rows = last >= 2 ? sh.getRange(2, 1, last - 1, 6).getValues() : [];
  for (const r of rows) {
    const d = r[0] instanceof Date ? Utilities.formatDate(r[0], "Asia/Bangkok", "yyyy-MM-dd") : normalizeDate_(r[0]);
    if (!d || String(r[1]).trim().toUpperCase() !== teamId) continue;
    if (d === today) return { ok: false, error: "วันนี้ทีม " + teamId + " ใช้การ์ดไปแล้ว 1 ใบ (วันละใบ)" };
    if (weekKey_(d) === week && String(r[2]).trim().toLowerCase() === card) return { ok: false, error: "วีคนี้ใช้การ์ด " + card + " ไปแล้ว (" + d + ")" };
  }

  let runner = "", targetTeam = "", targetRunner = "";
  if (card === "carry") {
    runner = findMember_(team, b.runner);
    targetRunner = findMember_(team, b.target_runner);
    if (!runner || !targetRunner) return { ok: false, error: "เดอะแบก: ต้องเลือกผู้ให้และผู้รับที่อยู่ในทีม " + teamId };
    if (runner === targetRunner) return { ok: false, error: "เดอะแบก: ผู้ให้กับผู้รับต้องคนละคน" };
  } else if (card === "x2") {
    runner = team.members[Math.floor(Math.random() * team.members.length)];
  } else {
    targetTeam = String(b.target_team || "").trim().toUpperCase();
    const tt = teams[targetTeam];
    if (!tt) return { ok: false, error: "block: ไม่พบทีม " + targetTeam };
    if (targetTeam === teamId) return { ok: false, error: "block ทีมตัวเองไม่ได้" };
    targetRunner = findMember_(tt, b.target_runner);
    if (!targetRunner) return { ok: false, error: "block: ไม่พบชื่อ " + b.target_runner + " ในทีม " + targetTeam };
    // 1 คนโดน block ได้ 1 วัน/วีค (จากทีมไหนก็ได้) · วันเดียวกันซ้อนได้ (มีผลใบเดียว เสียทุกใบ ไม่รู้กัน) — ไม่บอกว่าทีมไหน
    for (const r of rows) {
      const d = r[0] instanceof Date ? Utilities.formatDate(r[0], "Asia/Bangkok", "yyyy-MM-dd") : normalizeDate_(r[0]);
      if (!d || d === today || weekKey_(d) !== week || String(r[2]).trim().toLowerCase() !== "block") continue;
      if (String(r[5]).trim().toLowerCase() === targetRunner.toLowerCase())
        return { ok: false, error: targetRunner + " โดน block ไปแล้ววีคนี้ (1 คนโดนได้ 1 ครั้ง/วีค) — เลือกคนอื่น การ์ดยังไม่เสีย", code: "BLOCKED_WEEK" };
    }
  }

  const stamp = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
  sh.appendRow([today, teamId, card, runner, targetTeam, targetRunner, stamp + (isAdmin ? " (admin)" : "")]);
  sh.getRange(sh.getLastRow(), 1).setNumberFormat("@");
  return { ok: true, card: { date: today, team_id: teamId, card: card, runner: runner, target_team: targetTeam, target_runner: targetRunner } };
}

function findMember_(team, name) {
  const n = String(name || "").trim().toLowerCase();
  return team.members.find((m) => m.toLowerCase() === n) || "";
}

// วันจันทร์ของสัปดาห์ (วีคเริ่มจันทร์) — สูตรเดียวกับ js/scoring.js weekKey()
function weekKey_(iso) {
  const p = iso.split("-").map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  const pad = (n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function ensureCardHeaders_(sh) {
  const want = ["date", "team_id", "card", "runner", "target_team", "target_runner", "submitted_at"];
  const have = sh.getRange(1, 1, 1, want.length).getValues()[0];
  want.forEach((h, i) => { if (!have[i]) sh.getRange(1, i + 1).setValue(h); });
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
    badminton: ["badminton", "แบด", "แบดมินตัน", "ตีแบด"],
    tennis: ["tennis", "เทนนิส"],
    football: ["football", "soccer", "ฟุตบอล", "บอล", "เตะบอล", "เตะฟุตบอล"],
    swim: ["swim", "swimming", "ว่ายน้ำ", "ว่าย"],
    basketball: ["basketball", "บาส", "บาสเกตบอล"],
    gym: ["gym", "ฟิตเนส", "ยิม", "เข้ายิม", "เวท", "เล่นเวท", "weight", "fitness", "workout"],
    yoga: ["yoga", "โยคะ", "เล่นโยคะ", "พิลาทิส", "pilates"],
    jumprope: ["jumprope", "jump rope", "skipping", "skip rope", "กระโดดเชือก", "เชือกกระโดด", "โดดเชือก"],
  };
  for (const k in map) if (map[k].indexOf(v) >= 0) return k;
  return null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
