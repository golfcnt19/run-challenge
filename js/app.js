// โหลดข้อมูล → คิดคะแนน → วาดหน้า
import { loadAll } from "./sheets.js?v=mugjdhwb";
import { computeScores, ACTIVITIES, TIMED, act, CARDS, CARD_TYPES, rawPoints, weekKey } from "./scoring.js?v=mugjdhwb";
import { fmtDateShort, fmtDateLong, fmtTime, fmtNum, fmtPts, todayIso, addDays } from "./format.js?v=mugjdhwb";
import { USE_SAMPLE } from "./config.js?v=mugjdhwb";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let state = null; // ผลจาก computeScores
let selectedTeam = null;
let dailyShowAll = false; // ตารางรายวัน: false = 7 วันล่าสุด
const charts = {};

// ── โหลด ───────────────────────────────────────────────────────────
async function refresh() {
  const btn = $("refresh");
  btn.disabled = true;
  $("updated").textContent = "กำลังโหลด…";
  $("error").hidden = true;
  try {
    const data = await loadAll();
    state = computeScores(data);
    render(data.loadedAt);
  } catch (e) {
    $("error").hidden = false;
    $("error").textContent = `โหลดข้อมูลไม่สำเร็จ: ${e.message}`;
    $("updated").textContent = "โหลดไม่สำเร็จ";
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}

// ── วาดทั้งหน้า ─────────────────────────────────────────────────────
function render(loadedAt) {
  const { rules, teams, days, totalDays, daysElapsed, warnings } = state;
  document.title = `${rules.title} — ตารางคะแนน`;
  $("title").textContent = rules.title;
  $("range").textContent = `${fmtDateLong(rules.startDate)} – ${fmtDateLong(rules.endDate)} (${totalDays} วัน)`;

  const today = todayIso();
  const pct = Math.round((daysElapsed / totalDays) * 100);
  $("progress-fill").style.width = `${pct}%`;
  if (today < rules.startDate) {
    const left = Math.round((new Date(rules.startDate) - new Date(today)) / 86400000);
    $("progress-text").textContent = `ยังไม่เริ่ม — อีก ${left} วัน`;
  } else if (today > rules.endDate) $("progress-text").textContent = "จบกิจกรรมแล้ว 🎉";
  else $("progress-text").textContent = ""; // ระหว่างแข่งโชว์แค่ "เหลืออีก N วัน" ฝั่งขวาพอ
  const daysLeft = Math.max(0, totalDays - daysElapsed);
  // ก่อนเริ่ม: ฝั่งซ้ายนับถอยหลังวันเริ่มอยู่แล้ว ฝั่งขวาบอกวันประกาศผล (วันถัดจาก end_date = วันที่โพเดียมขึ้น)
  $("progress-days").textContent = today < rules.startDate ? `ประกาศผล ${fmtDateShort(addDays(rules.endDate, 1))}`
    : today > rules.endDate ? `${pct}%` : `เหลืออีก ${daysLeft} วัน · ${pct}%`;

  $("updated").textContent = `อัปเดต ${fmtDateShort(today)} ${fmtTime(loadedAt)}${USE_SAMPLE ? " · ข้อมูลตัวอย่าง" : ""}`;

  $("warnings").hidden = warnings.length === 0;
  $("warn-count").textContent = warnings.length;
  $("warn-list").innerHTML = warnings.map((w) => `<li>${esc(w)}</li>`).join("");

  renderCountdown(rules, daysLeft, today);
  renderPodium(teams, rules);
  renderCelebrate();
  renderTrack(teams, rules);
  renderBoard(teams, rules);
  renderWeekCards(teams);
  renderTopRunners(state.runners);
  renderRules(rules);
  renderDaily(teams, days);
  if (!selectedTeam || !teams.some((t) => t.id === selectedTeam)) selectedTeam = teams[0]?.id;
  renderTeamChips(teams);
  renderTeam(teams.find((t) => t.id === selectedTeam));
  $("foot-note").textContent = `${teams.length} ทีม · ${state.runners.length} คน · ${state.entries.length} รายการ`;
  renderPodiumLink();
}

// ป้ายสนุก ๆ ต่อทีม (คำนวณใน scoring.js)
const BADGES = {
  early:   { label: "🐦 ทีมตื่นเช้า",    title: "สัดส่วนกรอกผลก่อน 8:00 สูงสุด (อย่างน้อย 30% จาก 10 รายการขึ้นไป)" },
  night:   { label: "🦉 ทีมกลางคืน",    title: "สัดส่วนกรอกผลหลัง 21:00 สูงสุด (อย่างน้อย 30% จาก 10 รายการขึ้นไป)" },
  stage:   { label: "🏆 นักล่าสเตจ",    title: "ชนะรายวัน (🏆) มากที่สุด อย่างน้อย 2 วัน" },
  sharp:   { label: "🎯 การ์ดแม่น",     title: "ใช้การ์ดแล้วได้ผลทุกใบ ไม่มีใบเสียเปล่า (อย่างน้อย 2 ใบ) มากที่สุด" },
  blocked: { label: "🛡️ เป้าสายตา",     title: "โดน block มากที่สุด (อย่างน้อย 2 ครั้ง)" },
  steady:  { label: "🔁 ทีมสม่ำเสมอ",   title: "สมาชิกที่ส่งผลเกิน 80% ของวันมีมากที่สุด (ดูเป็นสัดส่วนของทีม อย่างน้อย 60% หลังผ่านไป 5 วัน)" },
};

// 3 วันสุดท้าย: ข้อความ "เหลืออีก N วัน" ในแถบเดิมเปลี่ยนเป็นสีทอง + 🔥 (วันปกติไม่มีอะไรเพิ่ม)
function renderCountdown(rules, daysLeft, today) {
  const el = $("progress-days");
  const final = today >= rules.startDate && today <= rules.endDate && daysLeft <= 3;
  el.classList.toggle("is-final", final);
  if (final) el.textContent = daysLeft === 0 ? "🔥 วันสุดท้าย!" : `🔥 เหลืออีก ${daysLeft} วัน — เร่งเลย!`;
}

// ลิงก์เล็กท้ายหน้าสำหรับเดโม: เปิด/ปิดตัวอย่างโพเดียม (ซ่อนเมื่อจบกิจกรรมจริงเพราะโชว์อยู่แล้ว)
function renderPodiumLink() {
  const a = $("podium-link");
  const on = new URLSearchParams(location.search).has("podium");
  a.hidden = state.finished;
  a.href = on ? "./" : "?podium=1";
  a.textContent = on ? "✕ ปิดตัวอย่างโพเดียม" : "🏁 ดูตัวอย่างโพเดียม";
}

// นักกีฬายืนรับเหรียญบนแท่น — เสื้อสีทีม+ตัวอักษรทีม, ที่ 1 ชูสองแขนกระโดด, ที่ 2/3 โบกมือ
const MEDAL_COLOR = { 1: "#f3c53c", 2: "#c9d1e0", 3: "#d19a5b" };
const athleteSvg = (id, rank) => `<svg class="athlete-svg" viewBox="0 0 100 130" aria-hidden="true">
  <circle class="head" cx="50" cy="17" r="11"/>
  <path class="legs" d="M43 72 L41 118 M57 72 L59 118"/>
  <path class="arm" d="${rank === 1 ? "M36 38 L18 12" : rank === 2 ? "M36 38 L18 58" : "M36 38 L22 62"}"/>
  <path class="arm wave" d="${rank === 1 ? "M64 38 L82 12" : "M64 38 L84 14"}"/>
  <rect class="jersey" x="34" y="31" width="32" height="43" rx="9"/>
  <text x="50" y="52" text-anchor="middle">${esc(id)}</text>
  <path class="ribbon" d="M41 32 L50 60 L59 32"/>
  <circle class="medal" cx="50" cy="64" r="6.5" fill="${MEDAL_COLOR[rank]}"/>
</svg>`;

// โพเดียมเมื่อจบกิจกรรม (วันนี้ > end_date)
function renderPodium(teams, rules) {
  const el = $("podium");
  const preview = !state.finished && new URLSearchParams(location.search).has("podium"); // ?podium=1 = ดูตัวอย่างตอนเดโม
  if ((!state.finished && !preview) || !teams.length) return (el.hidden = true);
  const top = teams.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean); // 2-1-3
  const cls = { 1: "s1", 2: "s2", 3: "s3" };
  const medal = { 1: "🥇", 2: "🥈", 3: "🥉" };
  const mvp = state.runners[0];
  const totalKm = state.entries.filter((e) => ["run", "treadmill", "bike"].includes(e.activity)).reduce((s, e) => s + e.amount, 0);
  const totalSteps = state.entries.filter((e) => e.activity === "walk").reduce((s, e) => s + e.amount, 0);
  const totalPts = teams.reduce((s, t) => s + t.rawPts, 0);
  el.innerHTML = `
    <h2>🏁 จบกิจกรรมแล้ว!</h2>
    <p class="sub">${fmtDateShort(rules.startDate)} – ${fmtDateShort(rules.endDate)} · ${state.totalDays} วัน · ${state.entries.length} รายการ</p>
    <div class="podium">${order.map((t) => `
      <div class="col c${t.rank}" style="--team:${esc(t.color)}">
        <div class="athlete a${t.rank}">${athleteSvg(t.id, t.rank)}</div>
        <div class="step ${cls[t.rank]}">
          <span class="place">${medal[t.rank]}</span>
          <b>${fmtPts(t.pts)}</b><small>${esc(t.name)}</small>
        </div>
      </div>`).join("")}</div>
    <div class="podium-stats">
      <div class="stat"><b>${mvp ? esc(mvp.name) : "–"}</b><small>⭐ MVP ${mvp ? fmtPts(mvp.pts) + " คะแนน" : ""}</small></div>
      <div class="stat"><b>${fmtNum(totalKm)}</b><small>กม. รวมทุกคน</small></div>
      <div class="stat"><b>${fmtNum(totalSteps)}</b><small>ก้าว รวมทุกคน</small></div>
      <div class="stat"><b>${fmtPts(totalPts)}</b><small>คะแนน รวมทุกคน</small></div>
    </div>`;
  el.hidden = false;
}

// ฉลองเหตุการณ์เด่นของวันล่าสุด — โชว์ครั้งเดียวต่อเหตุการณ์ต่อเครื่อง (localStorage) พร้อม confetti
function renderCelebrate() {
  const el = $("celebrate");
  const evs = state.events || [];
  if (!evs.length) return (el.hidden = true);
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem("rc-seen-events") || "[]"); } catch {}
  const fresh = evs.filter((e) => !seen.includes(e.key));
  el.innerHTML = evs.map((e) => `<span class="ev">${e.icon} ${esc(e.text)}</span>`).join("");
  el.hidden = false;
  if (!fresh.length) return;
  try { localStorage.setItem("rc-seen-events", JSON.stringify([...seen, ...fresh.map((e) => e.key)].slice(-50))); } catch {}
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div");
  box.className = "confetti";
  const colors = ["#f3c53c", "#e63946", "#4f46e5", "#2a9d8f", "#d0367a", "#f4a261"];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.8 + "s";
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3200);
}

// ย้อนดูสนามแข่ง: เล่นตำแหน่งตั้งแต่วันแรกถึงวันนี้ ทีละวัน
let replaying = false;
async function replayTrack() {
  if (replaying || !state.days.length) return;
  replaying = true;
  const btn = $("track-replay");
  btn.disabled = true;
  const track = $("track");
  track.classList.add("is-replay");
  let label = track.querySelector(".replay-day");
  if (!label) { label = document.createElement("div"); label.className = "replay-day"; track.appendChild(label); }
  const teams = state.teams;
  const { totalDays } = state;
  const finish = state.rules.teamSize * state.rules.dailyCap * totalDays;
  const dots = new Map([...track.querySelectorAll(".lane")].map((l) => [l.dataset.team, l.querySelector(".runner-dot")]));
  // ใช้สเกลของโหมดปัจจุบัน: full = ÷เส้นชัย, zoom = ช่วงคะแนนสุดท้าย
  const leader = Math.max(0, ...teams.map((t) => t.pts)), lowest = Math.min(...teams.map((t) => t.pts));
  const zoom = trackMode === "zoom" && leader > 0;
  let lo = 0, hi = finish;
  if (zoom) { const span = Math.max(leader - lowest, leader * 0.15, 1); lo = 0; hi = leader + span * 0.35; }
  const pos = (v) => Math.min(97, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  const stepMs = Math.max(80, Math.min(300, 3000 / state.days.length));
  for (let i = 0; i < state.days.length; i++) {
    label.textContent = `วันที่ ${i + 1} · ${fmtDateShort(state.days[i])}`;
    for (const t of teams) { const d = dots.get(t.id); if (d) d.style.left = pos(t.cumulative[i]) + "%"; }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  label.textContent = "";
  track.classList.remove("is-replay");
  btn.disabled = false;
  replaying = false;
}
$("track-replay").addEventListener("click", replayTrack);

// ── อันดับทีม ───────────────────────────────────────────────────────
function renderBoard(teams, rules) {
  $("board").innerHTML = teams
    .map((t) => {
      const pct = t.maxPossible ? Math.min(100, (t.pts / t.maxPossible) * 100) : 0;
      const medal = t.pts > 0 && t.rank <= 3 ? ["🥇", "🥈", "🥉"][t.rank - 1] : t.rank;
      const tags = [];
      if (t.hot) tags.push(`<span class="tag hot">🔥 มาแรงวันนี้ +${fmtPts(t.todayPts)}</span>`);
      if (t.rankDelta > 0) tags.push(`<span class="tag up">▲ ${t.rankDelta}</span>`);
      if (t.rankDelta < 0) tags.push(`<span class="tag down">▼ ${-t.rankDelta}</span>`);
      if (t.rank === 1 && t.pts > 0) tags.push(`<span class="tag lead">👑 ผู้นำ</span>`);
      else if (t.gap > 0) tags.push(`<span class="tag gap">ห่างผู้นำ ${fmtPts(t.gap)}</span>`);
      if (t.scale !== 1) tags.push(`<span class="tag gap" title="คะแนนรวมจริง ${fmtPts(t.rawPts)} × ${rules.teamSize}/${t.members.length}">👥 ${t.members.length} คน ×${rules.teamSize}/${t.members.length}</span>`);
      for (const bk of t.badges || []) tags.push(`<span class="tag badge-fun" title="${BADGES[bk].title}">${BADGES[bk].label}</span>`);
      return `
      <li class="team-card ${t.pts > 0 && t.rank <= 3 ? `is-top top${t.rank}` : ""}" style="--team:${esc(t.color)}" data-team="${esc(t.id)}" tabindex="0" role="button" aria-label="ดูรายละเอียด${esc(t.name)}">
        <div class="rank r${t.rank}">${medal}</div>
        <div class="badge">${esc(t.id)}</div>
        <div>
          <div class="team-name">${esc(t.name)}</div>
        </div>
        <div class="team-pts"><b data-count="${t.pts}">${fmtPts(t.pts)}</b><small>คะแนน</small></div>
        ${tags.length ? `<div class="tags">${tags.join("")}</div>` : ""}
        <div class="team-fill" title="${Math.round(pct)}% ของคะแนนเต็มที่เป็นไปได้"><span style="width:${pct}%"></span></div>
      </li>`;
    })
    .join("");
  countUp();

}

// นักวิ่งสปรินต์สไตล์ pictogram + เส้นความเร็ว (viewBox 120×100 หันขวา) สลับขา 2 เฟรมด้วย CSS
const SPRINT_BODY = "M90 36 L68 62";
const SPRINT_POSES = [
  { arms: "M88 38 L108 44 L112 26 M88 38 L72 50 L58 42", legs: "M68 62 L88 70 L94 92 M68 62 L48 76 L28 70" },
  { arms: "M88 38 L102 30 L116 40 M88 38 L76 46 L62 56", legs: "M68 62 L80 82 L72 98 M68 62 L52 74 L38 88" },
];
const runnerSvg = () => `<svg class="sprint" viewBox="0 0 120 100" aria-hidden="true">
  <g class="speed"><path d="M14 22 H40" /><path d="M4 42 H30" /><path d="M10 62 H36" /><path d="M2 82 H26" /></g>
  <circle cx="100" cy="22" r="10" class="head"/><path d="${SPRINT_BODY}"/>
  <g class="pose p1"><path d="${SPRINT_POSES[0].arms}"/><path d="${SPRINT_POSES[0].legs}"/></g>
  <g class="pose p2"><path d="${SPRINT_POSES[1].arms}"/><path d="${SPRINT_POSES[1].legs}"/></g>
</svg>`;

// สนามแข่ง 2 โหมด
//   zoom: ขยายช่วง [ทีมท้าย .. ทีมนำ] ให้เต็มเลน (มี ⋯ ตัดแกนซ้าย, ธงจางบอกระยะที่เหลือ) — เห็นระยะห่างระหว่างทีมชัด
//   full: ตำแหน่ง = คะแนน ÷ คะแนนเต็มทั้งกิจกรรม (สเกลจริง) เส้นประ = วันที่ผ่านไป
let trackMode = "zoom";
try { trackMode = localStorage.getItem("rc-track") || "zoom"; } catch {}

function renderTrack(teams, rules) {
  const { totalDays, daysElapsed } = state;
  const finish = rules.teamSize * rules.dailyCap * totalDays;
  const leader = Math.max(0, ...teams.map((t) => t.pts));
  const lowest = Math.min(...teams.map((t) => t.pts));
  const zoom = trackMode === "zoom" && leader > 0;
  // ช่วงที่มองเห็น
  let lo = 0, hi = finish;
  if (zoom) {
    const span = Math.max(leader - lowest, leader * 0.15, 1);
    lo = Math.max(0, lowest - span * 0.25);
    hi = leader + span * 0.35;
  }
  const pos = (v) => Math.min(97, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  const pacePct = zoom ? -1 : (totalDays ? Math.min(97, (daysElapsed / totalDays) * 100) : 0);
  $("track-note").textContent = zoom
    ? `ซูมช่วง ${fmtPts(lowest)} – ${fmtPts(leader)} คะแนน · 🏁 เส้นชัย ${fmtNum(finish)} ผู้นำอีก ${fmtNum(Math.ceil(finish - leader))}`
    : `สเกลจริง · 🏁 เส้นชัย ${fmtNum(finish)} คะแนน · ผู้นำอีก ${fmtNum(Math.ceil(finish - leader))} · เส้นประ = วันที่ผ่านไป`;
  $("track").classList.toggle("is-zoom", zoom);
  $("track").innerHTML = [...teams]
    .sort((x, y) => x.id.localeCompare(y.id)) // เลนเรียง A–G คงที่ ไม่สลับตามอันดับ
    .map((t) => {
      const pct = pos(t.pts);
      const rankMark = t.pts > 0 && t.rank <= 3 ? ["🥇", "🥈", "🥉"][t.rank - 1] : `<span class="lane-rank-n">${t.rank}</span>`;
      return `<div class="lane ${t.rank === 1 && t.pts > 0 ? "is-leader" : ""}" data-team="${esc(t.id)}" style="--team:${esc(t.color)}">
        <div class="lane-label"><span class="lane-rank">${rankMark}</span><span class="dot-badge">${esc(t.id)}</span><span class="lane-pts">${fmtPts(t.pts)}</span></div>
        <div class="lane-run">
          <div class="lane-line"></div>
          <div class="runner-dot" data-pct="${pct.toFixed(2)}" style="left:0%" title="${esc(t.name)} ${fmtPts(t.pts)} คะแนน">
            <span class="fig">${runnerSvg()}</span>
          </div>
        </div>
      </div>`;
    })
    .join("") + (zoom ? `<div class="axis-break" aria-hidden="true">⋯</div>` : `<div class="pace" style="left:calc(var(--label-w) + (100% - var(--label-w) - 44px) * ${(pacePct / 100).toFixed(4)})"><span>วันที่ ${daysElapsed}</span></div>`) + `<div class="finish ${zoom ? "is-far" : ""}" aria-hidden="true"></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll(".runner-dot").forEach((d) => (d.style.left = `${d.dataset.pct}%`));
  }));
}

// ตารางการ์ดวีคปัจจุบัน: แถว = ทีม A–G, คอลัมน์ = จ–อา, ช่อง = การ์ดที่ใช้วันนั้น (block ยังไม่เฉลย = 🛡️ ไม่บอกเป้า)
function renderWeekCards(teams) {
  const today = todayIso();
  const mon = weekKey(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const DOW = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
  $("week-cards-range").textContent = `${fmtDateShort(days[0])} – ${fmtDateShort(days[6])}`;
  const byId = [...teams].sort((x, y) => x.id.localeCompare(y.id));
  const head = `<thead><tr><th>ทีม</th>${days.map((d, i) => `<th class="${d === today ? "is-today" : ""}">${DOW[i]}<br><small>${d.slice(8)}</small></th>`).join("")}<th>เหลือ</th></tr></thead>`;
  const body = byId.map((t) => {
    const mine = state.cards.filter((c) => c.team.id === t.id && c.week === mon);
    const cells = days.map((d) => {
      const c = mine.find((x) => x.date === d);
      if (!c) return `<td class="${d === today ? "is-today" : ""} zero">·</td>`;
      const who = c.card === "carry" ? `${c.runner}→${c.target}` : c.card === "x2" ? c.runner : c.revealed ? `${c.target} (${c.targetTeam.id})` : "?";
      const stacked = c.stacked ? " is-stacked" : "";
      return `<td class="${d === today ? "is-today" : ""} has-card${stacked}" title="${esc(cardTitle(c))}${c.stacked ? ` — ซ้อนกับทีม ${esc(c.stacked.id)} ไม่มีผลเพิ่ม` : ""}"><span class="wc-ic">${CARDS[c.card].icon}</span><small>${esc(who)}${c.stacked ? " <em>ซ้อน</em>" : ""}</small></td>`;
    }).join("");
    const left = state.cardState[t.id]?.left || [];
    return `<tr><td><span class="dot" style="background:${esc(t.color)}"></span>${esc(t.id)}</td>${cells}<td>${left.length ? left.map((k) => CARDS[k].icon).join(" ") : "–"}</td></tr>`;
  }).join("");
  $("week-cards").innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderTopRunners(runners) {
  const top = runners.filter((r) => r.pts > 0).slice(0, 3);
  $("top-runners-card").hidden = top.length === 0;
  $("top-runners").innerHTML = top
    .map((r, i) => `<li>
      <span class="tr-medal">${["🥇", "🥈", "🥉"][i]}</span>
      <span class="tr-name">${esc(r.name)} <small style="color:${esc(r.team.color)}">● ${esc(r.team.name)}</small></span>
      <b>${fmtPts(r.pts)}</b></li>`)
    .join("");
}

// ตัวเลขคะแนนนับขึ้นจาก 0 ตอนวาดการ์ด
function countUp(ms = 900) {
  const els = [...document.querySelectorAll("[data-count]")];
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    els.forEach((el) => (el.textContent = fmtPts(Number(el.dataset.count) * e)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderRules(r) {
  $("rules").innerHTML = `
    <li>วิ่งสวน / วิ่งลู่ <b>1 กม. = ${fmtPts(r.pointsPerRunKm)} คะแนน</b></li>
    <li>เดิน <b>${fmtNum(r.walkStepsForFull)} ก้าว = ${fmtPts(r.dailyCap)} คะแนน</b> (คิดตามสัดส่วน)</li>
    <li>ปั่นจักรยาน <b>${fmtNum(r.bikeKmForFull)} กม. = ${fmtPts(r.dailyCap)} คะแนน</b> (คิดตามสัดส่วน)</li>
    <li>🏸 แบด · 🎾 เทนนิส · ⚽ ฟุตบอล · 🏊 ว่ายน้ำ · 🏀 บาส · 🏋️ ฟิตเนส · 🧘 โยคะ · 🪢 กระโดดเชือก <b>${fmtNum(r.sportMinutesForFull)} นาที = ${fmtPts(r.dailyCap)} คะแนน</b> (คิดตามสัดส่วน · ต่ำกว่า ${fmtNum(r.sportMinMinutes)} นาทีไม่นับ)</li>
    <li><b>1 คน ส่งได้ 1 กิจกรรม/วัน</b> · ไม่เกิน <b>${fmtPts(r.dailyCap)} คะแนน/คน/วัน</b></li>
    <li>คะแนนทีม = ผลรวมคะแนนของสมาชิกทุกคน · ทีมที่ไม่ใช่ ${fmtNum(r.teamSize)} คน <b>คิดตามสัดส่วน</b> (ผลรวม × ${fmtNum(r.teamSize)} ÷ จำนวนคน เช่น ทีม 6 คน × ${fmtNum(r.teamSize)}/6)</li>
    <li>วิ่งลู่ถ่ายรูปคู่ลู่ให้เห็นระยะ · วิ่งสวนส่งผลจากแอป</li>`;
  $("badges-rules").innerHTML = Object.values(BADGES).map((b) => `<li><b>${b.label}</b> — ${b.title}</li>`).join("");
}

// ── รายวัน ─────────────────────────────────────────────────────────
// ข้อความอธิบายการ์ด 1 ใบ เช่น "🎒 Jay → Bird +5"
function cardTitle(c) {
  if (c.card === "carry") return `🎒 ${c.runner} → ${c.target}${c.amount ? ` +${fmtPts(c.amount)}` : " (ไม่มีส่วนเกิน)"}`;
  if (c.card === "x2") return `✖️2 ${c.runner}`;
  return c.revealed ? `🛡️ block ${c.target} (${c.targetTeam.id})` : "🛡️ block — เฉลยพรุ่งนี้";
}

function renderDaySummary(teams, days) {
  const { dayStats, starStreak, runners } = state;
  const card = $("day-summary-card");
  card.hidden = !dayStats.length;
  if (!dayStats.length) return;
  const i = dayStats.length - 1;
  const d = dayStats[i], prev = dayStats[i - 1];
  $("day-summary-date").textContent = fmtDateLong(d.date);
  const delta = prev ? d.total - prev.total : 0;
  const deltaHtml = prev ? `<small class="${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${fmtPts(Math.abs(delta))} จากเมื่อวาน</small>` : "";
  const winner = d.winners[0];
  const star = d.stars[0];
  $("day-summary").innerHTML = `
    <div class="stat"><b>${fmtPts(d.total)}</b><small>คะแนนรวมวันนี้</small>${deltaHtml}</div>
    <div class="stat"><b>${d.submitters}<span class="dim">/${runners.length}</span></b><small>คนส่งผล</small></div>
    <div class="stat" ${winner ? `style="--team:${esc(winner.color)}"` : ""}><b>${winner ? `<span class="dot-badge mini">${esc(winner.id)}</span> ${fmtPts(d.winnerPts)}` : "–"}</b><small>🏆 ทีมชนะวันนี้${d.winners.length > 1 ? " (เสมอ)" : ""}</small></div>
    <div class="stat"><b>${star ? esc(star.name) + (d.stars.length > 1 ? ` <span class="dim">+${d.stars.length - 1}</span>` : "") : "–"}</b><small>⭐ ดาวประจำวัน${star ? ` · ทำได้ ${fmtPts(d.starPts)}` : ""}${starStreak > 1 ? ` · 🔥 ${starStreak} วันติด` : ""}</small></div>`;
  const todayCards = state.cardsByDate[d.date] || [];
  const hidden = state.cards.filter((c) => c.date === d.date && !c.revealed).length;
  $("day-cards").hidden = !(todayCards.length || hidden);
  $("day-cards").innerHTML = "🃏 การ์ดวันนี้: " + [
    ...todayCards.map((c) => `<span class="dc" style="--team:${esc(c.team.color)}"><span class="dot-badge mini">${esc(c.team.id)}</span> ${esc(cardTitle(c))}</span>`),
    ...(hidden ? [`<span class="dc dim">🛡️ block ${hidden} ใบ (เฉลยพรุ่งนี้)</span>`] : []),
  ].join("");
}

function renderDaily(teams, days) {
  renderDaySummary(teams, days);
  const labels = days.map(fmtDateShort);
  const common = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true, color: textColor() } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: textColor(), maxTicksLimit: 10 } },
      y: { beginAtZero: true, grid: { color: gridColor() }, ticks: { color: textColor() } },
    },
  };
  if (!days.length) {
    charts["chart-daily"]?.destroy();
    delete charts["chart-daily"]; // ไม่งั้นตอนสลับแท็บจะ resize() กราฟที่ทำลายแล้ว → error
    $("daily-table").innerHTML = `<tr><td class="empty">ยังไม่ถึงวันเริ่มกิจกรรม</td></tr>`;
    return;
  }
  // แท่งแยกทีม (ไม่ซ้อน) เฉพาะ 7 วันล่าสุด เรียงทีม A–G
  const N = 7, from = Math.max(0, days.length - N);
  const byId = [...teams].sort((x, y) => x.id.localeCompare(y.id));
  drawChart("chart-daily", {
    type: "bar",
    data: {
      labels: labels.slice(from),
      datasets: byId.map((t) => ({ label: t.id, data: t.daily.slice(from), backgroundColor: alpha(t.color, 0.8), borderRadius: 3, categoryPercentage: 0.85, barPercentage: 0.9 })),
    },
    options: { ...common, plugins: { ...common.plugins, tooltip: { callbacks: { label: (c) => ` ${byId[c.datasetIndex].name}: ${fmtPts(c.raw)}` } } } },
  });

  // ตาราง: แถว = วัน, คอลัมน์ = ทีม (เรียงตามอันดับ)
  const { dayStats } = state;
  const head = `<thead><tr><th>วันที่</th>${teams.map((t) => `<th><span class="dot" style="background:${esc(t.color)}"></span>${esc(t.id)}</th>`).join("")}<th>รวม</th><th>⭐ ดาวประจำวัน</th></tr></thead>`;
  const shown = dailyShowAll ? days.map((d, i) => i) : days.map((d, i) => i).slice(-7);
  const body = shown
    .map((i) => {
      const d = days[i];
      const ds = dayStats[i];
      const dayCards = state.cardsByDate[d] || [];
      const cells = teams.map((t) => {
        const v = t.daily[i];
        const win = ds.winners.includes(t);
        // การ์ดที่ "กระทบ" ทีมนี้ในวันนั้น: ทีมใช้เอง (carry/x2) หรือโดน block
        const icons = dayCards.filter((c) => (c.card !== "block" && c.team.id === t.id) || (c.card === "block" && c.targetTeam.id === t.id))
          .map((c) => `<span class="card-ic" title="${esc(cardTitle(c))}">${CARDS[c.card].icon}</span>`).join("");
        return `<td class="${v ? (win ? "win" : "") : "zero"}" ${win ? `style="color:${esc(t.color)}"` : ""}>${icons}${v ? (win ? "🏆 " : "") + fmtPts(v) : "–"}</td>`;
      }).join("");
      const star = ds.stars.length ? `${esc(ds.stars[0].name)}${ds.stars.length > 1 ? ` +${ds.stars.length - 1}` : ""} <small style="color:${esc(ds.stars[0].team.color)}">● ${esc(ds.stars[0].team.id)}</small> <small>ทำได้ ${fmtPts(ds.starPts)}</small>` : "–";
      return `<tr><td>${fmtDateShort(d)}</td>${cells}<td>${fmtPts(ds.total)}</td><td class="star-cell">${star}</td></tr>`;
    })
    .reverse()
    .join("");
  const foot = `<tfoot>
    <tr><td>🏆 ชนะ (วัน)</td>${teams.map((t) => `<td>${t.stageWins || "–"}</td>`).join("")}<td></td><td></td></tr>
    <tr><td>รวม</td>${teams.map((t) => `<td>${fmtPts(t.pts)}</td>`).join("")}<td>${fmtPts(teams.reduce((s, t) => s + t.pts, 0))}</td><td></td></tr>
  </tfoot>`;
  $("daily-table").innerHTML = head + `<tbody>${body}</tbody>` + foot;
  const btn = $("daily-toggle");
  btn.hidden = days.length <= 7;
  btn.textContent = dailyShowAll ? "แสดงแค่ 7 วันล่าสุด" : `ดูทั้งหมด (${days.length} วัน)`;
}

// ── รายทีม ─────────────────────────────────────────────────────────
function renderTeamChips(teams) {
  $("team-chips").innerHTML = [...teams]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => `<button class="chip ${t.id === selectedTeam ? "is-active" : ""}" style="--team:${esc(t.color)}" data-team="${esc(t.id)}" role="tab" aria-selected="${t.id === selectedTeam}">${esc(t.name)}</button>`)
    .join("");
}

function renderTeam(t) {
  if (!t) return ($("team-detail").innerHTML = `<p class="empty">ไม่มีข้อมูลทีม</p>`);
  const { rules, daysElapsed } = state;
  const today = todayIso();
  const maxPerRunner = rules.dailyCap * daysElapsed;
  const sum = (a, digits = 0) => (t.byActivity[a] ? `${fmtNum(t.byActivity[a], digits)}` : "0"); // ยอดรวมต่อกิจกรรมของทีม
  const sportMin = TIMED.reduce((s, k) => s + (t.byActivity[k] || 0), 0);

  const runners = t.runners
    .map((r, i) => {
      // เรียงคงที่ วิ่งสวน → วิ่งลู่ → เดิน → ปั่น แล้วรวมกีฬาอื่น ๆ (นาที) เป็นก้อนเดียว
      const parts = ["run", "treadmill", "walk", "bike"].filter((a) => r.byActivity[a]).map((a) => `${act(a).icon} ${fmtNum(r.byActivity[a], a === "walk" ? 0 : 1)} ${act(a).unit}`);
      const other = Object.entries(r.byActivity).reduce((s, [a, v]) => s + (act(a).timed ? v : 0), 0);
      if (other) parts.push(`🏸 ${fmtNum(other)} นาที`);
      const pct = maxPerRunner ? Math.min(100, (r.pts / maxPerRunner) * 100) : 0;
      return `
      <li class="runner is-clickable" data-runner="${esc(r.name)}" tabindex="0" role="button" aria-expanded="false" aria-label="ดูผลของ ${esc(r.name)}">
        <span class="n">${i + 1}</span>
        <div><div class="name">${esc(r.name)}</div>
          <div class="detail">ส่งผล ${r.daysActive}/${daysElapsed} วัน${parts.length ? " · " + parts.join(" · ") : ""}</div></div>
        <div class="pts">${fmtPts(r.pts)}<small>คะแนน</small></div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="runner-log" hidden></div>
      </li>`;
    })
    .join("");

  // รายการล่าสุด: เฉพาะ 7 วันหลังสุดของกิจกรรม
  const since = state.days.length ? state.days[Math.max(0, state.days.length - 7)] : "";
  const log = state.entries
    .filter((e) => e.team.id === t.id && e.date >= since)
    .map((e) => `<li><span class="d">${fmtDateShort(e.date)}</span><span>${esc(e.runner)}</span>${e.note ? `<span class="note">${esc(e.note)}</span>` : ""}<span class="a">${act(e.activity).icon} ${fmtNum(e.amount, act(e.activity).timed || e.activity === "walk" ? 0 : 2)} ${act(e.activity).unit}</li>`)
    .join("");

  $("team-detail").innerHTML = `
    <div class="card" style="--team:${esc(t.color)}">
      <div class="team-head">
        <div class="badge">${esc(t.id)}</div>
        <div><h2 style="margin:0">${esc(t.name)}</h2><small style="color:var(--muted)">อันดับ ${t.rank} · สมาชิก ${t.members.length} คน · วันนี้ส่งแล้ว ${t.runners.filter((r) => (r.raw[today] || 0) > 0).length}/${t.members.length} คน · ${t.entries} รายการ</small></div>
        <div class="pts"><b>${fmtPts(t.pts)}</b><small>${t.scale !== 1 ? `รวมจริง ${fmtPts(t.rawPts)} × ${rules.teamSize}/${t.members.length}` : "คะแนน"}</small></div>
      </div>
      <div class="stat-row">
        <div class="stat"><b>${sum("run", 1)}</b><small>🏃 วิ่งสวน กม.</small></div>
        <div class="stat"><b>${sum("treadmill", 1)}</b><small>🏃‍♂️ วิ่งลู่ กม.</small></div>
        <div class="stat"><b>${sum("walk")}</b><small>🚶 เดิน ก้าว</small></div>
        <div class="stat"><b>${sum("bike", 1)}</b><small>🚴 ปั่น กม.</small></div>
        <div class="stat"><b>${fmtNum(sportMin)}</b><small>🏸 กีฬาอื่น ๆ นาที</small></div>
      </div>
    </div>
    <div class="card" style="--team:${esc(t.color)}">
      <h2>สมาชิก</h2>
      <ol class="runners">${runners}</ol>
    </div>
    <div class="card">
      <h2>รายการล่าสุด <small class="dim">7 วันหลังสุด</small></h2>
      ${log ? `<ul class="log">${log}</ul>` : `<p class="empty">ยังไม่มีรายการ</p>`}
    </div>`;
}

// แตะชื่อสมาชิก → กางรายการผลของคนนั้น (วันที่ · กิจกรรม · จำนวน · คะแนนวันนั้น)
// ป้ายผลของการ์ดต่อคนต่อวัน (ในรายการที่กางดู)
function cardNote(r, date) {
  const c = r.cardDays[date];
  if (!c) return "";
  const parts = [];
  if (c.blockedBy) parts.push(`🛡️ โดน block (${c.blockedBy.map((t) => t.id).join(", ")}) → 0`);
  else {
    if (c.carriedIn) parts.push(`🎒 +${fmtPts(c.carriedIn)} จาก ${c.carriedFrom}`);
    if (c.carriedOut) parts.push(`🎒 โอน ${fmtPts(c.carriedOut)} ให้เพื่อน`);
    if (c.x2) parts.push(`✖️2 → ${fmtPts(r.days[date])}`);
  }
  return parts.map((p) => `<small class="cardnote">${p}</small>`).join("");
}

function toggleRunner(li) {
  const name = li.dataset.runner;
  const box = li.querySelector(".runner-log");
  const open = box.hidden;
  li.closest(".runners").querySelectorAll(".runner").forEach((o) => {
    o.querySelector(".runner-log").hidden = true;
    o.classList.remove("is-open");
    o.setAttribute("aria-expanded", "false");
  });
  if (!open) return;
  const r = state.runners.find((x) => x.name === name);
  const list = state.entries.filter((e) => e.runner === name);
  box.innerHTML = list.length
    ? `<ul class="log">${list.map((e) => `<li>
        <span class="d">${fmtDateShort(e.date)}</span>
        <span>${act(e.activity).icon} ${act(e.activity).label} ${fmtNum(e.amount, act(e.activity).timed || e.activity === "walk" ? 0 : 2)} ${act(e.activity).unit}</span>
        ${e.note ? `<span class="note">${esc(e.note)}</span>` : ""}
        <span class="a"><b>+${fmtPts(rawPoints(e.activity, e.amount, state.rules))}</b>${(r.raw[e.date] || 0) > state.rules.dailyCap ? `<small class="capped">วันนี้รวม ${fmtPts(r.raw[e.date])} → นับ ${fmtPts(state.rules.dailyCap)}</small>` : ""}${cardNote(r, e.date)}</span>
      </li>`).join("")}</ul>`
    : `<p class="empty">ยังไม่มีรายการ</p>`;
  box.hidden = false;
  li.classList.add("is-open");
  li.setAttribute("aria-expanded", "true");
}
$("team-detail").addEventListener("click", (e) => {
  const li = e.target.closest(".runner[data-runner]");
  if (li) toggleRunner(li);
});
$("team-detail").addEventListener("keydown", (e) => {
  const li = e.target.closest(".runner[data-runner]");
  if (li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleRunner(li); }
});

// ── chart helpers ──────────────────────────────────────────────────
function drawChart(id, cfg) {
  charts[id]?.destroy();
  cfg.options = { responsive: true, maintainAspectRatio: false, ...cfg.options };
  charts[id] = new Chart($(id), cfg);
}
const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const surfaceColor = () => (dark() ? "#181b26" : "#ffffff");
// "#rrggbb" → "rgba(r,g,b,a)"
const alpha = (hex, a) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : hex;
};
const gridColor = () => (dark() ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)");
const textColor = () => (dark() ? "#9a9fb3" : "#676b7e");

// ── events ─────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll(".tab").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on);
  });
  document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== `panel-${name}`));
  // chart ที่วาดตอน panel ซ่อนอยู่จะมีขนาด 0 ต้อง resize ตอนโชว์
  Object.values(charts).forEach((c) => c.resize());
}

document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
$("refresh").addEventListener("click", refresh);
$("daily-toggle").addEventListener("click", () => { dailyShowAll = !dailyShowAll; renderDaily(state.teams, state.days); });
$("track-mode").addEventListener("click", (e) => {
  const b = e.target.closest("[data-v]");
  if (!b) return;
  trackMode = b.dataset.v;
  try { localStorage.setItem("rc-track", trackMode); } catch {}
  document.querySelectorAll("#track-mode button").forEach((x) => x.classList.toggle("is-active", x.dataset.v === trackMode));
  if (state) renderTrack(state.teams, state.rules); // ถ้ากดก่อนโหลดเสร็จ จะวาดตามโหมดที่เลือกตอนโหลดเสร็จเอง
});
$("board").addEventListener("click", (e) => openTeam(e.target.closest("[data-team]")));
$("board").addEventListener("keydown", (e) => e.key === "Enter" && openTeam(e.target.closest("[data-team]")));
$("team-chips").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-team]");
  if (!chip) return;
  selectedTeam = chip.dataset.team;
  renderTeamChips(state.teams);
  renderTeam(state.teams.find((t) => t.id === selectedTeam));
});
function openTeam(el) {
  if (!el) return;
  selectedTeam = el.dataset.team;
  renderTeamChips(state.teams);
  renderTeam(state.teams.find((t) => t.id === selectedTeam));
  showTab("team");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state && render(new Date()));

document.querySelectorAll("#track-mode button").forEach((x) => x.classList.toggle("is-active", x.dataset.v === trackMode));
refresh();
