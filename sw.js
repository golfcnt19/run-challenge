// service worker ขั้นต่ำ เพื่อให้ Chrome/Android เสนอ "ติดตั้งแอป" ได้ — ไม่แคชอะไร ให้ข้อมูลสดเสมอ
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
