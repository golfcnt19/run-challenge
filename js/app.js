// โหลดข้อมูล → คิดคะแนน → วาดหน้า
import { loadAll } from "./sheets.js";
import { computeScores, ACTIVITIES } from "./scoring.js";
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

// สนามแข่ง: ตำแหน่ง = คะแนน ÷ คะแนนเต็มทั้งกิจกรรม (สเกลจริง วันแรก ๆ ทุกทีมอยู่ต้นสนาม) เส้นประ = วันที่ผ่านไป
function renderTrack(teams, rules) {
  const { totalDays, daysElapsed } = state;
  const members = Math.max(1, ...teams.map((t) => t.members.length));
  const finish = members * rules.dailyCap * totalDays;
  const leader = Math.max(0, ...teams.map((t) => t.pts));
  const windowMax = finish;
  const pacePct = totalDays ? Math.min(97, (daysElapsed / totalDays) * 100) : 0;
  $("track-note").textContent = `🏁 เส้นชัย ${fmtNum(finish)} คะแนน · ผู้นำอีก ${fmtNum(Math.ceil(finish - leader))}`;
  $("track").innerHTML = [...teams]
    .sort((x, y) => x.id.localeCompare(y.id)) // เลนเรียง A–G คงที่ ไม่สลับตามอันดับ
    .map((t) => {
      const pct = Math.min(97, (t.pts / windowMax) * 100);
      return `<div class="lane" style="--team:${esc(t.color)}">
        <div class="lane-label"><span class="dot-badge">${esc(t.id)}</span><span class="lane-pts">${fmtPts(t.pts)}</span></div>
        <div class="lane-run">
          <div class="lane-line"></div>
          <div class="runner-dot" data-pct="${pct.toFixed(2)}" style="left:0%" title="${esc(t.name)} ${fmtPts(t.pts)} คะแนน">
            <span class="fig">${runnerSvg()}</span>
          </div>
        </div>
      </div>`;
    })
    .join("") + `<div class="pace" style="left:calc(var(--label-w) + (100% - var(--label-w) - 44px) * ${(pacePct / 100).toFixed(4)})"><span>วันที่ ${daysElapsed}</span></div><div class="finish" aria-hidden="true"></div>`;
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
}

// ── รายวัน ─────────────────────────────────────────────────────────
function renderDaily(teams, days) {
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
    ["chart-cumulative", "chart-daily"].forEach((id) => charts[id]?.destroy());
    $("daily-table").innerHTML = `<tr><td class="empty">ยังไม่ถึงวันเริ่มกิจกรรม</td></tr>`;
    return;
  }
  drawChart("chart-cumulative", {
    type: "line",
    data: {
      labels,
      datasets: teams.map((t) => ({
        label: t.name, data: t.cumulative, borderColor: t.color, backgroundColor: t.color,
        tension: 0.3, pointRadius: days.length > 20 ? 0 : 3, borderWidth: 2,
      })),
    },
    options: common,
  });
  drawChart("chart-daily", {
    type: "bar",
    data: { labels, datasets: teams.map((t) => ({ label: t.name, data: t.daily, backgroundColor: t.color })) },
    options: { ...common, scales: { ...common.scales, x: { ...common.scales.x, stacked: true }, y: { ...common.scales.y, stacked: true } } },
  });

  // ตาราง: แถว = วัน, คอลัมน์ = ทีม (เรียงตามอันดับ)
  const head = `<thead><tr><th>วันที่</th>${teams.map((t) => `<th><span class="dot" style="background:${esc(t.color)}"></span>${esc(t.id)}</th>`).join("")}<th>รวม</th></tr></thead>`;
  const body = days
    .map((d, i) => {
      const cells = teams.map((t) => `<td class="${t.daily[i] ? "" : "zero"}">${t.daily[i] ? fmtPts(t.daily[i]) : "–"}</td>`).join("");
      const sum = teams.reduce((s, t) => s + t.daily[i], 0);
      return `<tr><td>${fmtDateShort(d)}</td>${cells}<td>${fmtPts(sum)}</td></tr>`;
    })
    .reverse()
    .join("");
  const foot = `<tfoot><tr><td>รวม</td>${teams.map((t) => `<td>${fmtPts(t.pts)}</td>`).join("")}<td>${fmtPts(teams.reduce((s, t) => s + t.pts, 0))}</td></tr></tfoot>`;
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
      <li class="runner">
        <span class="n">${i + 1}</span>
        <div><div class="name">${esc(r.name)}</div>
          <div class="detail">ส่งผล ${r.daysActive}/${daysElapsed} วัน${parts.length ? " · " + parts.join(" · ") : ""}</div></div>
        <div class="pts">${fmtPts(r.pts)}<small>คะแนน</small></div>
        <div class="bar"><span style="width:${pct}%"></span></div>
      </li>`;
    })
    .join("");

  const log = state.entries
    .filter((e) => e.team.id === t.id)
    .slice(0, 30)
    .map((e) => `<li><span class="d">${fmtDateShort(e.date)}</span><span>${esc(e.runner)}</span>${e.note ? `<span class="note">${esc(e.note)}</span>` : ""}<span class="a">${ACTIVITIES[e.activity].icon} ${fmtNum(e.amount, e.activity === "walk" ? 0 : 2)} ${ACTIVITIES[e.activity].unit}</span></li>`)
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
      <h2>รายการล่าสุด</h2>
      ${log ? `<ul class="log">${log}</ul>` : `<p class="empty">ยังไม่มีรายการ</p>`}
    </div>`;
}

// ── chart helpers ──────────────────────────────────────────────────
function drawChart(id, cfg) {
  charts[id]?.destroy();
  cfg.options = { responsive: true, maintainAspectRatio: false, ...cfg.options };
  charts[id] = new Chart($(id), cfg);
}
const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
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
  try { localStorage.setItem("rc-tab", name); } catch {}
}

document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
$("refresh").addEventListener("click", refresh);
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

let saved = null;
try { saved = localStorage.getItem("rc-tab"); } catch {}
if (saved && document.querySelector(`.tab[data-tab="${saved}"]`)) showTab(saved);
refresh();
