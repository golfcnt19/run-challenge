// หน้ากรอกผล — โหลดรายชื่อทีม+รายการจากชีต (อ่านอย่างเดียว) แล้วส่งเพิ่ม/ลบไป Apps Script
import { loadAll, postApi, confirmInSheet } from "./sheets.js?v=mv2jrsaq";
import { computeScores, ACTIVITIES, TIMED, act, rawPoints, normalizeActivity, revealState } from "./scoring.js?v=mv2jrsaq";
import { fmtDateShort, fmtNum, todayIso, normalizeDate } from "./format.js?v=mv2jrsaq";
import { verifyTeamPin } from "./auth.js?v=mv2jrsaq";
import { ENTRY_URL } from "./config.js?v=mv2jrsaq";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// จำเฉพาะทีมที่เลือกล่าสุด — PIN ไม่จำ ต้องใส่ทุกครั้ง
const LS = { team: "rc-entry-team" };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

let teams = [];
let scored = null; // ผลคำนวณเต็มจาก computeScores (ใช้การ์ดสรุปทีมของฉัน)
let rules = null;
let entries = []; // ทุกรายการจากชีต (เรียงใหม่→เก่า) — อัปเดตในเครื่องเมื่อเพิ่ม/ลบ
let sinceDate = ""; // วันแรกของช่วง 7 วันหลังสุด
let unlockedTeam = ""; // ทีมที่ใส่ PIN ถูกแล้วในแท็บนี้ — ดูข้อมูลได้เฉพาะทีมนี้
let teamId = store.get(LS.team) || "";
let activity = "run";
const RECENT_DAYS = 7; // แสดงรายการของทีมเฉพาะ 7 วันหลังสุด
const AMOUNT = {
  run:       { label: "ระยะทาง (กม.)", step: "0.01", ph: "เช่น 5.2",   hint: (r) => `1 กม. = ${r.pointsPerRunKm} คะแนน · เพดาน ${r.dailyCap}/วัน` },
  treadmill: { label: "ระยะทาง (กม.)", step: "0.01", ph: "เช่น 3",     hint: (r) => `ถ่ายรูปคู่ลู่ให้เห็นระยะส่งในกลุ่ม · 1 กม. = ${r.pointsPerRunKm} คะแนน` },
  walk:      { label: "จำนวนก้าว",     step: "1",    ph: "เช่น 8500",  hint: (r) => `${fmtNum(r.walkStepsForFull)} ก้าว = ${r.dailyCap} คะแนน (คิดตามสัดส่วน)` },
  bike:      { label: "ระยะทาง (กม.)", step: "0.1",  ph: "เช่น 15",    hint: (r) => `${fmtNum(r.bikeKmForFull)} กม. = ${r.dailyCap} คะแนน (คิดตามสัดส่วน)` },
};
const SPORT = { label: "เวลาที่เล่น (นาที)", step: "1", ph: "เช่น 60", hint: (r) => `${fmtNum(r.sportMinutesForFull)} นาที = ${r.dailyCap} คะแนน (คิดตามสัดส่วน) · ต่ำกว่า ${fmtNum(r.sportMinMinutes)} นาทีไม่นับ` };
for (const k of TIMED) AMOUNT[k] = SPORT;

async function init() {
  $("setup").hidden = Boolean(ENTRY_URL);
  $("date").value = todayIso();
  $("date").max = todayIso();
  try {
    const data = await loadAll();
    scored = computeScores(data);
    rules = scored.rules;
    teams = scored.teams.map((t) => ({ id: t.id, name: t.name, color: t.color, members: t.members }));
    entries = scored.entries.map((e) => ({ date: e.date, runner: e.runner, teamId: e.team.id, activity: e.activity, amount: e.amount, note: e.note }));
    sinceDate = scored.days.length ? scored.days[Math.max(0, scored.days.length - RECENT_DAYS)] : "";
    $("range").textContent = `${rules.title} · ${fmtDateShort(rules.startDate)} – ${fmtDateShort(rules.endDate)}`;
    $("date").min = rules.startDate;
    if (!teams.some((t) => t.id === teamId)) teamId = "";
    renderChips();
    renderRunners();
    renderMyTeam();
    renderRecent();
    setActivity(activity);
    // ลิงก์ไปตารางคะแนน: โชว์เฉพาะวันที่เปิดให้ทุกคนดู (แอดมินเข้า board.html ตรง ๆ แล้วใส่รหัส)
    if (revealState(rules).public) $("board-link").hidden = false;
  } catch (e) {
    showError(`โหลดรายชื่อทีมไม่ได้: ${e.message}`);
  }
}

function renderChips() {
  $("team-chips").innerHTML = [...teams]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => `<button type="button" class="chip ${t.id === teamId ? "is-active" : ""}" style="--team:${esc(t.color)}" data-team="${esc(t.id)}">${esc(t.name)}</button>`)
    .join("");
}

function renderRunners() {
  const t = teams.find((x) => x.id === teamId);
  const sel = $("runner");
  sel.innerHTML = t
    ? `<option value="">— เลือกชื่อ —</option>` + t.members.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")
    : `<option value="">— เลือกทีมก่อน —</option>`;
  sel.disabled = !t;
  if (rules) renderDayHint(); // เปลี่ยนทีม → ชื่อรีเซ็ต ปุ่มบันทึกต้องกลับมากดได้
}

function entryHtml(e, idx) {
  const a = act(e.activity);
  return `<li data-idx="${idx}">
    <span class="d">${fmtDateShort(e.date)}</span><span>${esc(e.runner)}</span>${e.note ? `<span class="note">${esc(e.note)}</span>` : ""}
    <span class="a">${a.icon} ${fmtNum(e.amount, a.timed || e.activity === "walk" ? 0 : 2)} ${a.unit}</span>
    <button type="button" class="btn-del" data-del="${idx}" aria-label="ลบรายการ">🗑</button>
  </li>`;
}

// สรุปทีมของฉัน — เห็นเฉพาะทีมตัวเอง ไม่มีอันดับ/ไม่เห็นทีมอื่น
function renderMyTeam() {
  const t = teamId && teamId === unlockedTeam && scored && scored.teams.find((x) => x.id === teamId);
  $("myteam-card").hidden = !t;
  if (!t) return;
  const today = todayIso();
  const sent = t.members.filter((m) => entries.some((x) => x.runner === m && x.date === today));
  $("myteam-name").innerHTML = `<span class="dot-badge mini" style="--team:${esc(t.color)}">${esc(t.id)}</span> ${esc(t.name)}`;
  $("myteam-sub").textContent = `วันนี้ ${fmtDateShort(today)}`;
  $("myteam-stats").innerHTML = `
    <div class="stat"><b>${fmtNum(t.pts, 2)}</b><small>คะแนนทีมเรา</small></div>
    <div class="stat"><b>${sent.length}<span class="dim">/${t.members.length}</span></b><small>ส่งผลวันนี้</small></div>
    <div class="stat"><b>${t.entries}</b><small>รายการทั้งหมด</small></div>`;
  $("myteam-today").innerHTML = t.members
    .map((m) => {
      const r = t.runners.find((x) => x.name === m);
      const en = entries.find((x) => x.runner === m && x.date === today);
      const a = en && act(en.activity);
      const what = en
        ? `<span class="what">${a.icon} ${fmtNum(en.amount, a.timed || en.activity === "walk" ? 0 : 2)} ${a.unit}</span><span class="pt">${fmtNum(r ? r.days[today] || 0 : 0, 2)}</span>`
        : `<span class="what dim">ยังไม่ส่ง</span><span class="pt">—</span>`;
      return `<li class="${en ? "is-done" : ""}"><span class="tick">${en ? "✅" : "⬜"}</span><span class="nm">${esc(m)}</span>${what}</li>`;
    })
    .join("");
}

function renderRecent() {
  const t = teamId === unlockedTeam && teams.find((x) => x.id === teamId);
  $("recent-card").hidden = !t;
  $("no-team").hidden = Boolean(teamId);
  renderUnlockUi();
  if (!t) return;
  $("recent-team").textContent = t.name;
  const mine = entries.map((e, i) => [e, i]).filter(([e]) => e.teamId === teamId && e.date >= sinceDate);
  $("recent-list").innerHTML = mine.length ? mine.map(([e, i]) => entryHtml(e, i)).join("") : `<li class="empty">ยังไม่มีรายการ</li>`;
}

// รายการที่คนนั้นส่งไปแล้วในวันนั้น (1 คน 1 กิจกรรม/วัน)
const dayEntry = (runner, date) => entries.find((x) => x.runner === runner && x.date === date);
const fmtAmount = (x) => { const a = act(x.activity); return `${a.icon} ${a.label} ${fmtNum(x.amount, a.timed || x.activity === "walk" ? 0 : 2)} ${a.unit}`; };
function renderDayHint() {
  const el = $("day-hint");
  const runner = $("runner").value, date = $("date").value;
  const done = rules && runner && date ? dayEntry(runner, date) : null;
  // ยังไม่ใส่ PIN = ไม่บอกว่าใครส่งอะไรไปแล้ว (กันดูข้อมูลทีมอื่น) ปุ่มบันทึกยังกดได้
  // ถ้าซ้ำจริง เซิร์ฟเวอร์จะปฏิเสธเองด้วย code DAY_TAKEN
  if (teamId !== unlockedTeam) {
    $("submit").disabled = false;
    return (el.hidden = true);
  }
  $("submit").disabled = Boolean(done);
  if (!done) return (el.hidden = true);
  const p = Math.min(rawPoints(done.activity, done.amount, rules), rules.dailyCap);
  el.hidden = false;
  el.className = "hint day-hint is-full";
  el.textContent = `${runner} ส่งของวัน ${fmtDateShort(date)} แล้ว: ${fmtAmount(done)} = ${fmtNum(p, 2)} คะแนน · 1 คน 1 กิจกรรม/วัน — ถ้ากรอกผิด ลบรายการเดิมด้านล่างก่อน`;
}

// ปุ่ม "ดูข้อมูลทีมของฉัน" — โชว์เมื่อเลือกทีมแล้วแต่ยังไม่ปลดล็อก
function renderUnlockUi() {
  const need = Boolean(teamId) && teamId !== unlockedTeam;
  $("unlock-team").hidden = !need;
  $("unlock-hint").hidden = !need;
  if (need) $("unlock-hint").textContent = "ใส่ PIN ของทีมแล้วกดปุ่มนี้ เพื่อดูคะแนนและรายการของทีมตัวเอง";
}

async function unlockTeam() {
  const pin = $("pin").value.trim().toUpperCase();
  showError("");
  if (!teamId) return showError("เลือกทีมก่อน");
  if (!pin) return showError("ใส่ PIN ของทีม");
  const btn = $("unlock-team");
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "กำลังตรวจ…";
  try {
    const t0 = teams.find((x) => x.id === teamId);
    const out = await verifyTeamPin(ENTRY_URL, teamId, pin, t0 ? t0.members[0] : "");
    if (!out.ok) return showError(out.error);
    unlockedTeam = teamId;
    renderMyTeam();
    renderRecent();
  } catch (err) {
    showError(`ตรวจ PIN ไม่สำเร็จ: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function setActivity(v) {
  activity = v;
  document.querySelectorAll("#activity button").forEach((b) => b.classList.toggle("is-active", b.dataset.v === v));
  const a = AMOUNT[v];
  $("amount-label").textContent = a.label;
  $("amount").step = a.step;
  $("amount").placeholder = a.ph;
  $("amount-hint").textContent = rules ? a.hint(rules) : "";
}

function showError(msg, id = "form-error") {
  $(id).hidden = !msg;
  $(id).textContent = msg || "";
}

const callApi = (payload) => postApi(ENTRY_URL, payload);
// แถวในชีตตรงกับรายการนี้ไหม (เทียบแบบเดียวกับ Code.gs)
const sameRow = (r, e) => normalizeDate(r.date) === e.date && (r.runner || "").trim().toLowerCase() === e.runner.toLowerCase();
const sameAmount = (r, e) => normalizeActivity(r.activity) === e.activity && Math.abs(Number(String(r.amount).replace(/,/g, "")) - Number(e.amount)) < 0.005;

async function submit(e) {
  e.preventDefault();
  showError("");
  if (!ENTRY_URL) return showError("ยังไม่ได้ตั้งค่า ENTRY_URL");
  const payload = {
    team_id: teamId,
    pin: $("pin").value.trim().toUpperCase(),
    runner: $("runner").value,
    date: $("date").value,
    activity,
    amount: $("amount").value,
    note: $("note").value.trim(),
  };
  if (!payload.team_id) return showError("เลือกทีมก่อน");
  if (!payload.pin) return showError("ใส่ PIN ของทีม");
  if (!payload.runner) return showError("เลือกชื่อ");
  if (!payload.date) return showError("เลือกวันที่");
  if (!(Number(payload.amount) > 0)) return showError("ใส่จำนวนให้ถูกต้อง");
  const done = dayEntry(payload.runner, payload.date);
  if (done) return showError(`${payload.runner} ส่งของวัน ${fmtDateShort(payload.date)} ไปแล้ว (${fmtAmount(done)}) — 1 คน 1 กิจกรรม/วัน`);

  const btn = $("submit");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก…";
  try {
    let out = await callApi(payload);
    if (out.unknown) { // คำตอบอ่านไม่ออก → ไปดูในชีตว่าเข้าแล้วหรือยัง
      btn.textContent = "กำลังตรวจสอบในชีต…";
      const hit = await confirmInSheet((d) => d.runs.find((r) => sameRow(r, payload)));
      if (!hit) return showError(`ไม่แน่ใจว่าบันทึกสำเร็จไหม (${out.error}) — รอสักครู่แล้วรีเฟรชหน้านี้ ดูรายการด้านล่างก่อนกรอกใหม่ (ถ้าเข้าแล้ว ระบบจะไม่ให้กรอกซ้ำอยู่แล้ว)`);
      out = { ok: true, entry: { date: payload.date, runner: hit.runner, activity: normalizeActivity(hit.activity), amount: Number(String(hit.amount).replace(/,/g, "")), note: hit.note || "" } };
    }
    if (!out.ok) return showError(out.error || "บันทึกไม่สำเร็จ");
    store.set(LS.team, payload.team_id);
    unlockedTeam = payload.team_id; // ส่งผลผ่าน = PIN ถูก ปลดล็อกดูข้อมูลทีมนี้ได้เลย
    entries.unshift({ ...out.entry, teamId: payload.team_id });
    renderRecent();
    renderMyTeam();
    renderDayHint();
    $("amount").value = "";
    $("note").value = "";
    btn.textContent = "✅ บันทึกแล้ว";
    await new Promise((r) => setTimeout(r, 1200));
  } catch (err) {
    showError(`ส่งไม่สำเร็จ: ${err.message} — ลองใหม่อีกครั้ง`);
  } finally {
    btn.textContent = "บันทึกผล";
    btn.disabled = false;
    renderDayHint(); // ส่งสำเร็จแล้ว → ปุ่มปิดเพราะคนนี้ส่งของวันนี้แล้ว
  }
}

async function remove(idx, btn) {
  const en = entries[idx];
  if (!en) return;
  showError("", "recent-error");
  const pin = $("pin").value.trim().toUpperCase();
  if (!pin) return showError("ใส่ PIN ของทีมในฟอร์มด้านบนก่อนลบ", "recent-error");
  const a = act(en.activity);
  if (!confirm(`ลบรายการนี้?\n${fmtDateShort(en.date)} ${en.runner} ${a.label} ${fmtNum(en.amount, a.timed || en.activity === "walk" ? 0 : 2)} ${a.unit}`)) return;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    let out = await callApi({ action: "delete", team_id: en.teamId, pin, runner: en.runner, date: en.date, activity: en.activity, amount: en.amount });
    if (out.unknown) { // คำตอบอ่านไม่ออก → ดูว่าแถวหายจากชีตแล้วหรือยัง
      const gone = await confirmInSheet((d) => !d.runs.some((r) => sameRow(r, en) && sameAmount(r, en)));
      if (!gone) return showError(`ไม่แน่ใจว่าลบสำเร็จไหม (${out.error}) — รอสักครู่แล้วรีเฟรชหน้านี้`, "recent-error");
      out = { ok: true };
    }
    if (!out.ok) return showError(out.error || "ลบไม่สำเร็จ", "recent-error");
    entries.splice(idx, 1);
    renderRecent();
    renderMyTeam();
    renderDayHint();
  } catch (err) {
    showError(`ลบไม่สำเร็จ: ${err.message}`, "recent-error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🗑";
  }
}

$("team-chips").addEventListener("click", (e) => {
  const c = e.target.closest("[data-team]");
  if (!c) return;
  teamId = c.dataset.team;
  renderChips();
  renderRunners();
  renderMyTeam();
  renderRecent();
});
$("activity").addEventListener("click", (e) => {
  const b = e.target.closest("[data-v]");
  if (b) setActivity(b.dataset.v);
});
$("recent-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-del]");
  if (b) remove(Number(b.dataset.del), b);
});
$("unlock-team").addEventListener("click", unlockTeam);
$("pin-toggle").addEventListener("click", () => {
  const show = $("pin").type === "password";
  $("pin").type = show ? "text" : "password";
  $("pin-toggle").setAttribute("aria-pressed", show);
  $("pin-toggle").setAttribute("aria-label", show ? "ซ่อน PIN" : "แสดง PIN");
});
$("runner").addEventListener("change", renderDayHint);
$("date").addEventListener("change", renderDayHint);
$("form").addEventListener("submit", submit);
init();
