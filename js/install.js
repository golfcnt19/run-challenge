// การ์ด "เพิ่มไปยังหน้าจอโฮม": Android ใช้ปุ่มติดตั้งของ Chrome, iOS แสดงขั้นตอน
// ?install=ios|android|line บังคับโชว์การ์ดไว้ทดสอบบนเดสก์ท็อป
const force = new URLSearchParams(location.search).get("install");
const ua = force ? { ios: "iPhone", android: "Android", line: "iPhone Line/14" }[force] || "" : navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua);
const isAndroid = /Android/.test(ua);
const inLine = /Line\//i.test(ua);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const KEY = "rc-install-dismissed";
let deferred = null;

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

function show(html) {
  const el = document.getElementById("install-card");
  if (!el) return;
  el.innerHTML = html + `<button type="button" class="install-close" id="install-close" aria-label="ปิด">✕</button>`;
  el.hidden = false;
  document.getElementById("install-close").addEventListener("click", () => {
    el.hidden = true;
    try { localStorage.setItem(KEY, "1"); } catch {}
  });
}

let dismissed = false;
try { dismissed = localStorage.getItem(KEY) === "1"; } catch {}

if ((force || (!standalone && !dismissed)) && (isIOS || isAndroid)) {
  if (inLine) {
    show(`<b>📲 เพิ่มลงหน้าจอโฮม</b><p>กำลังเปิดในแอป LINE — กด <b>⋯</b> มุมขวาบน แล้วเลือก <b>เปิดในเบราว์เซอร์</b> (Safari/Chrome) ก่อน จากนั้นค่อยเพิ่มลงหน้าจอ</p>`);
  } else if (isIOS) {
    show(`<b>📲 เพิ่มลงหน้าจอโฮม</b><p>กดปุ่ม <b>แชร์</b> <span class="ios-share">⬆︎</span> ด้านล่าง Safari → เลื่อนหา <b>"เพิ่มไปยังหน้าจอโฮม"</b> → <b>เพิ่ม</b></p>`);
  } else {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferred = e;
      show(`<b>📲 ติดตั้งเป็นแอป</b><p>เปิดเร็วจากหน้าจอโฮม ไม่ต้องหาลิงก์</p><button type="button" class="btn-primary btn-install" id="install-btn">ติดตั้ง</button>`);
      document.getElementById("install-btn").addEventListener("click", async () => {
        deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === "accepted") document.getElementById("install-card").hidden = true;
        deferred = null;
      });
    });
  }
}
