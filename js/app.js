// โหลดข้อมูล → คิดคะแนน → วาดหน้า
import { loadAll } from "./sheets.js";
import { computeScores, ACTIVITIES, CARDS, CARD_TYPES, rawPoints } from "./scoring.js";
import { fmtDateShort, fmtDateLong, fmtTime, fmtNum, fmtPts, todayIso } from "./format.js";
import { USE_SAMPLE } from "./config.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let state = null; // ผลจาก computeScores
let selectedTeam = null;
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
  else $("progress-text").textContent = `วันที่ ${daysElapsed} ของ ${totalDays}`;
  const daysLeft = Math.max(0, totalDays - daysElapsed);
  $("progress-days").textContent = today > rules.endDate ? `${pct}%` : `เหลืออีก ${daysLeft} วัน · ${pct}%`;

  $("updated").textContent = `อัปเดต ${fmtDateShort(today)} ${fmtTime(loadedAt)}${USE_SAMPLE ? " · ข้อมูลตัวอย่าง" : ""}`;

  $("warnings").hidden = warnings.length === 0;
  $("warn-count").textContent = warnings.length;
  $("warn-list").innerHTML = warnings.map((w) => `<li>${esc(w)}</li>`).join("");

  renderTrack(teams, rules);
  renderBoard(teams, rules);
  renderTopRunners(state.runners);
  renderRules(rules);
  renderDaily(teams, days);
  if (!selectedTeam || !teams.some((t) => t.id === selectedTeam)) selectedTeam = teams[0]?.id;
  renderTeamChips(teams);
  renderTeam(teams.find((t) => t.id === selectedTeam));
  $("foot-note").textContent = `${teams.length} ทีม · ${state.runners.length} คน · ${state.entries.length} รายการ`;
}

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
      const cs = state.cardState[t.id];
      if (cs) tags.push(`<span class="tag cards" title="การ์ดวีคนี้">🃏 ${CARD_TYPES.map((k) => `<span class="${cs.used[k] ? "used" : ""}">${CARDS[k].icon}</span>`).join("")}</span>`);
      return `
      <li class="team-card ${t.rank === 1 && t.pts > 0 ? "is-leader" : ""}" style="--team:${esc(t.color)}" data-team="${esc(t.id)}" tabindex="0" role="button" aria-label="ดูรายละเอียด${esc(t.name)}">
        <div class="rank r${t.rank}">${medal}</div>
        <div class="badge">${esc(t.id)}</div>
        <div>
          <div class="team-name">${esc(t.name)}</div>
          <div class="team-sub">
            <span>${t.activeMembers}/${t.members.length} คนส่งผล</span>
            <span>${t.entries} รายการ</span>
          </div>
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
  const members = Math.max(1, ...teams.map((t) => t.members.length));
  const finish = members * rules.dailyCap * totalDays;
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
      return `<div class="lane ${t.rank === 1 && t.pts > 0 ? "is-leader" : ""}" style="--team:${esc(t.color)}">
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
    <li>รวมทุกกิจกรรมในวันเดียวได้ แต่ <b>ไม่เกิน ${fmtPts(r.dailyCap)} คะแนน/คน/วัน</b></li>
    <li>คะแนนทีม = ผลรวมคะแนนของสมาชิกทุกคน</li>
    <li>วิ่งลู่ถ่ายรูปคู่ลู่ให้เห็นระยะ · วิ่งสวนส่งผลจากแอป</li>`;
  $("cards-lead").innerHTML = `ทีมละ <b>3 ใบ/วีค</b> (จันทร์–อาทิตย์) ชนิดละใบ · <b>วันละ 1 ใบ</b> · ใช้กับวันที่กดเท่านั้น`;
  $("cards-rules").innerHTML = `
    <li>🎒 <b>เดอะแบก</b> โอนส่วนที่เกิน ${fmtPts(r.dailyCap)} ของผู้ให้ไปให้เพื่อนร่วมทีม 1 คน สูงสุด ${fmtPts(r.dailyCap)} (ผู้รับยังไม่เกิน ${fmtPts(r.dailyCap)})</li>
    <li>✖️2 <b>คูณสอง</b> ระบบสุ่มสมาชิก 1 คน คะแนนวันนั้น ×2 สูงสุด ${fmtPts(r.dailyCap * 2)}</li>
    <li>🛡️ <b>Block</b> เลือกคนทีมอื่น 1 คน คะแนนวันนั้น = 0 · เฉลยหลังจบวัน · block ชนะทุกอย่าง</li>`;
}

// ── รายวัน ─────────────────────────────────────────────────────────
// ข้อความอธิบายการ์ด 1 ใบ เช่น "🎒 Jay → Bird +5"
function cardTitle(c) {
  if (c.card === "carry") return `🎒 ${c.runner} → ${c.target}${c.amount ? ` +${fmtPts(c.amount)}` : " (ไม่มีส่วนเกิน)"}`;
  if (c.card === "x2") return `✖️2 ${c.runner}`;
  return `🛡️ block ${c.target} (${c.targetTeam.id})`;
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
  const body = days
    .map((d, i) => {
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
  const maxPerRunner = rules.dailyCap * daysElapsed;
  const act = (a, digits = 0) => (t.byActivity[a] ? `${fmtNum(t.byActivity[a], digits)}` : "0");

  const runners = t.runners
    .map((r, i) => {
      const parts = Object.entries(r.byActivity).map(([a, v]) => `${ACTIVITIES[a].icon} ${fmtNum(v, a === "walk" ? 0 : 1)} ${ACTIVITIES[a].unit}`);
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
    .map((e) => `<li><span class="d">${fmtDateShort(e.date)}</span><span>${esc(e.runner)}</span>${e.note ? `<span class="note">${esc(e.note)}</span>` : ""}<span class="a">${ACTIVITIES[e.activity].icon} ${fmtNum(e.amount, e.activity === "walk" ? 0 : 2)} ${ACTIVITIES[e.activity].unit}</li>`)
    .join("");

  $("team-detail").innerHTML = `
    <div class="card" style="--team:${esc(t.color)}">
      <div class="team-head">
        <div class="badge">${esc(t.id)}</div>
        <div><h2 style="margin:0">${esc(t.name)}</h2><small style="color:var(--muted)">อันดับ ${t.rank} · ${t.members.length} คน</small></div>
        <div class="pts"><b>${fmtPts(t.pts)}</b><small>คะแนน</small></div>
      </div>
      <div class="stat-row">
        <div class="stat"><b>${act("run", 1)}</b><small>🏃 วิ่งสวน กม.</small></div>
        <div class="stat"><b>${act("treadmill", 1)}</b><small>🏃‍♂️ วิ่งลู่ กม.</small></div>
        <div class="stat"><b>${act("walk")}</b><small>🚶 เดิน ก้าว</small></div>
        <div class="stat"><b>${act("bike", 1)}</b><small>🚴 ปั่น กม.</small></div>
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
        <span>${ACTIVITIES[e.activity].icon} ${ACTIVITIES[e.activity].label} ${fmtNum(e.amount, e.activity === "walk" ? 0 : 2)} ${ACTIVITIES[e.activity].unit}</span>
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
