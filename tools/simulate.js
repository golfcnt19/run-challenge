// จำลองกิจกรรมทั้งเดือนเพื่อดูหน้าตาผลลัพธ์ — ไม่แตะชีตจริง
//   node tools/simulate.js [seed]
//   แล้วเปิด http://localhost:4174/?sim&today=2026-10-31   (หรือ today=2026-10-15 ดูกลางเดือน)
// รายชื่อทีม + config ดึงจากชีตจริง · เขียนผลลง sample-data/sim/*.csv
import fs from "node:fs";
import { SHEET_ID } from "../js/config.js";
import { rawPoints, readRules, weekKey } from "../js/scoring.js";
import { parseCsv } from "../js/sheets.js";

const seed = Number(process.argv[2] || 2026);
let s = seed >>> 0; // mulberry32 — seed เดิมได้ผลเดิมทุกครั้ง
const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a, b) => a + rnd() * (b - a);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const shuffle = (arr) => arr.map((v) => [rnd(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

const sheet = async (tab) => {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${tab}`);
  const rows = parseCsv(await r.text()).filter((x) => x.some((v) => v.trim()));
  const h = rows[0].map((x) => x.trim().toLowerCase());
  return { header: rows[0], rows: rows.slice(1).map((x) => Object.fromEntries(h.map((k, i) => [k, (x[i] ?? "").trim()]))) };
};
const csv = (header, rows) => [header.join(","), ...rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(","))].join("\n") + "\n";

const teamsTab = await sheet("teams"), configTab = await sheet("config");
const config = Object.fromEntries(configTab.rows.map((r) => [r.key, r.value]));
const rules = readRules(config);
const teams = teamsTab.rows.map((t) => ({ id: t.team_id, members: t.members.split(",").map((x) => x.trim()).filter(Boolean) }));
const days = [];
for (let d = new Date(rules.startDate); d <= new Date(rules.endDate); d.setDate(d.getDate() + 1)) days.push(d.toISOString().slice(0, 10));

// ── นิสัยแต่ละคน ──
const SPORTS = ["badminton", "tennis", "football", "swim", "basketball", "gym", "yoga", "jumprope"];
const people = new Map();
for (const t of teams) {
  const vibe = between(0.97, 1.02); // ทีมขยันต่างกันนิดหน่อย (ผู้ใช้: ส่วนมากส่งผลทุกวัน)
  for (const m of t.members) {
    const main = pick(["run", "run", "run", "treadmill", "walk", "walk", "bike", "sport"]);
    people.set(m, {
      team: t, submit: Math.min(0.99, between(0.85, 0.99) * vibe), power: between(0.6, 1.4),
      main, sport: pick(SPORTS), hour: pick([6, 6, 7, 12, 18, 19, 20, 21, 22]),
    });
  }
}
const activity = (p) => {
  const kind = rnd() < 0.75 ? p.main : pick(["run", "treadmill", "walk", "bike", "sport"]);
  const k = p.power;
  if (kind === "run") return ["run", (between(2, 7) * k).toFixed(2)];
  if (kind === "treadmill") return ["treadmill", (between(2, 6) * k).toFixed(2)];
  if (kind === "walk") return ["walk", String(Math.round(between(4000, 12000) * k))];
  if (kind === "bike") return ["bike", (between(8, 25) * k).toFixed(1)];
  return [p.sport, String(Math.round(between(20, 80) * k))];
};

// ── ผลรายวัน (1 คน 1 กิจกรรม/วัน) ──
const runs = [], rawOf = {}; // rawOf["name|date"] = คะแนนดิบ
for (const date of days)
  for (const [name, p] of people) {
    if (rnd() > p.submit) continue;
    const [act, amount] = activity(p);
    rawOf[`${name}|${date}`] = rawPoints(act, Number(amount), rules);
    const hh = String(Math.min(23, p.hour + Math.floor(rnd() * 2))).padStart(2, "0");
    runs.push([date, name, act, amount, "SIM", `${date} ${hh}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00`, p.team.id]);
  }

// ── การ์ด: ทุกทีมใช้ครบ 3 ใบทุกวีค (วันละใบ ชนิดละใบ) แบบมีกลยุทธ์ ──
const cards = [];
const blockedWeek = new Map(); // "ชื่อ|วีค" → วันที่โดน (block คนเดิมคนละวันในวีคไม่ได้)
const avg = (name, upto) => { const ds = days.filter((d) => d < upto); return ds.reduce((s, d) => s + Math.min(rawOf[`${name}|${d}`] || 0, rules.dailyCap), 0) / Math.max(1, ds.length); };
const weeks = [...new Set(days.map(weekKey))];
for (const wk of weeks) {
  const wdays = days.filter((d) => weekKey(d) === wk);
  for (const t of teams) {
    const chosen = shuffle(wdays).slice(0, 3).sort();
    const types = shuffle(["carry", "x2", "block"]);
    chosen.forEach((date, i) => {
      const card = types[i], stamp = `${date} ${String(8 + Math.floor(rnd() * 12)).padStart(2, "0")}:00:00`;
      if (card === "carry") { // คนวิ่งเยอะสุดของวันแบกให้คนที่น้อยสุด
        const ranked = [...t.members].sort((a, b) => (rawOf[`${b}|${date}`] || 0) - (rawOf[`${a}|${date}`] || 0));
        cards.push([date, t.id, "carry", ranked[0], "", ranked[ranked.length - 1], stamp]);
      } else if (card === "x2") {
        cards.push([date, t.id, "x2", pick(t.members), "", "", stamp]); // สคริปต์จริงสุ่มให้
      } else { // เล็งคนที่เฉลี่ยสูงของทีมที่อยู่อันดับใกล้ ๆ
        const target = pick(teams.filter((x) => x.id !== t.id));
        const ranked = [...target.members].sort((a, b) => avg(b, date) - avg(a, date));
        const who = ranked.find((m) => { const d = blockedWeek.get(`${m}|${wk}`); return !d || d === date; });
        if (!who) return;
        blockedWeek.set(`${who}|${wk}`, date);
        cards.push([date, t.id, "block", "", target.id, who, stamp]);
      }
    });
  }
}
cards.sort((a, b) => (a[6] < b[6] ? -1 : 1));

fs.mkdirSync("sample-data/sim", { recursive: true });
fs.writeFileSync("sample-data/sim/teams.csv", csv(teamsTab.header, teamsTab.rows.map((r) => teamsTab.header.map((h) => r[h.trim().toLowerCase()]))));
fs.writeFileSync("sample-data/sim/config.csv", csv(configTab.header, configTab.rows.map((r) => configTab.header.map((h) => r[h.trim().toLowerCase()]))));
fs.writeFileSync("sample-data/sim/runs.csv", csv(["date", "runner", "activity", "amount", "note", "submitted_at", "submitted_by"], runs));
fs.writeFileSync("sample-data/sim/cards.csv", csv(["date", "team_id", "card", "runner", "target_team", "target_runner", "submitted_at"], cards));
console.log(`seed ${seed}: ${days[0]} – ${days.at(-1)} · ${teams.length} ทีม ${people.size} คน · ${runs.length} รายการ · ${cards.length} การ์ด`);
