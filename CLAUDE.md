# CLAUDE.md — express-farmland (Backend) · v2

> context หลักสำหรับ Claude ทุก session ใหม่ — อ่านก่อนเริ่มงานเสมอ · อัปเดตทุกครั้งที่จบเฟส / ตัดสินใจเรื่องสำคัญ / เปลี่ยน schema

## 👉 ทำต่อจากตรงนี้ (NEXT)
**กำลังรื้อทำใหม่เป็น v2** (เริ่ม 2026-11-08) — ระบบจัดการปูสำหรับ **ขาย** ให้คนเลี้ยงปู (รายเดือน/รายปี/ซื้อขาด ต้องจ่ายก่อนถึงใช้ได้)
- 📄 **แผนเต็ม (ผู้ใช้อนุมัติแล้ว): [docs/v2-plan.md](./docs/v2-plan.md)** — มีคำตอบ/ไอเดียของทุกข้อที่ผู้ใช้ถาม, เมนูใหม่, schema v2, ลำดับเฟส P0–P9
- 📄 ประวัติ + บทเรียนทั้งหมดของ v1: [docs/v1-notes.md](./docs/v1-notes.md) · โค้ด v1 ทั้งก้อนอยู่ที่ tag `v1-final` (ทั้ง 2 repo)
- branch ที่ทำงาน = **`v2`** (ทั้ง backend และ `../../Frontend/farmland-web`) · `main` ยังเป็น v1 ที่ใช้งานจริงอยู่บน Plesk จนถึงวันย้าย

| เฟส | สถานะ |
|---|---|
| P0 เก็บ v1 + เตรียม | ✅ commit + tag `v1-final` + branch `v2` ทั้ง 2 repo (ยังไม่ push) · ⏳ **รอผู้ใช้สร้าง DB ใหม่ + shadow DB ใน Plesk แล้วส่ง `DATABASE_URL`** |
| P1 รากฐาน (schema v2, auth+Facebook, แพ็กเกจ/สลิป, โครง Sakai, mock/demo, หลังบ้านพื้นฐาน) | ⏭️ ถัดไป |
| P2–P9 | ยังไม่เริ่ม — ดูแผน |

ค้างถามผู้ใช้: ข้อ 4.9 ประโยคขาด ("default 15 size และให้…") · รูป sidebar ที่บอกว่าแนบไม่ได้ติดมา (ตอนนี้ใช้แบบ `vue-quest-web` สีหลัก teal)

## การตัดสินใจหลักของ v2 (ตกลงแล้ว)
| หัวข้อ | เลือก |
|---|---|
| ฐานข้อมูล | **DB ใหม่** schema ใหม่ทั้งหมด · migration เดียว `init_v2` · DB v1 (`familysi_farmland`) เก็บเป็นสำรองจนกว่า v2 จะนิ่ง |
| Demo | หน้าเว็บโค้ดชุดเดียว build 2 แบบ (`VITE_API_MODE=http|mock`) → demo ไม่มี backend |
| หน้าตา | PrimeVue 4 (Aura) + Sakai + Tailwind + ฟอนต์ Kanit — เลียนแบบ `D:/my-project/Frontend/vue-quest-web` แต่สีหลัก **teal** · ธีมมืดเป็นค่าเริ่มต้น |
| การจ่ายเงิน | อัปสลิป + แอดมินอนุมัติใน back office (QR พร้อมเพย์ + ลิงก์ LINE/Facebook) |
| น้ำหนัก | เก็บ **กรัม** ช่องเดียว · แสดงตาม `User.weightUnit` (ขีด/กรัม) |
| Stack backend | เหมือนเดิม: Node + Express + Prisma + MySQL + TypeScript + zod · deploy Plesk/Passenger |
| Scheduler | `/api/scheduler/tick` + Plesk Scheduled Task **ทุก 15 นาที** (v1 ตั้งไว้วันละครั้ง 12:30 — ต้องเปลี่ยนตอน P3) · แอปเลือกเวลาส่งอีเมลเอง (ค่าเริ่มต้น 08/12/16/20 น.) |

## ⚠️ บทเรียนจาก v1 ที่ยังใช้กับ v2 (รายละเอียดใน docs/v1-notes.md)
- **รัน migration เองได้** (ผู้ใช้อนุญาต) — หลังแก้ `schema.prisma` รัน `npx prisma migrate deploy` + `npx prisma generate` ได้เลย (dev ต่อ DB remote จริง)
- รหัสผ่าน DB มี `@` → ต้องเขียน `%40` ใน `DATABASE_URL` · `migrate dev` ต้องมี `SHADOW_DATABASE_URL` (shared hosting สร้าง DB เองไม่ได้)
- **Plesk:** โดเมน API ต้อง**ปิด** "Proxy mode" (ไม่งั้น Apache ถอด header `Upgrade` → WebSocket ใช้ไม่ได้) · โดเมนหน้าเว็บต้อง**เปิด** (SPA ต้องอ่าน `.htaccess`) · Host Atom ไม่ให้ลูกค้าใส่ custom nginx/Apache directive
- Passenger พัก process ตอน idle → ห้ามพึ่ง in-process cron เป็นกลไกหลัก (dev ใช้ `ENABLE_INTERNAL_CRON=true`)
- **วันที่:** ห้ามใช้ `toISOString().slice(0,10)` ทำ "วันของไทย" (เป็น UTC → ตี 2 ได้วันเมื่อวาน) → ใช้ `ymdLocal` ใน `src/lib/feedingCycle.ts` · `process.env.TZ='Asia/Bangkok'` ตั้งใน `config/env.ts`
- nullable `Json` ใน Prisma ต้องใช้ `Prisma.DbNull` แทน `null`
- ปิดอะไรที่ต้องเกิด "ครั้งเดียว" (เช่นปิดรอบให้อาหาร) ใช้ conditional `updateMany({id, status})` แล้วเช็ค `count` — กัน 2 เครื่องกดพร้อมกัน
- อ่านข้ามผู้ใช้ (หมู่บ้าน / หลังบ้าน) ต้องใช้ `select` ที่กำหนดฟิลด์เอง ห้าม `include` ทั้งแถว (passwordHash / uiPrefs รั่ว)
- `assertCanViewFarm` โยน **404 ไม่ใช่ 403** (กันไล่เดา id)
- FE: watcher `immediate:true` ที่อ้าง `const` ที่ประกาศทีหลัง = พังเงียบ (Vue กลืน error) · ห้ามใช้ CSS `backdrop-filter` (มือถือร้อน) · คำขอที่ต้องเรียงลำดับให้ยิงเป็นคิว ไม่ยิงขนาน

## Conventions
- `routes → validate(zod) → service → prisma` · ห่อ async route ด้วย `asyncHandler` · error = `{ error, details? }`
- เงิน `Decimal(12,2)` → แปลง `.toNumber()` ก่อนคำนวณ/ส่ง JSON (`lib/serialize.ts`)
- ข้อมูลของลูกค้าแต่ละคนแยกขาดด้วย owner (`lib/scope.ts`) · ADMIN เห็นทั้งหมด
- ข้อมูลเริ่มต้นของลูกค้า (อาหาร / ค่าน้ำ / แจ้งเตือน 6 เรื่อง) สร้างใน service ตอนสมัคร/สร้างระบบปู — seed มีแค่แพ็กเกจ + ตั้งค่าร้าน + แอดมิน
- คอมเมนต์ / ข้อความเป็นภาษาไทย · `API.md` ต้องอัปเดตทุกครั้งที่แก้ route (v2 จะเขียน API.md ใหม่ตอน P1)

## Log
- **2026-11-08** — เริ่ม v2: ผู้ใช้อนุมัติแผน `docs/v2-plan.md` · P0: commit งานค้างของ v1 ทั้ง 2 repo (frontend เดิมมีแค่ "first commit" งานที่เหลือไม่เคย commit เลย) + tag `v1-final` + branch `v2` · ย้าย CLAUDE.md เดิมไป `docs/v1-notes.md`
