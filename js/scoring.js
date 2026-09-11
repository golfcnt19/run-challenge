// เครื่องคิดคะแนน — จุดเดียวที่ต้องแก้ถ้ากติกาเปลี่ยน
//
// กติกา (ตั้งค่าตัวเลขได้ที่แท็บ config ในชีต):
//   วิ่งสวน / วิ่งลู่   1 กม. = points_per_run_km คะแนน
//   เดิน               walk_steps_for_full ก้าว = เต็มวัน (daily_cap)  คิดตามสัดส่วน
//   ปั่นจักรยาน         bike_km_for_full กม.   = เต็มวัน (daily_cap)  คิดตามสัดส่วน
//   รวมทุกกิจกรรมในวันเดียวกันได้ แต่ไม่เกิน daily_cap ต่อคนต่อวัน
//   คะแนนทีม = ผลรวมคะแนนสมาชิก

import { todayIso, addDays, daysInclusive } from "./format.js";

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
    const date = (r.date || "").slice(0, 10);
    const key = (r.runner || "").trim().toLowerCase();
    const team = runnerTeam.get(key);
    const activity = normalizeActivity(r.activity);
    const amount = parseFloat(String(r.amount).replace(/,/g, ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return warnings.push(`แถว ${line}: วันที่ "${r.date}" ไม่ใช่รูปแบบ YYYY-MM-DD`);
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
  for (const d of perRunnerDay.values()) d.pts = Math.min(d.raw, rules.dailyCap);

  // --- สรุปต่อคน ---
  const runners = new Map();
  for (const t of teams)
    for (const m of t.members)
      runners.set(m, { name: m, team: t, pts: 0, daysActive: 0, fullDays: 0, byActivity: {}, days: {} });
  for (const d of perRunnerDay.values()) {
    const r = runners.get(d.runner);
    r.pts += d.pts;
    r.daysActive++;
    if (d.pts >= rules.dailyCap) r.fullDays++;
    r.days[d.date] = d.pts;
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
  teamStats.sort((a, b) => b.pts - a.pts);
  teamStats.forEach((t, i) => (t.rank = i > 0 && t.pts === teamStats[i - 1].pts ? teamStats[i - 1].rank : i + 1));

  const totalDays = daysInclusive(rules.startDate, rules.endDate);
  return {
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
