// เทสต์สูตรคะแนน — รัน: node --test tests/
// เน้น "ทีม 5 คน vs 6 คน ต้องเท่าเทียม" ทั้งคะแนนปกติและการ์ดทั้ง 3 ใบ
// สเกลทีม = เทียบเป็นทีม 5 คน (ทีม 5 คน = ผลรวมตรง ๆ · ทีม 6 คน ×5/6 · การ์ดนับเต็ม)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScores, rawPoints, readRules, weekKey } from "../js/scoring.js";

// ── ตัวช่วย ──────────────────────────────────────────────────────
const names = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
const A = names("a", 5), B = names("b", 5), C = names("c", 5), G = names("g", 6); // A, B, C = 5 คน · G = 6 คน
const TEAMS = [
  { team_id: "A", team_name: "A", members: A.join(",") },
  { team_id: "B", team_name: "B", members: B.join(",") },
  { team_id: "C", team_name: "C", members: C.join(",") },
  { team_id: "G", team_name: "G", members: G.join(",") },
];
const CONFIG = { start_date: "2026-10-01", end_date: "2026-10-30" }; // 1 ต.ค. 2569 = พฤหัส · 5 ต.ค. = จันทร์
const score = ({ runs = [], cards = [], today = "2026-10-20" }) => computeScores({ config: CONFIG, teams: TEAMS, runs, cards }, today);
const row = (date, runner, activity, amount) => ({ date, runner, activity, amount: String(amount) });
const runAll = (date, who, km) => who.map((n) => row(date, n, "run", km));
const day = (res, id, date) => res.teams.find((t) => t.id === id).daily[res.days.indexOf(date)];
const person = (res, name, date) => res.runners.find((r) => r.name === name).days[date] || 0;
const eq = (a, b, msg = "") => assert.ok(Math.abs(a - b) < 1e-9, `${msg} ได้ ${a} ควรเป็น ${b}`);
const x2 = (date, team, runner) => ({ date, team_id: team, card: "x2", runner });
const carry = (date, team, from, to) => ({ date, team_id: team, card: "carry", runner: from, target_runner: to });
const block = (date, team, tTeam, who) => ({ date, team_id: team, card: "block", target_team: tTeam, target_runner: who });
const D = "2026-10-06"; // วันทดสอบหลัก (อังคาร)

// ── คะแนนรายคน ────────────────────────────────────────────────────
test("อัตราแปลงแต่ละกิจกรรม", () => {
  const r = readRules({});
  eq(rawPoints("run", 1, r), 1); eq(rawPoints("treadmill", 3, r), 3);
  eq(rawPoints("walk", 10000, r), 5); eq(rawPoints("walk", 5000, r), 2.5);
  eq(rawPoints("bike", 20, r), 5);
  eq(rawPoints("badminton", 60, r), 5); eq(rawPoints("gym", 30, r), 2.5);
  eq(rawPoints("jumprope", 15, r), 1.25); eq(rawPoints("yoga", 14, r), 0, "ต่ำกว่า 15 นาทีไม่นับ");
});

test("เพดาน 5 คะแนน/คน/วัน", () => {
  eq(person(score({ runs: [row(D, "a1", "run", 8)] }), "a1", D), 5);
});

test("1 คน 1 กิจกรรม/วัน — นับแถวแรก แถวถัดไปขึ้นเตือน", () => {
  const res = score({ runs: [row(D, "a1", "run", 2), row(D, "a1", "walk", 10000)] });
  eq(person(res, "a1", D), 2);
  assert.ok(res.warnings.some((w) => w.includes("1 คน 1 กิจกรรม")));
});

// ── ความเท่าเทียมทีม 5 vs 6 คน (ไม่มีการ์ด) ────────────────────────
test("ทุกคนทำเท่ากัน → คะแนนทีมเท่ากัน", () => {
  for (const km of [1, 3, 5]) {
    const res = score({ runs: [...runAll(D, A, km), ...runAll(D, G, km)] });
    eq(day(res, "A", D), km * 5, `A วิ่ง ${km}`); eq(day(res, "G", D), km * 5, `G วิ่ง ${km}`);
  }
});

test("ขาด 1 คน: ทีม 5 คน 20 · ทีม 6 คน 25 × 5/6", () => {
  const res = score({ runs: [...runAll(D, A.slice(0, 4), 5), ...runAll(D, G.slice(0, 5), 5)] });
  eq(day(res, "A", D), 20); eq(day(res, "G", D), 25 * 5 / 6);
});

test("คะแนนรวม = ผลรวมรายวัน · คะแนนเต็ม = 25 × จำนวนวัน · rawPts = ผลรวมจริง", () => {
  const res = score({ runs: [...runAll(D, G, 5), ...runAll("2026-10-07", G, 3)], today: "2026-10-07" });
  const g = res.teams.find((t) => t.id === "G");
  eq(g.pts, g.daily.reduce((s, v) => s + v, 0)); eq(g.pts, 48 * 5 / 6);
  eq(g.maxPossible, 25 * res.days.length); eq(g.rawPts, 48);
});

test("ทีม 5 คน: คะแนนทีม = ผลรวมคะแนนสมาชิกตรง ๆ (รวมการ์ด)", () => {
  const res = score({ runs: [row(D, "a1", "run", 3), row(D, "a2", "walk", 10000), row(D, "a3", "gym", 30)], cards: [x2(D, "A", "a1")] });
  const a = res.teams.find((t) => t.id === "A");
  eq(a.pts, a.rawPts); eq(a.pts, 6 + 5 + 2.5);
});

// ── x2 ───────────────────────────────────────────────────────────
test("x2 เต็ม: คนนั้นได้ 10 · ทีม 5 และ 6 คนได้เท่ากัน (30 = 30)", () => {
  const res = score({ runs: [...runAll(D, A, 5), ...runAll(D, G, 5)], cards: [x2(D, "A", "a1"), x2(D, "G", "g1")] });
  eq(person(res, "a1", D), 10); eq(person(res, "g1", D), 10);
  eq(day(res, "A", D), 30); eq(day(res, "G", D), 30);
  for (const c of res.cards) eq(c.effect, 5, `x2 ทีม ${c.team.id}`);
});

test("x2: 3 → 6 · 7 กม. → 10 (เพดาน×2) · ไม่ส่งผล → ไม่มีผล", () => {
  const res = score({ runs: [row(D, "a1", "run", 3), row(D, "g1", "run", 7)], cards: [x2(D, "A", "a1"), x2(D, "G", "g1"), x2("2026-10-07", "B", "b1")] });
  eq(person(res, "a1", D), 6); eq(person(res, "g1", D), 10);
  eq(res.cards.find((c) => c.team.id === "B").effect, 0);
});

// ── เดอะแบก ──────────────────────────────────────────────────────
test("เดอะแบก: 15 → โอน 5 · ผู้รับ 2 → 5 · ทีม 5 และ 6 คนได้เพิ่มเท่ากัน", () => {
  const res = score({
    runs: [row(D, "a1", "run", 15), row(D, "a2", "run", 2), row(D, "g1", "run", 15), row(D, "g2", "run", 2)],
    cards: [carry(D, "A", "a1", "a2"), carry(D, "G", "g1", "g2")],
  });
  eq(person(res, "a1", D), 5); eq(person(res, "a2", D), 5); eq(person(res, "g2", D), 5);
  for (const c of res.cards) { eq(c.amount, 5); eq(c.effect, 3, `carry ทีม ${c.team.id}`); }
});

test("เดอะแบก: 7 → โอนได้ 2 · 4 → โอนไม่ได้", () => {
  const res = score({ runs: [row(D, "a1", "run", 7), row(D, "b1", "run", 4), row(D, "b2", "run", 1)], cards: [carry(D, "A", "a1", "a2"), carry(D, "B", "b1", "b2")] });
  eq(res.cards.find((c) => c.team.id === "A").amount, 2);
  const b = res.cards.find((c) => c.team.id === "B");
  eq(b.amount, 0); eq(b.effect, 0);
});

// ── Block ────────────────────────────────────────────────────────
test("block: ทีม 5 และ 6 คนเสียเท่ากัน (20 = 20, effect −5 ทั้งคู่)", () => {
  const res = score({ runs: [...runAll(D, A, 5), ...runAll(D, G, 5)], cards: [block(D, "G", "A", "a2"), block(D, "A", "G", "g2")] });
  eq(person(res, "a2", D), 0); eq(person(res, "g2", D), 0);
  eq(day(res, "A", D), 20); eq(day(res, "G", D), 20);
  for (const c of res.cards) eq(c.effect, -5, `block โดย ${c.team.id}`);
});

test("block ยังไม่เฉลยวันนี้ — คะแนนยังโชว์ปกติ", () => {
  const res = score({ runs: runAll(D, A, 5), cards: [block(D, "G", "A", "a2")], today: D });
  eq(person(res, "a2", D), 5); assert.equal(res.cards[0].effect, null);
});

test("block ชนะ x2 · ทีม 5 และ 6 คนยังเท่ากัน", () => {
  const res = score({
    runs: [...runAll(D, A, 5), ...runAll(D, G, 5)],
    cards: [x2(D, "A", "a1"), x2(D, "G", "g1"), block(D, "B", "A", "a1"), block(D, "C", "G", "g1")], // คนละทีมกับที่ใช้ x2 (ทีมละ 1 ใบ/วัน)
  });
  eq(person(res, "a1", D), 0); eq(person(res, "g1", D), 0);
  eq(day(res, "A", D), day(res, "G", D), "A = G");
  for (const c of res.cards.filter((c) => c.card === "block")) eq(c.effect, -10);
});

test("block วันเดียวกัน 2 ทีมซ้อน → มีผลใบเดียว", () => {
  const res = score({ runs: runAll(D, G, 5), cards: [block(D, "A", "G", "g3"), block(D, "B", "G", "g3")] });
  const [first, second] = res.cards;
  eq(first.effect, -5); eq(second.effect, 0); assert.equal(second.stacked.id, "A");
  eq(day(res, "G", D), 20);
});

test("block คนเดิมคนละวันในวีคเดียวกัน → ใบหลังไม่มีผล · วีคถัดไป → โดนได้อีก", () => {
  const res = score({
    runs: [...runAll("2026-10-06", G, 5), ...runAll("2026-10-08", G, 5), ...runAll("2026-10-13", G, 5)],
    cards: [block("2026-10-06", "A", "G", "g1"), block("2026-10-08", "B", "G", "g1"), block("2026-10-13", "B", "G", "g1")],
  });
  eq(person(res, "g1", "2026-10-06"), 0);
  eq(person(res, "g1", "2026-10-08"), 5, "วีคเดียวกัน ใบที่ 2 ไม่มีผล");
  eq(person(res, "g1", "2026-10-13"), 0, "วีคใหม่ โดนได้");
});

test("ทีม 6 คนส่งคนเดียวแล้วโดน block → วันนั้น 0 ไม่ติดลบ", () => {
  const res = score({ runs: [row(D, "g1", "run", 5)], cards: [block(D, "A", "G", "g1")] });
  eq(day(res, "G", D), 0);
});

// ── สมดุลภาพรวม: ใช้ครบ 3 ใบ + โดน block เหมือนกัน → ได้/เสียจากการ์ดเท่ากัน ──
test("ใช้การ์ดครบ 3 ใบ และโดน block เหมือนกัน → ผลจากการ์ดของทีม 5 คน = ทีม 6 คน", () => {
  const d1 = "2026-10-05", d2 = "2026-10-06", d3 = "2026-10-07";
  const runs = [];
  for (const d of [d1, d2, d3])
    for (const n of [...A, ...G]) runs.push(row(d, n, "run", d === d1 && (n === "a1" || n === "g1") ? 12 : 4)); // a1/g1 วิ่งเยอะวันแรก → แบกให้เพื่อน
  const cards = [
    carry(d1, "A", "a1", "a2"), carry(d1, "G", "g1", "g2"),
    x2(d2, "A", "a3"), x2(d2, "G", "g3"),
    block(d3, "A", "G", "g4"), block(d3, "G", "A", "a4"),
  ];
  const withCards = score({ runs, cards }), noCards = score({ runs });
  const gain = (id, d) => day(withCards, id, d) - day(noCards, id, d);
  for (const d of [d1, d2, d3]) eq(gain("A", d), gain("G", d), `วันที่ ${d}`);
  eq(gain("A", d1), 1, "เดอะแบก +1 (a2 4 → 5)");
  eq(gain("A", d2), 4, "x2 +4 (4 → 8)");
  eq(gain("A", d3), -4, "block −4 (4 → 0)");
});

// ── โควตาการ์ด (กันแถวที่พิมพ์เองในชีต) ─────────────────────────────
test("ทีมเดียวใช้ 2 ใบวันเดียวกัน → ใบที่ 2 ไม่นับ + เตือน", () => {
  const res = score({ runs: runAll(D, A, 5), cards: [x2(D, "A", "a1"), carry(D, "A", "a2", "a3"), block(D, "A", "G", "g1")] });
  assert.equal(res.cards.length, 1);
  assert.equal(res.cards[0].card, "x2");
  assert.equal(res.warnings.filter((w) => w.includes("วันละ 1 ใบ")).length, 2);
  eq(day(res, "A", D), 30);
});

test("ชนิดเดียวกัน 2 ใบในวีคเดียวกัน → ใบที่ 2 ไม่นับ · วีคถัดไปใช้ได้", () => {
  const res = score({
    runs: [...runAll("2026-10-06", A, 5), ...runAll("2026-10-08", A, 5), ...runAll("2026-10-13", A, 5)],
    cards: [x2("2026-10-06", "A", "a1"), x2("2026-10-08", "A", "a2"), x2("2026-10-13", "A", "a3")],
  });
  assert.deepEqual(res.cards.map((c) => c.date), ["2026-10-06", "2026-10-13"]);
  assert.ok(res.warnings.some((w) => w.includes("ชนิดละ 1 ใบ/วีค")));
  eq(person(res, "a2", "2026-10-08"), 5, "x2 ใบที่ 2 ไม่มีผล");
});

// ── อื่น ๆ ───────────────────────────────────────────────────────
test("แถวผิดไม่นับ + ขึ้นเตือน", () => {
  const res = score({ runs: [row(D, "ghost", "run", 5), row("2026-09-30", "a1", "run", 5), row(D, "a1", "skateboard", 5)] });
  assert.equal(res.entries.length, 0);
  assert.equal(res.warnings.length, 3);
});

test("วีคเริ่มวันจันทร์", () => {
  assert.equal(weekKey("2026-10-05"), "2026-10-05");
  assert.equal(weekKey("2026-10-11"), "2026-10-05");
  assert.equal(weekKey("2026-10-12"), "2026-10-12");
});

test("สรุปวัน: คะแนนรวม = ผลรวมจริงของทุกคน", () => {
  const res = score({ runs: [...runAll(D, A, 5), ...runAll(D, G, 5)] });
  eq(res.dayStats[res.days.indexOf(D)].total, 55);
});
