// เครื่องคิดคะแนน — จุดเดียวที่ต้องแก้ถ้ากติกาเปลี่ยน
//
// กติกา (ตั้งค่าตัวเลขได้ที่แท็บ config ในชีต):
//   วิ่งสวน / วิ่งลู่   1 กม. = points_per_run_km คะแนน
//   เดิน               walk_steps_for_full ก้าว = เต็มวัน (daily_cap)  คิดตามสัดส่วน
//   ปั่นจักรยาน         bike_km_for_full กม.   = เต็มวัน (daily_cap)  คิดตามสัดส่วน
//   รวมทุกกิจกรรมในวันเดียวกันได้ แต่ไม่เกิน daily_cap ต่อคนต่อวัน
//   คะแนนทีม = ผลรวมคะแนนสมาชิก
//
// การ์ดพิเศษ (แท็บ cards) ทีมละ 3 ใบ/วีค (จันทร์–อาทิตย์) ชนิดละ 1 ใบ วันละ 1 ใบ ใช้กับวันที่กดเท่านั้น
//   carry (🎒 เดอะแบก)  ผู้ให้โอน "ส่วนที่เกินเพดาน" ให้เพื่อนร่วมทีม 1 คน สูงสุด = เพดาน ผู้รับยังติดเพดาน
//   x2    (✖️2)         ระบบสุ่มสมาชิก 1 คน คะแนนวันนั้น ×2 เกินเพดานได้ สูงสุด 2×เพดาน
//   block (🛡️)          เลือกคนทีมอื่น 1 คน คะแนนวันนั้น = 0 · เฉลยหลังจบวัน · block ชนะทุกอย่าง
//   ลำดับคิด: block → carry → x2 → เพดาน

import { todayIso, addDays, daysInclusive, normalizeDate, parseDate, toIso } from "./format.js?v=mtwr0y48";

export const ACTIVITIES = {
  run:       { label: "วิ่งสวน",     unit: "กม.",  icon: "🏃" },
  treadmill: { label: "วิ่งลู่",      unit: "กม.",  icon: "🏃‍♂️" },
  walk:      { label: "เดิน",        unit: "ก้าว", icon: "🚶" },
  bike:      { label: "ปั่นจักรยาน", unit: "กม.",  icon: "🚴" },
};

// ให้แอดมินพิมพ์ในชีตเป็นไทยหรืออังกฤษก็ได้
const ALIASES = {
  run: ["run", "วิ่ง", "วิ่งสวน", "outdoor", "road"],
  treadmill: ["treadmill", "วิ่งลู่", "ลู่", "ลู่วิ่ง"],
  walk: ["walk", "เดิน", "steps", "ก้าว"],
  bike: ["bike", "ปั่น", "ปั่นจักรยาน", "จักรยาน", "cycling", "cycle", "ride"],
};

export function normalizeActivity(s) {
  const v = (s || "").trim().toLowerCase();
  for (const [key, list] of Object.entries(ALIASES)) if (list.includes(v)) return key;
  return null;
}

export const CARDS = {
  carry: { icon: "🎒", label: "เดอะแบก" },
  x2:    { icon: "✖️2", label: "คูณสอง" },
  block: { icon: "🛡️", label: "Block" },
};
export const CARD_TYPES = Object.keys(CARDS);

// วันจันทร์ของสัปดาห์ที่วันนั้นอยู่ (วีคเริ่มจันทร์) — สูตรเดียวกับ Code.gs
export function weekKey(iso) {
  const d = parseDate(iso);
  const dow = (d.getDay() + 6) % 7; // จันทร์ = 0
  d.setDate(d.getDate() - dow);
  return toIso(d);
}

export function readRules(config) {
  const num = (k, d) => {
    const v = parseFloat(config[k]);
    return Number.isFinite(v) ? v : d;
  };
  return {
    title: config.title || "Run Challenge",
    startDate: config.start_date || "2026-09-15",
    endDate: config.end_date || "2026-10-30",
    dailyCap: num("daily_cap", 5),
    pointsPerRunKm: num("points_per_run_km", 1),
    walkStepsForFull: num("walk_steps_for_full", 10000),
    bikeKmForFull: num("bike_km_for_full", 20),
  };
}

// คะแนนดิบของกิจกรรมหนึ่งรายการ (ยังไม่ตัดเพดาน)
export function rawPoints(activity, amount, rules) {
  switch (activity) {
    case "run":
    case "treadmill":
      return amount * rules.pointsPerRunKm;
    case "walk":
      return (amount / rules.walkStepsForFull) * rules.dailyCap;
    case "bike":
      return (amount / rules.bikeKmForFull) * rules.dailyCap;
    default:
      return 0;
  }
}

// สร้างรายชื่อวันในช่วงกิจกรรม: ตั้งแต่วันเริ่ม ถึงวันนี้ (หรือวันที่มีข้อมูลล่าสุด ถ้าเลยวันนี้) แต่ไม่เกินวันสุดท้าย
export function challengeDays(rules, today = todayIso(), lastEntryDate = "") {
  let end = lastEntryDate > today ? lastEntryDate : today;
  if (end > rules.endDate) end = rules.endDate;
  const days = [];
  if (end < rules.startDate) return days;
  for (let d = rules.startDate; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export function computeScores(data, today = todayIso()) {
  const rules = readRules(data.config);
  const warnings = [];

  // --- ทีมและสมาชิก ---
  const teams = data.teams
    .filter((t) => t.team_id)
    .map((t) => ({
      id: t.team_id,
      name: t.team_name || t.team_id,
      color: t.color || "#888",
      members: (t.members || "").split(",").map((s) => s.trim()).filter(Boolean),
    }));
  const runnerTeam = new Map(); // ชื่อ (lowercase) → team
  const runnerName = new Map(); // ชื่อ (lowercase) → ชื่อสะกดตามชีต teams
  for (const t of teams)
    for (const m of t.members) {
      const key = m.toLowerCase();
      if (runnerTeam.has(key)) warnings.push(`ชื่อ "${m}" ซ้ำอยู่ในสองทีม`);
      runnerTeam.set(key, t);
      runnerName.set(key, m);
    }

  // --- อ่านรายการกิจกรรม ---
  const entries = [];
  data.runs.forEach((r, i) => {
    const line = i + 2; // แถวในชีต (มี header)
    if (!r.date && !r.runner && !r.amount) return;
    const date = normalizeDate(r.date);
    const key = (r.runner || "").trim().toLowerCase();
    const team = runnerTeam.get(key);
    const activity = normalizeActivity(r.activity);
    const amount = parseFloat(String(r.amount).replace(/,/g, ""));
    if (!date) return warnings.push(`แถว ${line}: อ่านวันที่ "${r.date}" ไม่ออก (ใช้ YYYY-MM-DD)`);
    if (!team) return warnings.push(`แถว ${line}: ไม่พบชื่อ "${r.runner}" ในทีมไหนเลย`);
    if (!activity) return warnings.push(`แถว ${line}: ไม่รู้จักกิจกรรม "${r.activity}"`);
    if (!Number.isFinite(amount) || amount <= 0) return warnings.push(`แถว ${line}: จำนวน "${r.amount}" ไม่ถูกต้อง`);
    if (date < rules.startDate || date > rules.endDate) return warnings.push(`แถว ${line}: วันที่ ${date} อยู่นอกช่วงกิจกรรม (ไม่นับ)`);
    entries.push({ line, date, runner: runnerName.get(key), team, activity, amount, note: r.note || "", raw: rawPoints(activity, amount, rules) });
  });

  // --- รวมต่อคนต่อวัน แล้วตัดเพดาน ---
  const perRunnerDay = new Map(); // "runner|date" → { raw, pts, byActivity }
  for (const e of entries) {
    const k = `${e.runner}|${e.date}`;
    let d = perRunnerDay.get(k);
    if (!d) perRunnerDay.set(k, (d = { runner: e.runner, team: e.team, date: e.date, raw: 0, pts: 0, byActivity: {} }));
    d.raw += e.raw;
    d.byActivity[e.activity] = (d.byActivity[e.activity] || 0) + e.amount;
  }
  // --- การ์ดพิเศษ ---
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const findMember = (team, name) => team.members.find((m) => m.toLowerCase() === String(name || "").trim().toLowerCase());
  const cards = [];
  (data.cards || []).forEach((r, i) => {
    const line = i + 2;
    if (!r.date && !r.team_id && !r.card) return;
    const date = normalizeDate(r.date);
    const team = teamById.get(String(r.team_id || "").trim().toUpperCase());
    const card = String(r.card || "").trim().toLowerCase();
    if (!date) return warnings.push(`cards แถว ${line}: อ่านวันที่ "${r.date}" ไม่ออก`);
    if (!team) return warnings.push(`cards แถว ${line}: ไม่พบทีม "${r.team_id}"`);
    if (!CARDS[card]) return warnings.push(`cards แถว ${line}: ไม่รู้จักการ์ด "${r.card}"`);
    if (date < rules.startDate || date > rules.endDate) return warnings.push(`cards แถว ${line}: วันที่ ${date} อยู่นอกช่วง (ไม่นับ)`);
    const c = { line, date, team, card, week: weekKey(date), revealed: true };
    if (card === "carry") {
      c.runner = findMember(team, r.runner);
      c.target = findMember(team, r.target_runner);
      if (!c.runner || !c.target) return warnings.push(`cards แถว ${line}: เดอะแบก ต้องมีผู้ให้และผู้รับในทีม ${team.id}`);
      if (c.runner === c.target) return warnings.push(`cards แถว ${line}: เดอะแบก ผู้ให้กับผู้รับเป็นคนเดียวกัน`);
    } else if (card === "x2") {
      c.runner = findMember(team, r.runner);
      if (!c.runner) return warnings.push(`cards แถว ${line}: x2 ไม่พบชื่อ "${r.runner}" ในทีม ${team.id}`);
    } else {
      c.targetTeam = teamById.get(String(r.target_team || "").trim().toUpperCase());
      c.target = c.targetTeam && findMember(c.targetTeam, r.target_runner);
      if (!c.targetTeam || !c.target) return warnings.push(`cards แถว ${line}: block ไม่พบ "${r.target_runner}" ในทีม "${r.target_team}"`);
      if (c.targetTeam.id === team.id) return warnings.push(`cards แถว ${line}: block ทีมตัวเองไม่ได้`);
      c.revealed = date < today; // เฉลยหลังจบวัน
    }
    cards.push(c);
  });
  const dayOf = (runner, date) => {
    const k = `${runner}|${date}`;
    let d = perRunnerDay.get(k);
    if (!d) perRunnerDay.set(k, (d = { runner, team: runnerTeam.get(runner.toLowerCase()), date, raw: 0, pts: 0, byActivity: {} }));
    return d;
  };
  // block (ที่เฉลยแล้ว) ชนะทุกอย่าง
  for (const c of cards) if (c.card === "block" && c.revealed) { const d = dayOf(c.target, c.date); (d.blockedBy ||= []).push(c.team); }
  // carry: โอนส่วนเกินเพดาน สูงสุด = เพดาน
  for (const c of cards) if (c.card === "carry") {
    const g = dayOf(c.runner, c.date), t = dayOf(c.target, c.date);
    const give = Math.min(Math.max(g.raw - rules.dailyCap, 0), rules.dailyCap);
    c.amount = give;
    if (give > 0) { g.carriedOut = (g.carriedOut || 0) + give; t.carriedIn = (t.carriedIn || 0) + give; t.carriedFrom = c.runner; }
  }
  // x2
  for (const c of cards) if (c.card === "x2") dayOf(c.runner, c.date).x2 = true;
  // ตัดเพดาน (คำนวณสุทธิต่อคนต่อวัน)
  for (const d of perRunnerDay.values()) {
    const base = d.raw + (d.carriedIn || 0);
    if (d.blockedBy) d.pts = 0;
    else if (d.x2) d.pts = Math.min(base * 2, rules.dailyCap * 2);
    else d.pts = Math.min(base, rules.dailyCap);
  }
  // ผลของการ์ดแต่ละใบเป็นคะแนน (c.effect = คะแนนที่ทีมได้เพิ่ม/เสีย, c.detail = ข้อความ) — block ที่ยังไม่เฉลย = null
  const cap = rules.dailyCap;
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const c of cards) {
    if (c.card === "carry") {
      const t = dayOf(c.target, c.date);
      const withoutIn = t.blockedBy ? 0 : Math.min(t.raw, cap);
      c.effect = t.pts - withoutIn; // ที่ผู้รับได้เพิ่มจริง (0 ถ้าผู้รับเต็มอยู่แล้ว/โดน block)
      c.detail = c.amount > 0 ? `${c.target} ${r2(withoutIn)} → ${r2(t.pts)}` : "ผู้ให้ไม่มีส่วนเกิน";
    } else if (c.card === "x2") {
      const d = dayOf(c.runner, c.date);
      const without = d.blockedBy ? 0 : Math.min(d.raw + (d.carriedIn || 0), cap);
      c.effect = d.pts - without;
      c.detail = d.blockedBy ? "โดน block ไม่มีผล" : d.raw + (d.carriedIn || 0) > 0 ? `${c.runner} ${r2(without)} → ${r2(d.pts)}` : `${c.runner} ไม่ได้ส่งผล`;
    } else if (c.revealed) {
      const d = dayOf(c.target, c.date);
      const first = d.blockedBy[0]; // ทีมแรกที่ block คนนี้ในวันนั้น (ตามลำดับแถว)
      if (first !== c.team) {
        c.effect = 0;
        c.stacked = first;
        c.detail = `ซ้อนกับทีม ${first.id} — ไม่มีผลเพิ่ม`;
      } else {
        // ถ้าไม่โดน block จะได้เท่าไร (รวม x2/carry ที่มี)
        const base = d.raw + (d.carriedIn || 0);
        const would = d.x2 ? Math.min(base * 2, cap * 2) : Math.min(base, cap);
        c.effect = -would; // ลบจากทีมเป้าหมาย ครั้งเดียวต่อคนต่อวัน
        c.detail = would > 0 ? `${c.target} ${r2(would)} → 0` : `${c.target} ไม่ได้ส่งผลอยู่แล้ว`;
      }
    } else {
      c.effect = null;
      c.detail = "เฉลยพรุ่งนี้";
    }
  }

  // --- สรุปต่อคน ---
  const runners = new Map();
  for (const t of teams)
    for (const m of t.members)
      runners.set(m, { name: m, team: t, pts: 0, daysActive: 0, fullDays: 0, byActivity: {}, days: {}, raw: {}, cardDays: {} });
  for (const d of perRunnerDay.values()) {
    const r = runners.get(d.runner);
    r.pts += d.pts;
    if (d.raw > 0) r.daysActive++;
    if (d.pts >= rules.dailyCap) r.fullDays++;
    r.days[d.date] = d.pts;
    r.raw[d.date] = d.raw;
    if (d.blockedBy || d.x2 || d.carriedIn || d.carriedOut) r.cardDays[d.date] = { blockedBy: d.blockedBy, x2: d.x2, carriedIn: d.carriedIn, carriedFrom: d.carriedFrom, carriedOut: d.carriedOut };
    for (const [a, v] of Object.entries(d.byActivity)) r.byActivity[a] = (r.byActivity[a] || 0) + v;
  }

  // --- สรุปต่อทีม + ซีรีส์รายวัน ---
  const lastEntryDate = entries.reduce((m, e) => (e.date > m ? e.date : m), "");
  const days = challengeDays(rules, today, lastEntryDate);
  const teamStats = teams.map((t) => {
    const rs = t.members.map((m) => runners.get(m));
    const daily = days.map((d) => rs.reduce((s, r) => s + (r.days[d] || 0), 0));
    const cumulative = [];
    daily.reduce((s, v) => (cumulative.push(s + v), s + v), 0);
    const byActivity = {};
    for (const r of rs) for (const [a, v] of Object.entries(r.byActivity)) byActivity[a] = (byActivity[a] || 0) + v;
    return {
      ...t,
      runners: [...rs].sort((a, b) => b.pts - a.pts),
      pts: rs.reduce((s, r) => s + r.pts, 0),
      activeMembers: rs.filter((r) => r.daysActive > 0).length,
      entries: entries.filter((e) => e.team.id === t.id).length,
      byActivity,
      daily,
      cumulative,
      maxPossible: t.members.length * rules.dailyCap * days.length,
    };
  });
  const rankOf = (list, key) => {
    const sorted = [...list].sort((a, b) => b[key] - a[key]);
    const r = new Map();
    sorted.forEach((t, i) => r.set(t.id, i > 0 && t[key] === sorted[i - 1][key] ? r.get(sorted[i - 1].id) : i + 1));
    return r;
  };
  const last = days.length - 1;
  for (const t of teamStats) {
    t.todayPts = last >= 0 ? t.daily[last] : 0;
    t.prevPts = last >= 1 ? t.cumulative[last - 1] : 0;
  }
  const prevRank = rankOf(teamStats, "prevPts");
  teamStats.sort((a, b) => b.pts - a.pts);
  teamStats.forEach((t, i) => (t.rank = i > 0 && t.pts === teamStats[i - 1].pts ? teamStats[i - 1].rank : i + 1));
  const hotPts = Math.max(0, ...teamStats.map((t) => t.todayPts));
  for (const t of teamStats) {
    t.rankDelta = last >= 1 ? prevRank.get(t.id) - t.rank : 0; // บวก = ขยับขึ้น
    t.gap = teamStats[0].pts - t.pts;
    t.hot = hotPts > 0 && t.todayPts === hotPts;
  }

  // --- สถิติรายวัน: ทีมชนะวัน (🏆), ดาวประจำวัน (⭐), ยอดรวม, คนส่งผล ---
  const runnerList = [...runners.values()];
  const dayStats = days.map((date, i) => {
    const total = teamStats.reduce((s, t) => s + t.daily[i], 0);
    const submitters = runnerList.filter((r) => r.days[date] > 0).length;
    const top = Math.max(0, ...teamStats.map((t) => t.daily[i]));
    const winners = top > 0 ? teamStats.filter((t) => t.daily[i] === top) : [];
    // ดาวประจำวัน = คนที่ทำคะแนนดิบ (ก่อนตัดเพดาน) สูงสุดของวัน
    const starPts = Math.max(0, ...runnerList.map((r) => r.raw[date] || 0));
    const stars = starPts > 0 ? runnerList.filter((r) => (r.raw[date] || 0) === starPts) : [];
    return { date, total, submitters, winners, winnerPts: top, stars, starPts };
  });
  for (const t of teamStats) t.stageWins = dayStats.filter((d) => d.winners.includes(t)).length;
  // สตรีคดาวประจำวัน: คนที่เป็นดาววันล่าสุด เป็นมากี่วันติด
  let starStreak = 0;
  const lastStar = dayStats.length ? dayStats[dayStats.length - 1].stars[0] : null;
  if (lastStar) for (let i = dayStats.length - 1; i >= 0 && dayStats[i].stars.includes(lastStar); i--) starStreak++;

  // การ์ดคงเหลือ + สถานะวันนี้ ต่อทีม (วีคปัจจุบัน)
  const thisWeek = weekKey(today);
  const cardState = {};
  for (const t of teams) {
    const mine = cards.filter((c) => c.team.id === t.id);
    const used = {};
    for (const c of mine) if (c.week === thisWeek) used[c.card] = c.date;
    cardState[t.id] = { used, usedToday: mine.some((c) => c.date === today), left: CARD_TYPES.filter((k) => !used[k]) };
  }
  // ป้ายการ์ดต่อวัน (สำหรับตาราง/สรุป) — block ที่ยังไม่เฉลยไม่ส่งออก
  const cardsByDate = {};
  for (const c of cards) if (c.revealed) (cardsByDate[c.date] ||= []).push(c);

  const totalDays = daysInclusive(rules.startDate, rules.endDate);
  return {
    cards,
    cardsByDate,
    cardState,
    dayStats,
    starStreak,
    rules,
    teams: teamStats,
    runners: [...runners.values()].sort((a, b) => b.pts - a.pts),
    entries: entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.line - a.line)),
    days,
    totalDays,
    daysElapsed: days.length,
    warnings,
  };
}
