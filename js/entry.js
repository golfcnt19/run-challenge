// หน้ากรอกผล — โหลดรายชื่อทีม+รายการจากชีต (อ่านอย่างเดียว) แล้วส่งเพิ่ม/ลบไป Apps Script
import { loadAll } from "./sheets.js";
import { computeScores, ACTIVITIES, CARDS, CARD_TYPES, rawPoints, weekKey } from "./scoring.js";
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
let cardState = {}; // จาก computeScores: ต่อทีม { used: {carry: date…}, usedToday, left }
let rawData = null; // ข้อมูลชีตดิบ เก็บไว้คำนวณสถานะการ์ดใหม่หลังใช้
let pickedCard = null;
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
    rawData = data;
    cardState = scored.cardState;
    sinceDate = scored.days.length ? scored.days[Math.max(0, scored.days.length - RECENT_DAYS)] : "";
    $("range").textContent = `${rules.title} · ${fmtDateShort(rules.startDate)} – ${fmtDateShort(rules.endDate)}`;
    $("date").min = rules.startDate;
    if (!teams.some((t) => t.id === teamId)) teamId = "";
    renderChips();
    renderRunners();
    renderRecent();
    renderCards();
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
    ? `${runner} วัน ${fmtDateShort(date)} นับเต็ม ${rules.dailyCap} แล้ว — กรอกเพิ่มได้ (คะแนนทีมไม่เพิ่ม แต่นับชิง ⭐ ดาวประจำวัน)`
    : `${runner} วันนี้ได้แล้ว ${fmtNum(p, 2)} / ${rules.dailyCap} คะแนน`;
}

// ── การ์ดพิเศษ ──────────────────────────────────────────────────────
const CARD_DESC = {
  carry: "เลือกผู้ให้ (คนที่วิ่งเกิน 5) และผู้รับในทีม — โอนเฉพาะส่วนที่เกิน 5 สูงสุด 5 คะแนน ผู้รับยังไม่เกิน 5",
  x2: "ระบบสุ่มสมาชิกในทีม 1 คน คะแนนวันนี้ของคนนั้น ×2 (สูงสุด 10) — สุ่มได้ใครล็อกทันที",
  block: "เลือกทีมอื่นและคน 1 คน คะแนนวันนี้ของเขา = 0 · เฉลยหลังจบวัน อีกฝ่ายจะยังไม่รู้",
};

function renderCards() {
  const t = teams.find((x) => x.id === teamId);
  $("cards-card").hidden = !t;
  if (!t) return;
  const cs = cardState[t.id] || { used: {}, usedToday: false, left: CARD_TYPES };
  $("cards-team").textContent = t.name;
  $("cards-week").textContent = `วีค ${fmtDateShort(weekKey(todayIso()))}`;
  $("card-grid").innerHTML = CARD_TYPES.map((k) => {
    const used = cs.used[k];
    const dis = used || cs.usedToday;
    const sub = used ? `ใช้แล้ว ${fmtDateShort(used)}` : cs.usedToday ? "วันนี้ใช้ไปแล้ว 1 ใบ" : "พร้อมใช้";
    return `<button type="button" class="card-btn ${used ? "is-used" : ""} ${pickedCard === k ? "is-active" : ""}" data-card="${k}" ${dis ? "disabled" : ""}><span class="ic">${CARDS[k].icon}</span>${CARDS[k].label}<small>${sub}</small></button>`;
  }).join("");
  renderCardForm();
}

function renderCardForm() {
  const box = $("card-form");
  showError("", "card-error");
  if (!pickedCard) return (box.hidden = true);
  $("card-done").hidden = true;
  const t = teams.find((x) => x.id === teamId);
  const opt = (list) => `<option value="">— เลือก —</option>` + list.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
  let inner = `<p class="desc">${CARDS[pickedCard].icon} <b>${CARDS[pickedCard].label}</b> — ${CARD_DESC[pickedCard]}</p>`;
  if (pickedCard === "carry") inner += `<label class="field"><span>ผู้ให้ (คนที่วิ่งเกิน 5)</span><select id="cf-from">${opt(t.members)}</select></label><label class="field"><span>ผู้รับ</span><select id="cf-to">${opt(t.members)}</select></label>`;
  if (pickedCard === "block") {
    const others = teams.filter((x) => x.id !== t.id);
    inner += `<label class="field"><span>ทีมที่จะ block</span><select id="cf-team"><option value="">— เลือกทีม —</option>${others.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select></label><label class="field"><span>คนที่จะ block</span><select id="cf-target" disabled><option value="">— เลือกทีมก่อน —</option></select></label>`;
  }
  inner += `<button type="button" class="btn-primary" id="cf-submit">${pickedCard === "x2" ? "🎲 สุ่มแล้วใช้การ์ด" : "ใช้การ์ด"}</button>`;
  box.innerHTML = inner;
  box.hidden = false;
  if (pickedCard === "block") $("cf-team").addEventListener("change", () => {
    const x = teams.find((y) => y.id === $("cf-team").value);
    const sel = $("cf-target");
    sel.innerHTML = x ? opt(x.members) : `<option value="">— เลือกทีมก่อน —</option>`;
    sel.disabled = !x;
  });
  $("cf-submit").addEventListener("click", useCard);
}

async function useCard() {
  showError("", "card-error");
  if (!ENTRY_URL) return showError("ยังไม่ได้ตั้งค่า ENTRY_URL", "card-error");
  const pin = $("pin").value.trim();
  if (!pin) return showError("ใส่ PIN ของทีมในฟอร์มด้านบนก่อน", "card-error");
  const t = teams.find((x) => x.id === teamId);
  const payload = { action: "card", team_id: teamId, pin, card: pickedCard };
  let summary = "";
  if (pickedCard === "carry") {
    payload.runner = $("cf-from").value; payload.target_runner = $("cf-to").value;
    if (!payload.runner || !payload.target_runner) return showError("เลือกผู้ให้และผู้รับ", "card-error");
    if (payload.runner === payload.target_runner) return showError("ผู้ให้กับผู้รับต้องคนละคน", "card-error");
    summary = `🎒 ${payload.runner} → ${payload.target_runner}`;
  } else if (pickedCard === "block") {
    payload.target_team = $("cf-team").value; payload.target_runner = $("cf-target").value;
    if (!payload.target_team || !payload.target_runner) return showError("เลือกทีมและคนที่จะ block", "card-error");
    summary = `🛡️ block ${payload.target_runner} (ทีม ${payload.target_team})`;
  } else summary = "✖️2 ระบบจะสุ่มสมาชิกในทีมให้";
  if (!confirm(`ใช้การ์ด ${CARDS[pickedCard].label} ของ ${t.name} วันนี้?\n${summary}\n\nใช้แล้วยกเลิกไม่ได้`)) return;

  const btn = $("cf-submit");
  btn.disabled = true; btn.textContent = "กำลังใช้การ์ด…";
  const done = $("card-done");
  let roll = null;
  if (pickedCard === "x2") { // animation สุ่มชื่อระหว่างรอ
    done.hidden = false; done.classList.add("is-rolling");
    done.innerHTML = `กำลังสุ่ม…<span class="big" id="roll">${esc(t.members[0])}</span>`;
    roll = setInterval(() => { $("roll").textContent = t.members[Math.floor(Math.random() * t.members.length)]; }, 90);
  }
  try {
    const out = await callApi(payload);
    if (roll) clearInterval(roll);
    if (!out.ok) { done.hidden = true; done.classList.remove("is-rolling"); return showError(out.error || "ใช้การ์ดไม่สำเร็จ", "card-error"); }
    const c = out.card;
    // อัปเดตสถานะการ์ดในเครื่อง แล้ววาดปุ่มใหม่
    rawData.cards = [...(rawData.cards || []), { date: c.date, team_id: teamId, card: c.card, runner: c.runner || "", target_team: c.target_team || "", target_runner: c.target_runner || "" }];
    cardState = computeScores(rawData).cardState;
    pickedCard = null;
    renderCards(); // ซ่อนฟอร์มย่อย + วาดปุ่มตามโควตาใหม่
    done.classList.remove("is-rolling");
    done.innerHTML = c.card === "x2"
      ? `🎲 สุ่มได้<span class="big">✖️2 ${esc(c.runner)}</span>คะแนนวันนี้ของ ${esc(c.runner)} ×2`
      : c.card === "carry" ? `✅ ใช้แล้ว<span class="big">🎒 ${esc(c.runner)} → ${esc(c.target_runner)}</span>`
      : `✅ ใช้แล้ว<span class="big">🛡️ ${esc(c.target_runner)} (${esc(c.target_team)})</span>เฉลยหลังจบวัน`;
    done.hidden = false;
  } catch (err) {
    if (roll) clearInterval(roll);
    done.hidden = true; done.classList.remove("is-rolling");
    showError(`ส่งไม่สำเร็จ: ${err.message} — ลองใหม่อีกครั้ง`, "card-error");
    if ($("cf-submit")) { $("cf-submit").disabled = false; $("cf-submit").textContent = "ใช้การ์ด"; }
  }
}

$("card-grid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-card]");
  if (!b || b.disabled) return;
  pickedCard = pickedCard === b.dataset.card ? null : b.dataset.card;
  renderCards();
});

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
  // กันมือลั่น: รายการเหมือนเดิมเป๊ะ (คน+วัน+กิจกรรม+จำนวน) มีอยู่แล้ว → ถามยืนยันก่อน
  const dup = entries.find((x) => x.runner === payload.runner && x.date === payload.date && x.activity === activity && Math.abs(Number(x.amount) - Number(payload.amount)) < 0.005);
  if (dup) {
    const a = ACTIVITIES[activity];
    if (!confirm(`${payload.runner} มีรายการ ${a.label} ${fmtNum(payload.amount, activity === "walk" ? 0 : 2)} ${a.unit} ของวัน ${fmtDateShort(payload.date)} อยู่แล้ว

กรอกซ้ำจริงใช่ไหม?`)) return;
  }

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
  pickedCard = null;
  renderChips();
  renderRunners();
  renderRecent();
  renderCards();
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
