// ไฟล์เดียวที่ต้องแก้ตอนตั้งค่า
//
// 1. สร้าง Google Sheets 1 ไฟล์ มี 3 แท็บชื่อ teams / runs / config (ดูตัวอย่างใน sample-data/)
// 2. แชร์เป็น "ทุกคนที่มีลิงก์ → ผู้มีสิทธิ์อ่าน"
// 3. ก๊อป ID จาก URL  https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit  มาวางด้านล่าง
// 4. เปลี่ยน USE_SAMPLE เป็น false

export const USE_SAMPLE = false;
export const SHEET_ID = "1CoIA14mlVZBk9hIDpk_3JtJ_d10QriVIlElr0sUoy7M";

export const TABS = { teams: "teams", runs: "runs", config: "config" };

// URL เว็บแอปของ Apps Script (ลงท้าย /exec) สำหรับหน้า entry.html — ดูวิธีได้ใน apps-script/Code.gs
// ปล่อยว่างไว้ = หน้ากรอกยังใช้ไม่ได้ (จะขึ้นข้อความบอกวิธีตั้งค่า)
export const ENTRY_URL = "https://script.google.com/macros/s/AKfycbzHXA9nJD2DMZRond_guihLQWCQb23HUsCzwx3aucsO3xeCnuTetZ9Tuq_yfba8qPnt/exec";
