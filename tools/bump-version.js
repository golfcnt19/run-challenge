// ใส่ ?v=<เวลา> ให้ import ระหว่างโมดูลและ <script>/<link> ทุกตัว กัน browser ใช้ไฟล์เก่าปนใหม่หลัง deploy
// รันอัตโนมัติจาก pre-commit hook (ดู tools/install-hooks.sh) หรือ: node tools/bump-version.js
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const V = "v=" + Date.now().toString(36);
const rw = (f, fn) => { const p = path.join(root, f); const s = fs.readFileSync(p, "utf8"); const o = fn(s); if (o !== s) fs.writeFileSync(p, o); };
for (const f of fs.readdirSync(path.join(root, "js")).filter((x) => x.endsWith(".js")))
  rw("js/" + f, (s) => s.replace(/from "\.\/(\w+)\.js(\?v=[^"]*)?"/g, (m, n) => `from "./${n}.js?${V}"`));
for (const f of ["index.html", "entry.html", "cards.html"])
  rw(f, (s) => s.replace(/src="js\/(\w+)\.js(\?v=[^"]*)?"/g, (m, n) => `src="js/${n}.js?${V}"`).replace(/href="css\/site\.css(\?v=[^"]*)?"/g, `href="css/site.css?${V}"`));
console.log("bumped to", V);
