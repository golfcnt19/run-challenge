// ถ้า HTML ที่เบราว์เซอร์ถืออยู่เก่ากว่าเวอร์ชันบนเซิร์ฟเวอร์ → reload เองครั้งเดียว (กัน cache ของหน้า HTML)
const mine = document.documentElement.dataset.v;
if (mine) fetch("version.json?t=" + Date.now(), { cache: "no-store" })
  .then((r) => r.json())
  .then(({ v }) => {
    if (!v || v === mine) return;
    const key = "rc-reloaded-" + v;
    if (sessionStorage.getItem(key)) return; // กันวนลูปถ้า CDN ยังส่งของเก่า
    sessionStorage.setItem(key, "1");
    location.reload();
  })
  .catch(() => {});
