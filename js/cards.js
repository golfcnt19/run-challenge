// หน้าการ์ดพิเศษ — เลือกทีม + PIN แล้วใช้การ์ด (ส่ง action "card" ไป Apps Script)
import { loadAll } from "./sheets.js?v=mtwqecck";
import { computeScores, CARDS, CARD_TYPES, weekKey } from "./scoring.js?v=mtwqecck";
import { fmtDateLong } from "./format.js?v=mtwqecck";
import { fmtDateShort, fmtPts, todayIso } from "./format.js?v=mtwqecck";
import { ENTRY_URL } from "./config.js?v=mtwqecck";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LS = { team: "rc-entry-team" }; // จำทีมร่วมกับหน้ากรอก
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

let teams = [];
let cardState = {};
let rawData = null;
let pickedCard = null;
let teamId = store.get(LS.team) || "";
let scored = null;
let doneFor = null; // ทีมที่กล่อง "ใช้แล้ว" เป็นของ — สลับทีมแล้วซ่อน // ผล computeScores ล่าสุด (ใช้วาดประวัติ)
let histScope = "week", histTeam = "all";

async function init() {
  $("setup").hidden = Boolean(ENTRY_URL);
  try {
    const data = await loadAll();
    scored = computeScores(data);
    teams = scored.teams.map((t) => ({ id: t.id, name: t.name, color: t.color, members: t.members }));
    rawData = data;
    cardState = scored.cardState;
    $("range").textContent = `${scored.rules.title} · ${fmtDateShort(scored.rules.startDate)} – ${fmtDateShort(scored.rules.endDate)}`;
    if (!teams.some((t) => t.id === teamId)) teamId = "";
    renderRules(scored.rules);
    renderChips();
    renderCards();
    renderHistory();
  } catch (e) {
    showError(`โหลดรายชื่อทีมไม่ได้: ${e.message}`, "card-error");
    $("card-error").hidden = false;
  }
}

// ── ประวัติการ์ด + สรุปผลต่อทีม ──────────────────────────────────────
const signed = (n) => (n > 0 ? "+" : "") + fmtPts(n);
function cardLine(c) {
  const who = c.card === "carry" ? `${c.runner} → ${c.target}`
    : c.card === "x2" ? c.runner
    : c.revealed ? `${c.target} <small>(ทีม ${esc(c.targetTeam.id)})</small>` : "<small>ยังไม่เฉลย</small>";
  let eff;
  if (c.effect === null) eff = `<span class="eff dim">เฉลยพรุ่งนี้</span>`;
  else if (c.card === "block") eff = c.effect < 0 ? `<span class="eff down">ทีม ${esc(c.targetTeam.id)} ${signed(c.effect)}</span>` : `<span class="eff dim">ไม่มีผล</span>`;
  else eff = c.effect > 0 ? `<span class="eff up">ทีม ${esc(c.team.id)} ${signed(c.effect)}</span>` : `<span class="eff dim">ไม่มีผล</span>`;
  return `<li>
    <span class="d">${fmtDateShort(c.date)}</span>
    <span class="dot-badge mini" style="--team:${esc(c.team.color)}">${esc(c.team.id)}</span>
    <span class="hl-what">${CARDS[c.card].icon} ${esc(who)}<small class="hl-detail">${esc(c.detail)}</small></span>
    ${eff}
  </li>`;
}

function renderHistory() {
  if (!scored) return;
  document.querySelectorAll("#hist-scope button").forEach((b) => b.classList.toggle("is-active", b.dataset.v === histScope));
  document.querySelectorAll("#hist-team button").forEach((b) => b.classList.toggle("is-active", b.dataset.v === histTeam));
  const thisWeek = weekKey(todayIso());
  let list = scored.cards.filter((c) => histScope === "all" || c.week === thisWeek);
  if (histTeam === "mine" && teamId) list = list.filter((c) => c.team.id === teamId || (c.card === "block" && c.revealed && c.targetTeam.id === teamId));
  list = [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // สรุปต่อทีม: ได้จากการ์ด / โดน block / สุทธิ (ในขอบเขตที่เลือก)
  const sum = {};
  for (const t of teams) sum[t.id] = { gain: 0, loss: 0, used: 0 };
  for (const c of list) {
    sum[c.team.id].used++;
    if (c.effect === null) continue;
    if (c.card === "block") sum[c.targetTeam.id].loss += c.effect;
    else sum[c.team.id].gain += c.effect;
  }
  const rows = [...teams].sort((x, y) => x.id.localeCompare(y.id)).map((t) => {
    const s = sum[t.id], net = s.gain + s.loss;
    return `<tr><td><span class="dot" style="background:${esc(t.color)}"></span>${esc(t.id)}</td><td>${s.used}</td><td class="up">${s.gain ? signed(s.gain) : "–"}</td><td class="down">${s.loss ? signed(s.loss) : "–"}</td><td><b>${net ? signed(net) : "–"}</b></td></tr>`;
  }).join("");
  $("card-summary").innerHTML = `<thead><tr><th>ทีม</th><th>ใช้</th><th>ได้จากการ์ด</th><th>โดน block</th><th>สุทธิ</th></tr></thead><tbody>${rows}</tbody>`;

  // รายการ จัดกลุ่มตามวีค
  if (!list.length) return ($("card-history").innerHTML = `<p class="empty">ยังไม่มีการใช้การ์ด${histScope === "week" ? "ในวีคนี้" : ""}</p>`);
  const groups = new Map();
  for (const c of list) (groups.get(c.week) || groups.set(c.week, []).get(c.week)).push(c);
  $("card-history").innerHTML = [...groups.entries()].map(([wk, cs]) => `
    <div class="hl-week">วีค ${fmtDateShort(wk)} – ${fmtDateShort(addDaysIso(wk, 6))}${wk === thisWeek ? " <small>(วีคนี้)</small>" : ""}</div>
    <ul class="log hl">${cs.map(cardLine).join("")}</ul>`).join("");
}
function addDaysIso(iso, n) { const p = iso.split("-").map(Number); const d = new Date(p[0], p[1] - 1, p[2] + n); const z = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }

function renderRules(r) {
  $("cards-lead").innerHTML = `ทีมละ <b>3 ใบ/วีค</b> (จันทร์–อาทิตย์) ชนิดละใบ · <b>วันละ 1 ใบ</b> · ใช้กับวันที่กดเท่านั้น · ใช้แล้วยกเลิกไม่ได้`;
  $("cards-rules").innerHTML = `
    <li>🎒 <b>เดอะแบก</b> โอนส่วนที่เกิน ${fmtPts(r.dailyCap)} ของผู้ให้ไปให้เพื่อนร่วมทีม 1 คน สูงสุด ${fmtPts(r.dailyCap)} (ผู้รับยังไม่เกิน ${fmtPts(r.dailyCap)})</li>
    <li>✖️2 <b>คูณสอง</b> ระบบสุ่มสมาชิก 1 คน คะแนนวันนั้น ×2 สูงสุด ${fmtPts(r.dailyCap * 2)}</li>
    <li>🛡️ <b>Block</b> เลือกคนทีมอื่น 1 คน คะแนนวันนั้น = 0 · เฉลยหลังจบวัน · block ชนะทุกอย่าง</li>`;
  const cap = r.dailyCap, p = fmtPts;
  $("cards-examples").innerHTML = `
    <div class="ex"><div class="ex-h">🎒 เดอะแบก</div>
      <table class="ex-table"><thead><tr><th>สถานการณ์</th><th>ผล</th></tr></thead><tbody>
        <tr><td>Jay วิ่ง 15 กม. · Bird วิ่ง 2 กม. <small>(ไม่ใช้การ์ด)</small></td><td>Jay ${p(cap)} + Bird 2 = <b>${p(cap + 2)}</b></td></tr>
        <tr><td>ใช้การ์ด Jay → Bird</td><td>Jay ${p(cap)} + Bird ${p(cap)} = <b>${p(cap * 2)}</b><br><small>ส่วนเกิน 10 โอนได้แค่ ${p(cap)} · Bird รับได้ถึง ${p(cap)}</small></td></tr>
        <tr><td>Jay วิ่ง 7 กม. → Bird วิ่ง 2 กม.</td><td>โอนได้ 2 (ส่วนที่เกิน ${p(cap)})<br>Jay ${p(cap)} + Bird 4 = <b>${p(cap + 4)}</b></td></tr>
        <tr><td>Jay วิ่ง 4 กม. → Bird</td><td><b>โอนไม่ได้</b> ไม่มีส่วนเกิน — การ์ดเสียเปล่า</td></tr>
      </tbody></table>
    </div>
    <div class="ex"><div class="ex-h">✖️2 คูณสอง</div>
      <table class="ex-table"><thead><tr><th>สถานการณ์</th><th>ผล</th></tr></thead><tbody>
        <tr><td>สุ่มได้ Koi · Koi วิ่ง 3 กม.</td><td>3 × 2 = <b>6</b> <small>(เกิน ${p(cap)} ได้)</small></td></tr>
        <tr><td>สุ่มได้ Koi · Koi วิ่ง 5 กม. + เดิน 4,000 ก้าว</td><td>ดิบ 7 → เพดาน ${p(cap)} → ×2 = <b>${p(cap * 2)}</b> <small>(สูงสุด)</small></td></tr>
        <tr><td>สุ่มได้ Koi · Koi ไม่ได้ส่งผลวันนั้น</td><td>0 × 2 = <b>0</b> — การ์ดเสียเปล่า</td></tr>
      </tbody></table>
    </div>
    <div class="ex"><div class="ex-h">🛡️ Block</div>
      <table class="ex-table"><thead><tr><th>สถานการณ์</th><th>ผล</th></tr></thead><tbody>
        <tr><td>ทีม A block Golf (ทีม G) · Golf วิ่ง 8 กม.</td><td>วันนี้ยังโชว์ Golf ${p(cap)}<br><b>พรุ่งนี้กลายเป็น 0</b> และขึ้นป้าย 🛡️</td></tr>
        <tr><td>Golf โดน block และทีม G ใช้ x2 สุ่มได้ Golf พอดี</td><td>block ชนะ → <b>0</b> <small>(x2 เสียเปล่า)</small></td></tr>
        <tr><td>ทีม A และทีม B block Golf วันเดียวกัน</td><td>Golf = <b>0</b> · ทั้งสองทีมเสียใบ ไม่รู้กัน</td></tr>
      </tbody></table>
    </div>
    <div class="ex"><div class="ex-h">📅 โควตา</div>
      <table class="ex-table"><thead><tr><th>สถานการณ์</th><th>ผล</th></tr></thead><tbody>
        <tr><td>จันทร์ 🎒 · อังคาร ✖️2 · พุธ 🛡️</td><td>ครบ 3 ใบ พฤหัส–อาทิตย์ไม่มีใบเหลือ</td></tr>
        <tr><td>จันทร์ใช้ 🎒 แล้วอยากใช้ ✖️2 วันเดียวกัน</td><td><b>ไม่ได้</b> วันละ 1 ใบ — รอวันอังคาร</td></tr>
        <tr><td>วีคนี้ใช้แค่ 1 ใบ</td><td>อีก 2 ใบ<b>ไม่ทบ</b>ไปวีคหน้า · วีคใหม่ได้ 3 ใบใหม่</td></tr>
      </tbody></table>
    </div>`;
}

function renderChips() {
  $("team-chips").innerHTML = [...teams]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => `<button type="button" class="chip ${t.id === teamId ? "is-active" : ""}" style="--team:${esc(t.color)}" data-team="${esc(t.id)}">${esc(t.name)}</button>`)
    .join("");
}

function showError(msg, id = "card-error") {
  $(id).hidden = !msg;
  $(id).textContent = msg || "";
}

async function callApi(payload) {
  const res = await fetch(ENTRY_URL, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow" });
  return res.json();
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
  $("no-team").hidden = Boolean(t);
  if (doneFor !== teamId) { $("card-done").hidden = true; $("card-done").innerHTML = ""; }
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
    doneFor = teamId;
    // อัปเดตสถานะการ์ดในเครื่อง แล้ววาดปุ่มใหม่
    rawData.cards = [...(rawData.cards || []), { date: c.date, team_id: teamId, card: c.card, runner: c.runner || "", target_team: c.target_team || "", target_runner: c.target_runner || "" }];
    scored = computeScores(rawData);
    cardState = scored.cardState;
    pickedCard = null;
    renderCards();
    renderHistory(); // ซ่อนฟอร์มย่อย + วาดปุ่มตามโควตาใหม่
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

$("team-chips").addEventListener("click", (e) => {
  const c = e.target.closest("[data-team]");
  if (!c) return;
  teamId = c.dataset.team;
  store.set(LS.team, teamId);
  pickedCard = null;
  renderChips();
  renderCards();
  renderHistory();
});
$("hist-scope").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (!b) return; histScope = b.dataset.v; renderHistory(); });
$("hist-team").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (!b) return; histTeam = b.dataset.v; renderHistory(); });
$("card-grid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-card]");
  if (!b || b.disabled) return;
  pickedCard = pickedCard === b.dataset.card ? null : b.dataset.card;
  renderCards();
});
$("pin-toggle").addEventListener("click", () => {
  const show = $("pin").type === "password";
  $("pin").type = show ? "text" : "password";
  $("pin-toggle").setAttribute("aria-pressed", show);
});
init();
