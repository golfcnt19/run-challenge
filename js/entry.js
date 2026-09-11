// หน้ากรอกผล — โหลดรายชื่อทีม+รายการจากชีต (อ่านอย่างเดียว) แล้วส่งเพิ่ม/ลบไป Apps Script
import { loadAll } from "./sheets.js";
import { computeScores, ACTIVITIES, rawPoints } from "./scoring.js";
import { fmtDateShort, fmtNum, todayIso } from "./format.js";
import { ENTRY_URL } from "./config.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// จำเฉพาะทีมที่เลือกล่าสุด — PIN ไม่จำ ต้องใส่ทุกครั้ง
const LS = { team: "rc-entry-team" };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

let teams = [];
let rules = null;
let entries = []; // ทุกรายการจากชีต (เรียงใหม่→เก่า) — อัปเดตในเครื่องเมื่อเพิ่ม/ลบ
let sinceDate = ""; // วันแรกของช่วง 7 วันหลังสุด
let teamId = store.get(LS.team) || "";
let activity = "run";
const RECENT_DAYS = 7; // แสดงรายการของทีมเฉพาะ 7 วันหลังสุด
const AMOUNT = {
  run:       { label: "ระยะทาง (กม.)", step: "0.01", ph: "เช่น 5.2",   hint: (r) => `1 กม. = ${r.pointsPerRunKm} คะแนน · เพดาน ${r.dailyCap}/วัน` },
  treadmill: { label: "ระยะทาง (กม.)", step: "0.01", ph: "เช่น 3",     hint: (r) => `ถ่ายรูปคู่ลู่ให้เห็นระยะส่งในกลุ่ม · 1 กม. = ${r.pointsPerRunKm} คะแนน` },
  walk:      { label: "จำนวนก้าว",     step: "1",    ph: "เช่น 8500",  hint: (r) => `${fmtNum(r.walkStepsForFull)} ก้าว = ${r.dailyCap} คะแนน (คิดตามสัดส่วน)` },
  bike:      { label: "ระยะทาง (กม.)", step: "0.1",  ph: "เช่น 15",    hint: (r) => `${fmtNum(r.bikeKmForFull)} กม. = ${r.dailyCap} คะแนน (คิดตามสัดส่วน)` },
};

async function init() {
  $("setup").hidden = Boolean(ENTRY_URL);
  $("date").value = todayIso();
  $("date").max = todayIso();
  try {
    const data = await loadAll();
    const scored = computeScores(data);
    rules = scored.rules;
    teams = scored.teams.map((t) => ({ id: t.id, name: t.name, color: t.color, members: t.members }));
    entries = scored.entries.map((e) => ({ date: e.date, runner: e.runner, teamId: e.team.id, activity: e.activity, amount: e.amount, note: e.note }));
    sinceDate = scored.days.length ? scored.days[Math.max(0, scored.days.length - RECENT_DAYS)] : "";
    $("range").textContent = `${rules.title} · ${fmtDateShort(rules.startDate)} – ${fmtDateShort(rules.endDate)}`;
    $("date").min = rules.startDate;
    if (!teams.some((t) => t.id === teamId)) teamId = "";
    renderChips();
    renderRunners();
    renderRecent();
    setActivity(activity);
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
}

function entryHtml(e, idx) {
  const a = ACTIVITIES[e.activity];
  return `<li data-idx="${idx}">
    <span class="d">${fmtDateShort(e.date)}</span><span>${esc(e.runner)}</span>${e.note ? `<span class="note">${esc(e.note)}</span>` : ""}
    <span class="a">${a.icon} ${fmtNum(e.amount, e.activity === "walk" ? 0 : 2)} ${a.unit}</span>
    <button type="button" class="btn-del" data-del="${idx}" aria-label="ลบรายการ">🗑</button>
  </li>`;
}

function renderRecent() {
  const t = teams.find((x) => x.id === teamId);
  $("recent-card").hidden = !t;
  if (!t) return;
  $("recent-team").textContent = t.name;
  const mine = entries.map((e, i) => [e, i]).filter(([e]) => e.teamId === teamId && e.date >= sinceDate);
  $("recent-list").innerHTML = mine.length ? mine.map(([e, i]) => entryHtml(e, i)).join("") : `<li class="empty">ยังไม่มีรายการ</li>`;
}

// คะแนน (หลังตัดเพดาน) ที่คนนั้นมีอยู่แล้วในวันนั้น
function dayPoints(runner, date) {
  const raw = entries.filter((x) => x.runner === runner && x.date === date).reduce((s, x) => s + rawPoints(x.activity, x.amount, rules), 0);
  return Math.min(raw, rules.dailyCap);
}
function renderDayHint() {
  const el = $("day-hint");
  const runner = $("runner").value, date = $("date").value;
  if (!rules || !runner || !date) return (el.hidden = true);
  const p = dayPoints(runner, date);
  el.hidden = false;
  el.className = "hint day-hint" + (p >= rules.dailyCap ? " is-full" : "");
  el.textContent = p >= rules.dailyCap
    ? `${runner} ได้ครบ ${rules.dailyCap} คะแนนของวัน ${fmtDateShort(date)} แล้ว — กรอกเพิ่มไม่ได้`
    : `${runner} วันนี้ได้แล้ว ${fmtNum(p, 2)} / ${rules.dailyCap} คะแนน`;
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

async function callApi(payload) {
  // ส่งเป็น text/plain เพื่อไม่ให้เบราว์เซอร์ยิง preflight (Apps Script ไม่รองรับ OPTIONS)
  const res = await fetch(ENTRY_URL, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow" });
  return res.json();
}

async function submit(e) {
  e.preventDefault();
  showError("");
  if (!ENTRY_URL) return showError("ยังไม่ได้ตั้งค่า ENTRY_URL");
  const payload = {
    team_id: teamId,
    pin: $("pin").value.trim(),
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
  if (rules && dayPoints(payload.runner, payload.date) >= rules.dailyCap)
    return showError(`${payload.runner} ได้ครบ ${rules.dailyCap} คะแนนของวันนั้นแล้ว กรอกเพิ่มไม่ได้`);

  const btn = $("submit");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก…";
  try {
    const out = await callApi(payload);
    if (!out.ok) return showError(out.error || "บันทึกไม่สำเร็จ");
    store.set(LS.team, payload.team_id);
    entries.unshift({ ...out.entry, teamId: payload.team_id });
    renderRecent();
    renderDayHint();
    $("amount").value = "";
    $("note").value = "";
    btn.textContent = "✅ บันทึกแล้ว";
    await new Promise((r) => setTimeout(r, 1200));
  } catch (err) {
    showError(`ส่งไม่สำเร็จ: ${err.message} — ลองใหม่อีกครั้ง`);
  } finally {
    btn.disabled = false;
    btn.textContent = "บันทึกผล";
  }
}

async function remove(idx, btn) {
  const en = entries[idx];
  if (!en) return;
  showError("", "recent-error");
  const pin = $("pin").value.trim();
  if (!pin) return showError("ใส่ PIN ของทีมในฟอร์มด้านบนก่อนลบ", "recent-error");
  const a = ACTIVITIES[en.activity];
  if (!confirm(`ลบรายการนี้?\n${fmtDateShort(en.date)} ${en.runner} ${a.label} ${fmtNum(en.amount, en.activity === "walk" ? 0 : 2)} ${a.unit}`)) return;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const out = await callApi({ action: "delete", team_id: en.teamId, pin, runner: en.runner, date: en.date, activity: en.activity, amount: en.amount });
    if (!out.ok) return showError(out.error || "ลบไม่สำเร็จ", "recent-error");
    entries.splice(idx, 1);
    renderRecent();
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
