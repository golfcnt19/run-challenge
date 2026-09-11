// หน้ากรอกผล — โหลดรายชื่อทีมจากชีต (อ่านอย่างเดียว) แล้วส่งรายการไป Apps Script
import { loadAll } from "./sheets.js";
import { readRules, ACTIVITIES } from "./scoring.js";
import { fmtDateLong, fmtDateShort, fmtNum, todayIso } from "./format.js";
import { ENTRY_URL } from "./config.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LS = { team: "rc-entry-team", pin: "rc-entry-pin" };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

let teams = [];
let rules = null;
let teamId = store.get(LS.team) || "";
let activity = "run";
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
  $("pin").value = store.get(LS.pin) || "";
  try {
    const data = await loadAll();
    rules = readRules(data.config);
    teams = data.teams.filter((t) => t.team_id).map((t) => ({
      id: t.team_id, name: t.team_name || t.team_id, color: t.color || "#888",
      members: (t.members || "").split(",").map((s) => s.trim()).filter(Boolean),
    }));
    $("range").textContent = `${rules.title} · ${fmtDateShort(rules.startDate)} – ${fmtDateShort(rules.endDate)}`;
    $("date").min = rules.startDate;
    if (!teams.some((t) => t.id === teamId)) teamId = "";
    renderChips();
    renderRunners();
    setActivity(activity);
  } catch (e) {
    showError(`โหลดรายชื่อทีมไม่ได้: ${e.message}`);
  }
}

function renderChips() {
  $("team-chips").innerHTML = teams
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

function setActivity(v) {
  activity = v;
  document.querySelectorAll("#activity button").forEach((b) => b.classList.toggle("is-active", b.dataset.v === v));
  const a = AMOUNT[v];
  $("amount-label").textContent = a.label;
  $("amount").step = a.step;
  $("amount").placeholder = a.ph;
  $("amount-hint").textContent = rules ? a.hint(rules) : "";
}

function showError(msg) {
  $("form-error").hidden = !msg;
  $("form-error").textContent = msg || "";
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

  const btn = $("submit");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก…";
  try {
    // ส่งเป็น text/plain เพื่อไม่ให้เบราว์เซอร์ยิง preflight (Apps Script ไม่รองรับ OPTIONS)
    const res = await fetch(ENTRY_URL, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow" });
    const out = await res.json();
    if (!out.ok) {
      if (out.code === "PIN") store.del(LS.pin);
      return showError(out.error || "บันทึกไม่สำเร็จ");
    }
    store.set(LS.pin, payload.pin);
    store.set(LS.team, payload.team_id);
    const en = out.entry;
    $("done-card").hidden = false;
    $("done-list").insertAdjacentHTML("afterbegin",
      `<li><span class="d">${fmtDateShort(en.date)}</span><span>${esc(en.runner)}</span>${en.note ? `<span class="note">${esc(en.note)}</span>` : ""}<span class="a">${ACTIVITIES[en.activity].icon} ${fmtNum(en.amount, en.activity === "walk" ? 0 : 2)} ${ACTIVITIES[en.activity].unit}</span></li>`);
    $("amount").value = "";
    $("note").value = "";
    $("done-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    showError(`ส่งไม่สำเร็จ: ${err.message} — ลองใหม่อีกครั้ง`);
  } finally {
    btn.disabled = false;
    btn.textContent = "บันทึกผล";
  }
}

$("team-chips").addEventListener("click", (e) => {
  const c = e.target.closest("[data-team]");
  if (!c) return;
  teamId = c.dataset.team;
  renderChips();
  renderRunners();
});
$("activity").addEventListener("click", (e) => {
  const b = e.target.closest("[data-v]");
  if (b) setActivity(b.dataset.v);
});
$("form").addEventListener("submit", submit);
init();
