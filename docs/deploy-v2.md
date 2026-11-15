# คู่มือขึ้นเว็บ v2 (Plesk / Host Atom)

> เขียนตอน P9 (2026-11-15) · ทำตามลำดับ **ขั้น A → B → C → D** · ขั้น E (ย้ายจริง) ทำหลังลองใช้จนพอใจแล้ว
> v1 ยังใช้งานได้ตามปกติตลอดขั้น A–D (คนละโดเมน คนละฐานข้อมูล)

## ภาพรวม

| ส่วน | ที่อยู่ (ชื่อตัวอย่าง — ตั้งเองได้) | ของที่ขึ้น | Proxy mode |
|---|---|---|---|
| API (backend) | `api-farmland2.family-sivarom.com` | repo `express-farmland` branch `v2` · Node.js | **ปิด** (ไม่งั้น WebSocket ใช้ไม่ได้) |
| หน้าเว็บจริง | `farmland2.family-sivarom.com` | `farmland-web` → `npm run build` → โฟลเดอร์ `dist/` | **เปิด** (ต้องอ่าน `.htaccess`) |
| เดโม | `demo-farmland.family-sivarom.com` | `farmland-web` → `npm run build:demo` → โฟลเดอร์ `dist-demo/` | **เปิด** |

- ฐานข้อมูล v2 (`familysi_farmland_v2`) **พร้อมแล้ว** — migration ทุกเฟสลงครบ (P1–P9) และมีแพ็กเกจ + ตั้งค่าร้าน + แอดมินจาก seed
- ฐานข้อมูล v1 (`familysi_farmland`) ไม่แตะ — เก็บเป็นสำรอง
- ชื่อในตารางเป็นแค่ตัวอย่าง ถ้าใช้ชื่ออื่น แทนชื่อในทุกขั้นข้างล่างให้ตรงกัน

---

## ขั้น A — สร้าง subdomain 3 อัน (Plesk)
1. Plesk → **Websites & Domains** → **Add Subdomain** → ใส่ชื่อ API (เช่น `api-farmland2`) → ทำซ้ำอีก 2 อันสำหรับหน้าเว็บจริงและเดโม
2. ทุกอันเปิด **SSL/TLS Certificates → Let's Encrypt** (ต้องเป็น https — ไม่งั้นเบราว์เซอร์บล็อกการเรียก API และ WebSocket)

## ขั้น B — backend (subdomain API)
1. **เอาโค้ดขึ้น** (เลือก 1 วิธี)
   - **Git (แนะนำ):** ต้อง push branch `v2` ขึ้น GitHub ก่อน (บอก Claude ให้ push ได้) → Plesk → subdomain API → **Git** → Repository URL ของ `express-farmland` → Branch **`v2`** → Deployment path = โฟลเดอร์หลักของ subdomain
   - **อัปโหลดเอง:** zip โฟลเดอร์ backend (ไม่เอา `node_modules`, `dist`, `.env`) → File Manager → อัปโหลด → Extract
2. Plesk → subdomain API → **Node.js**
   - Node.js version: **20 ขึ้นไป** (ขั้นต่ำ 18) · Application mode: **production**
   - Application root = โฟลเดอร์ที่มี `package.json` · Startup file = **`dist/server.js`**
3. **Environment variables** (ปุ่มในหน้า Node.js) — ค่าที่ต้องใส่:

   | ชื่อ | ค่า |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | เหมือนใน `.env` ของเครื่อง dev (DB v2) — `@` ในรหัสผ่านเขียนเป็น `%40` |
   | `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | สุ่มใหม่ 2 ค่า: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
   | `FRONTEND_URL` | `https://farmland2.family-sivarom.com` (หน้าเว็บจริง — ใช้ตรวจ CORS + WebSocket + ลิงก์ในอีเมล) |
   | `OAUTH_CALLBACK_BASE` | `https://api-farmland2.family-sivarom.com/api/auth/oauth` |
   | `SCHEDULER_SECRET` | สุ่มยาว ๆ 1 ค่า (ใช้ในขั้น B6) |
   | `ENABLE_INTERNAL_CRON` | `false` (Plesk เรียกแทน) |
   | `REALTIME_ENABLED` | `true` |
   | `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `EMAIL_USER` `EMAIL_PASS` `MAIL_FROM` | เหมือน v1 |
   | `GOOGLE_CLIENT_ID/SECRET` · `LINE_CHANNEL_ID/SECRET` | เหมือน v1 (ไม่ใส่ = ปุ่มนั้นซ่อนเอง) |
   | `FACEBOOK_APP_ID/SECRET` | ใส่เมื่อสร้าง Facebook App แล้ว |
   | `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` | เหมือน v1 (ไม่ใส่ = อัปโหลดรูปไม่ได้) |
   | `ANTHROPIC_API_KEY` | ใส่เมื่ออยากเปิด AI ประเมิน % ไข่ (ไม่ใส่ = ปิดเงียบ) |
4. กด **NPM install** → **Run script** `build` (= `prisma generate` + คอมไพล์) → **Run script** `prisma:deploy` (จะบอกว่าไม่มี migration ค้าง เพราะลงไว้แล้ว) → **Restart App**
5. Plesk → subdomain API → **Apache & nginx Settings** → **เอาติ๊ก "Proxy mode" ออก** → OK
   - ⚠️ บทเรียน v1: ถ้าไม่ปิด Apache จะตัด header `Upgrade` ทิ้ง → ซิงค์สด/เห็นกันในหมู่บ้านใช้ไม่ได้ (ระบบยังใช้ได้ แต่ขึ้น "ออฟไลน์")
6. Plesk → **Scheduled Tasks** → Add Task → **Fetch a URL** → `https://api-farmland2.family-sivarom.com/api/scheduler/tick?secret=<SCHEDULER_SECRET>` → **ทุก 15 นาที** (Cron style `*/15 * * * *`)
7. **เช็ค:** เปิด `https://api-farmland2.family-sivarom.com/api/health` → ต้องเห็น `"status":"ok"` และ `"realtime":{"enabled":true,"path":"/ws"}`

## ขั้น C — หน้าเว็บจริง
1. ที่เครื่อง (โฟลเดอร์ `farmland-web`, branch `v2`) — build โดยชี้ไปที่ API ใหม่ (ค่านี้ทับ `.env.production` เฉพาะครั้งนี้):
   ```bash
   VITE_API_BASE_URL=https://api-farmland2.family-sivarom.com/api npm run build
   ```
   (PowerShell: `$env:VITE_API_BASE_URL='https://api-farmland2.family-sivarom.com/api'; npm run build`)
2. zip **ของข้างใน** `dist/` (รวมไฟล์ `.htaccess` ที่ซ่อนอยู่) → Plesk → subdomain หน้าเว็บ → File Manager → อัปโหลดลงโฟลเดอร์หลัก (`httpdocs`) → Extract
3. Apache & nginx Settings ของ subdomain นี้ → **Proxy mode ต้องติ๊กไว้** (ค่าเริ่มต้น) — ไม่งั้นกดรีเฟรชหน้าลึก ๆ แล้ว 404
4. **ล็อกอินโซเชียล** — เพิ่มที่อยู่ใหม่ (ของเดิม v1 เก็บไว้):
   - Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs: `https://api-farmland2.family-sivarom.com/api/auth/oauth/google/callback`
   - LINE Developers → LINE Login → Callback URL: `https://api-farmland2.family-sivarom.com/api/auth/oauth/line/callback`
   - Facebook (ตอนสร้าง App): Valid OAuth Redirect URIs: `.../api/auth/oauth/facebook/callback` · Privacy Policy URL: `https://farmland2.family-sivarom.com/privacy` · Data Deletion URL: `https://farmland2.family-sivarom.com/data-deletion`
5. **เช็ค:** เปิดหน้าเว็บ → ล็อกอินแอดมิน (Google อีเมลแอดมิน หรือรหัสจาก seed) → หลังบ้าน → **ตั้งค่าร้าน** (เลขพร้อมเพย์/ลิงก์ติดต่อ) + **แพ็กเกจ & ราคา** (ตั้งราคาจริง)

## ขั้น D — เดโม
1. ที่เครื่อง: ใส่ลิงก์หน้าเว็บจริง (ปุ่ม "สมัครใช้กับฟาร์มของคุณ" ในเดโม) แล้ว build:
   ```bash
   VITE_APP_URL=https://farmland2.family-sivarom.com npm run build:demo
   ```
2. zip ของข้างใน `dist-demo/` → อัปโหลดลง subdomain เดโม → Extract · Proxy mode ติ๊กไว้
3. เดโมไม่ต้องมี backend ไม่ต้องตั้งอะไรเพิ่ม

## ลองใช้จริงก่อนย้าย (เช็คลิสต์)
- [ ] สมัครด้วยอีเมลใหม่ → เห็นหน้ารอเปิดใช้งาน + QR พร้อมเพย์ → อัปสลิป → แอดมินอนุมัติ → เข้าใช้ได้
- [ ] ล็อกอิน Google / LINE ได้
- [ ] สร้างระบบปู → รับปูล็อตแรก (มีรูป → อัปโหลดรูปได้)
- [ ] เปิด **อาหารปู** 2 เครื่องพร้อมกัน → แถบบนหน้ากล่องปูขึ้น "ซิงค์สด" (ไม่ใช่ "ทุก 20 วิ")
- [ ] หมู่บ้านฟาร์ม: 2 บัญชีเข้าร่วม → ขอเข้าชม → อนุญาต → เดินเห็นกัน (ชิป "2 คน" ไม่ใช่ "ออฟไลน์")
- [ ] รอ 15–30 นาที → อีเมลสรุปงานมาตามเวลาที่ตั้ง (ใส่อีเมลรับแจ้งเตือนในโปรไฟล์ก่อน)
- [ ] มือถือ: กดสอนทีละขั้นสักเรื่อง · โหมดเสียงนำทางตอนให้อาหาร

## ขั้น E — ย้ายจริง (หลังพอใจแล้ว)
1. บอกเพื่อน (เจ้าของฟาร์มที่ใช้ v1) ว่าข้อมูลเดิมไม่ย้าย — ถ้าอยากเก็บ ใช้ปุ่มส่งออก CSV ของ v1 ก่อน
2. **ให้ v2 ใช้ชื่อโดเมนเดิม (แนะนำ — ลูกค้าจำที่อยู่เดิมได้):**
   - โดเมนหน้าเว็บเดิม `farm-land…` → ลบไฟล์ v1 ใน `httpdocs` (เก็บ zip สำรองไว้ก่อน) → อัปโหลด `dist/` ที่ build ด้วย API **เดิม** (`npm run build` เฉย ๆ — `.env.production` ชี้ `api-farmland.family-sivarom.com` ไว้แล้ว)
   - โดเมน API เดิม `api-farmland…` → Git เปลี่ยน branch เป็น `main` (หลังรวม v2 เข้า main ในข้อ 3) หรืออัปโหลดโค้ด v2 → ใส่ Environment variables ชุดเดียวกับขั้น B3 แต่ `FRONTEND_URL` / `OAUTH_CALLBACK_BASE` เป็นโดเมนเดิม + **`DATABASE_URL` เป็น DB v2** → NPM install → build → Restart · Proxy mode ปิด (ปิดอยู่แล้วจาก v1)
   - Scheduled Task เดิม (v1 วันละครั้ง 12:30) → แก้ URL/secret ให้ตรง v2 และตั้ง **ทุก 15 นาที** · ลบ task ของ subdomain ทดสอบ
   - subdomain ทดสอบ (`farmland2`, `api-farmland2`) ลบได้ หรือ redirect ไปโดเมนเดิม
3. **รวมโค้ด:** `main` ของทั้ง 2 repo ยังเป็น v1 (`v1-final`) → รวม `v2` เข้า `main` ได้แบบ fast-forward (บอก Claude ให้ทำ + push) · โค้ด v1 ยังอยู่ที่ tag `v1-final`
4. DB v1 เก็บไว้อย่างน้อย 1–2 เดือนก่อนลบ

## ถ้ามีปัญหา
| อาการ | สาเหตุที่เจอบ่อย |
|---|---|
| หน้าเว็บขึ้น แต่ล็อกอินแล้วขึ้น error เครือข่าย | build ด้วย `VITE_API_BASE_URL` ผิด / API ไม่ใช่ https / `FRONTEND_URL` ไม่ตรงโดเมนหน้าเว็บ (CORS) |
| รีเฟรชหน้า `/crabs` แล้ว 404 | ไม่ได้อัปโหลด `.htaccess` หรือปิด Proxy mode ของโดเมน **หน้าเว็บ** |
| ชิป "ออฟไลน์" ในหมู่บ้าน / ไม่ซิงค์สด | Proxy mode ของโดเมน **API** ยังเปิดอยู่ |
| อีเมลแจ้งเตือนไม่มา | Scheduled Task ไม่ได้ตั้ง/secret ไม่ตรง (เปิด URL ของ task เองในเบราว์เซอร์ต้องได้ JSON ไม่ใช่ "scheduler secret ไม่ถูกต้อง") · ผู้ใช้ไม่ได้ใส่อีเมลรับแจ้งเตือน |
| ล็อกอิน Google ขึ้น `redirect_uri_mismatch` | ยังไม่ได้เพิ่ม redirect URI ใหม่ใน Google Cloud Console (ขั้น C4) |
| `prisma generate` / แอปไม่ start บน Plesk | ลืม Run script `build` · Node.js ต่ำกว่า 18 · Startup file ไม่ใช่ `dist/server.js` |
