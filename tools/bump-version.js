// ใส่ ?v=<เวลา> ให้ import ระหว่างโมดูลและ <script>/<link> ทุกตัว กัน browser ใช้ไฟล์เก่าปนใหม่หลัง deploy
// และฝังเวอร์ชันใน <html data-v> + version.json ให้ js/version-check.js ตรวจแล้ว reload ถ้า HTML ที่ถืออยู่เก่า
// รันอัตโนมัติจาก pre-commit hook (.githooks/pre-commit) หรือ: node tools/bump-version.js
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const V = "v=" + Date.now().toString(36);
const stamp = V.slice(2);
const rw = (f, fn) => {
  const p = path.join(root, f);
  const s = fs.readFileSync(p, "utf8");
  const o = fn(s);
  if (o !== s) fs.writeFileSync(p, o);
};
for (const f of fs.readdirSync(path.join(root, "js")).filter((x) => x.endsWith(".js")))
  rw("js/" + f, (s) => s.replace(/from "\.\/([\w-]+)\.js(\?v=[^"]*)?"/g, (m, n) => `from "./${n}.js?${V}"`));
for (const f of ["index.html", "entry.html", "cards.html"])
  rw(f, (s) =>
    s
      .replace(/src="js\/([\w-]+)\.js(\?v=[^"]*)?"/g, (m, n) => `src="js/${n}.js?${V}"`)
      .replace(/href="css\/site\.css(\?v=[^"]*)?"/g, `href="css/site.css?${V}"`)
      .replace(/<html lang="th"( data-v="[^"]*")?>/, `<html lang="th" data-v="${stamp}">`),
  );
fs.writeFileSync(path.join(root, "version.json"), JSON.stringify({ v: stamp }) + "\n");
console.log("bumped to", V);
