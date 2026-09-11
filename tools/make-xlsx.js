// สร้าง run-challenge.xlsx จาก sample-data/ สำหรับอัปโหลดเข้า Google Drive → เปิดด้วย Google ชีต
// ไม่พึ่ง library: เขียน OOXML + zip (stored) เอง   ใช้: node tools/make-xlsx.js [out.xlsx]
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const OUT = process.argv[2] || path.join(ROOT, "run-challenge.xlsx");

// ── CSV → rows (parser เดียวกับ js/sheets.js แบบย่อ) ────────────────
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}
const csv = (name) => parseCsv(fs.readFileSync(path.join(ROOT, "sample-data", name), "utf8"));

// ── ข้อมูลแต่ละแท็บ ──────────────────────────────────────────────────
// text = บังคับเป็นข้อความ (กัน Sheets แปลงวันที่เอง)   widths = ความกว้างคอลัมน์
const sheets = [
  { name: "teams", rows: csv("teams.csv"), widths: [10, 14, 10, 40], textCols: [] },
  { name: "runs", rows: [["date", "runner", "activity", "amount", "note"]], widths: [14, 14, 12, 10, 30], textCols: [0] },
  { name: "config", rows: csv("config.csv"), widths: [22, 18, 48], textCols: [1] },
  {
    name: "วิธีกรอก",
    widths: [16, 14, 12, 10, 60],
    textCols: [0],
    rows: [
      ["วิธีกรอกผลในแท็บ runs — 1 แถว = 1 การส่งผล  (แท็บนี้เว็บไม่ได้อ่าน ลบทิ้งได้)"],
      [],
      ["date", "runner", "activity", "amount", "note"],
      ["2026-09-15", "Jay", "run", 5.2, "วิ่งสวน 5.2 กม. = 5 คะแนน (เพดาน)"],
      ["2026-09-15", "Koi", "เดิน", 10000, "เดิน 10,000 ก้าว = 5 คะแนน"],
      ["2026-09-16", "Golf", "ปั่น", 12, "ปั่น 12 กม. = 3 คะแนน (12/20 × 5)"],
      ["2026-09-16", "Golf", "treadmill", 2.5, "วันเดียวกันรวมกับปั่น = 5.5 → นับ 5"],
      [],
      ["คอลัมน์", "กรอกอะไร"],
      ["date", "วันที่แบบ ปี-เดือน-วัน เช่น 2026-09-15 (คอลัมน์นี้ตั้งเป็นข้อความไว้แล้ว พิมพ์ตรง ๆ ได้)"],
      ["runner", "ชื่อตามที่อยู่ในแท็บ teams คอลัมน์ members (ตัวพิมพ์ใหญ่-เล็กไม่สำคัญ)"],
      ["activity", "run / วิ่งสวน · treadmill / วิ่งลู่ · walk / เดิน · bike / ปั่น"],
      ["amount", "กม. สำหรับวิ่งและปั่น · จำนวนก้าวสำหรับเดิน"],
      ["note", "หมายเหตุ (ไม่บังคับ)"],
      [],
      ["กติกา", "วิ่ง 1 กม. = 1 คะแนน · เดิน 10,000 ก้าว = 5 · ปั่น 20 กม. = 5 (คิดตามสัดส่วน) · รวมกันได้แต่ไม่เกิน 5 คะแนน/คน/วัน"],
      ["ปรับกติกา", "แก้ตัวเลขในแท็บ config ได้เลย เว็บจะคิดใหม่ให้ทันที"],
      ["แถวที่ผิด", "ชื่อไม่ตรง / วันที่นอกช่วง / กิจกรรมไม่รู้จัก → เว็บจะไม่นับและแจ้งเลขแถวไว้ด้านบนหน้าเว็บ"],
    ],
  },
];

// ── OOXML ─────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// styles: 0 = ปกติ, 1 = หัวตาราง (ตัวหนา พื้นเทา), 2 = ข้อความ (@)
const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EAF6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml({ rows, widths, textCols }, headerRow = 0) {
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${textCols.includes(i) ? ' style="2"' : ""}/>`).join("");
  const body = rows
    .map((r, ri) =>
      `<row r="${ri + 1}">` +
      r.map((v, ci) => {
        if (v === "" || v == null) return "";
        const ref = `${colName(ci)}${ri + 1}`;
        const isText = textCols.includes(ci);
        const style = ri === headerRow ? 1 : isText ? 2 : 0;
        const num = typeof v === "number" ? v : !isText && /^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : null;
        if (num !== null && ri !== headerRow) return `<c r="${ref}" s="${style}"><v>${num}</v></c>`;
        return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join("") +
      `</row>`
    ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${headerRow === 0 ? '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView' : "/"}></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

const files = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  "xl/styles.xml": styles,
};
sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s, s.name === "วิธีกรอก" ? 2 : 0)));

// ── ZIP (deflate) ─────────────────────────────────────────────────────
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

const locals = [], centrals = [];
let offset = 0;
for (const [name, xml] of Object.entries(files)) {
  const nameB = Buffer.from(name, "utf8");
  const raw = Buffer.from(xml, "utf8");
  const data = zlib.deflateRawSync(raw);
  const crc = crc32(raw);
  const head = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(0), u32(crc), u32(data.length), u32(raw.length), u16(nameB.length), u16(0), nameB]);
  locals.push(head, data);
  centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0), u32(crc), u32(data.length), u32(raw.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameB]));
  offset += head.length + data.length;
}
const central = Buffer.concat(centrals);
const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length), u32(central.length), u32(offset), u16(0)]);
fs.writeFileSync(OUT, Buffer.concat([...locals, central, end]));
console.log("wrote", OUT, sheets.map((s) => `${s.name}(${s.rows.length} rows)`).join(", "));
