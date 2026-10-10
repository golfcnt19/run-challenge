// ตรวจ PIN ของทีมกับ Apps Script โดยไม่เขียนอะไรลงชีต — ใช้ปลดล็อก "ดูข้อมูลของทีมตัวเอง"
// (หน้ากรอกผล + หน้าการ์ด) · ไม่เก็บ PIN ไว้ที่ไหน ปลดล็อกอยู่แค่ในแท็บที่เปิดอยู่
import { postApi } from "./sheets.js?v=mv2n85s8";

// ส่ง runner ไปด้วยเพื่อให้ใช้ได้กับสคริปต์เวอร์ชันเก่าที่ยังไม่มี action "auth":
// เวอร์ชันเก่าจะวิ่งเข้า addEntry_ ซึ่งตรวจ PIN ก่อน แล้วไปตกที่ "วันที่ไม่ถูกต้อง" (ไม่มีอะไรถูกบันทึก)
export async function verifyTeamPin(url, teamId, pin, firstMember = "") {
  const out = await postApi(url, { action: "auth", team_id: teamId, pin, runner: firstMember });
  if (out.ok) return { ok: true };
  const legacyOk = out.code !== "PIN" && /วันที่/.test(out.error || "");
  if (legacyOk) return { ok: true };
  return { ok: false, error: out.error || "PIN ไม่ถูกต้อง" };
}
