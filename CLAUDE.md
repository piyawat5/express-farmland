# CLAUDE.md — express-farmland (Backend)

> ไฟล์นี้เป็น context หลักสำหรับ Claude ทุก session ใหม่ — อ่านก่อนเริ่มงานเสมอ
> อัปเดตทุกครั้งที่มี decision สำคัญ / สร้าง module ใหม่ / เปลี่ยน schema

## 👉 ทำต่อจากตรงนี้ (NEXT — session ใหม่อ่านตรงนี้ก่อน)
**Phase 1–4 เสร็จแล้ว** — typecheck ผ่าน; Phase 4 **ไม่ต้อง migrate ใหม่** (model D มีตั้งแต่ schema init แล้ว)

**Phase 4 (Reminder Engine) เสร็จแล้ว** ✅ — ยังไม่ได้ทดสอบ server จริง/ส่งเมลจริง (รอผู้ใช้รัน)
- ไฟล์ใหม่: `lib/cron.ts` (cron matcher 5-field + `nextCronAfter` — เขียนเอง ไม่เพิ่ม dep), `lib/notify.ts` (`notifyTask`: ปลายทาง user→owner→MAIL_TO, ส่งเมล, log `Notification`, เดิน `notifyCount`/`lastNotifiedAt`), `services/task.service.ts` + `reminder.service.ts` + `scheduler.service.ts`, `routes/scheduler.ts`
- **schedule calc** (`reminder.computeNextRunAt`): INTERVAL_DAYS/MONTHS ยึด `timeOfDay` ถ้ามี, CRON ใช้ `nextCronAfter`, EVENT=null; คำนวณ `nextRunAt` ให้ตอน create/update rule
- **tick** (`scheduler.tick`): (1) rule ที่ `nextRunAt<=now` → สร้าง Task (กันซ้ำถ้ามี PENDING ของ rule นั้น) แล้วเลื่อน `nextRunAt`; (2) **digest** (`notifyPendingDigest`) — ถ้ามี Task `PENDING & dueAt<=now` ส่ง **เมลสรุปรวมฉบับเดียว** "คุณมีแจ้งเตือนทั้งหมด N รายการที่ยังไม่ได้ทำ" + ลิสต์ (group ตามปลายทาง); ถ้าไม่มีงานค้าง → เงียบ ไม่ส่ง
- **ความถี่ "ตามจิก"** = ความถี่ cron บน Plesk (ผู้ใช้ตั้งเอง) **+ throttle ระดับ digest:** เมลสรุปต่อปลายทางส่งซ้ำเร็วสุดทุก env `DIGEST_MIN_INTERVAL_MIN` (default 60 นาที) — **เว้นแต่มีงานใหม่ที่ยังไม่เคยเตือน (`lastNotifiedAt=null`) จะเด้งทันที** ไม่รอครบรอบ; `reNotifyEveryMin` ต่อ Task เลิกใช้ throttle แล้ว (field ยังเก็บไว้); ผู้ใช้จะเอา API ไปใส่ Plesk Scheduled Task เอง
- endpoints: **`GET` หรือ `POST /api/scheduler/tick`** — secret รับได้ทั้ง header `x-scheduler-secret` และ query `?secret=` (=env `SCHEDULER_SECRET`); `/api/reminder-rules` CRUD (`?systemId`) + `/:id`; `/api/tasks` GET (`?systemId&status&type`) + `/:id` GET, PATCH `{status}` (**ห้าม DONE ทางนี้**), `POST /:id/notify` (ส่งเตือนใบเดียว/debug); `POST /api/systems/:id/fire-event` `{event}` (event chain manual)
- **event chain ปิดแล้ว:** `createWaterTest` → ปิด Task `WATER_TEST` ที่ค้าง (DONE + `linkType/linkId` + `waterTest.taskId`) → ถ้าค่าหลุดเป้าสร้าง Task `DOSING` (childTask, กันซ้ำ) → คืน `{ waterTest, recommendations, closedTaskId, dosingTaskId }`
- **internal cron** (`server.ts`): `ENABLE_INTERNAL_CRON=true` → node-cron ยิง `tick()` ทุก 1 นาที (dev only); prod ใช้ Plesk Scheduled Task
- **seed เพิ่ม:** 3 ReminderRule — วัดน้ำ INTERVAL_DAYS/3วัน (`nextRunAt=now` ให้ tick แรกยิงเลย), ให้อาหาร CRON `0 20 */2 * *`, วัดน้ำหลังเติมน้ำจืด EVENT
- **ต้องมีใน .env:** `SCHEDULER_SECRET` (required), `ENABLE_INTERNAL_CRON=true` (dev), `EMAIL_USER`/`EMAIL_PASS`, `DIGEST_MIN_INTERVAL_MIN` (default 60)
> ทดสอบ slice: `npm run prisma:seed` → `npm run dev` → `GET /api/scheduler/tick?secret=...` → ได้ Task วัดน้ำ + เมลสรุป "คุณมีงานค้าง N รายการ" เข้า Gmail; แล้ว `POST /api/systems/:id/water-tests` → Task ปิด + เกิด Task ปรุงน้ำถ้าค่าหลุด

---
**ของเดิม (Phase 1–3):**

**Phase 2 (CRUD) — โมดูล A + B + seed**
- pattern: `routes → validate(zod) → service → prisma`; service อยู่ใน `src/services/*.service.ts`
- helper: `lib/serialize.ts` (Decimal→number), `lib/validation.ts` (`idParam`, `pageQuery`)
- endpoints A: `/api/systems` (CRUD) + nested `/:id/boxes`, `/:id/boxes/generate`, `/:id/filter-tanks`; รายตัว `/api/boxes/:id`, `/api/filter-tanks/:id`
- endpoints B: `/api/crabs` (CRUD + filter `?systemId&status&type`) — auto sync `CrabBox.status` + กันปู 2 ตัว/กล่อง
- seed (`prisma/seed.ts`, idempotent): user(id1) + ระบบข้างบ้าน(id1, 500L) + 30 กล่อง A1..C10 + 3 ถังกรอง + WaterTarget 7 (min/max ว่าง) + Substance 8

**Phase 3 (โมดูล C — น้ำ + ปรุงน้ำ) เสร็จแล้ว** ✅ — ทดสอบบน server จริงผ่าน (dose math ถูก)
- **redesign dosing เป็น calibration-based แล้ว:** เพิ่ม model `DosingCalibration` (ต่อระบบ, unique `[systemId,substanceId,parameter]`); `DosingRule` เลิกสูตรปริมาตร — ทิ้ง `amountBasisL`, เปลี่ยน `amountPerDose`→`fixedDose` (ใช้เฉพาะกรณีไม่มี calibration เช่น biodigest)
- service: `services/water.service.ts` (WaterTest CRUD + WaterTarget upsert + preview), `services/dosing.service.ts` (Substance CRUD + Calibration + Rule + `evaluateWaterValues`)
- endpoints (mount หลาย router ซ้อนบน `/systems` ได้):
  - `/api/systems/:id/water-tests` GET/POST (POST คืน `{ waterTest, recommendations }`), `/api/water-tests/:id` GET/PATCH/DELETE
  - `/api/systems/:id/water-targets` GET + PUT (upsert ทีละ parameter)
  - `/api/systems/:id/dosing-preview` POST (ประเมินจากค่าที่กรอก ไม่บันทึก)
  - `/api/substances` CRUD (`?all=true` รวม inactive)
  - `/api/systems/:id/dosing-calibrations` GET + PUT (upsert), `/api/dosing-calibrations/:id` DELETE
  - `/api/systems/:id/dosing-rules` GET/POST, `/api/dosing-rules` POST (rule กลาง systemId=null), `/api/dosing-rules/:id` PATCH/DELETE
- **dose calc** (`evaluateWaterValues`): เทียบทุก param กับ `WaterTarget` → หา `DosingRule` ที่ตรง (rule เฉพาะระบบมาก่อน rule กลาง) → ถ้า DOSE + BELOW_MIN + มี calibration: `dose = (targetMax − current) / effectPerUnit`; ไม่มี calibration → `fixedDose`; MEASURE_NEXT/NOTE → คืน message
- **ยังไม่ทำ (รอ Phase 4):** บันทึก WaterTest ยังไม่ปิด Task / ไม่สร้าง Task ปรุงน้ำจาก recommendations — event chain ทำตอนมี Reminder Engine

**งานถัดไป:**
1. **Phase 5** ⭐ — โมดูล E: `Contact`, `Transaction` (status QUOTE → คำนวณกำไรล่วงหน้า), `OutreachLog` (ไล่ทักคู่ค้าทีละเจ้าต่อรอบ)
2. **ค้าง Phase 4 (option):** `FRESHWATER_TOPUP` แบบ "นับวัน" ต่อระบบ (เช่น 12 วัน, แบ่ง 3 ครั้ง MIN→MAX `payload.splitCount`), เตือนเตรียมจุลินทรีย์ตาม `prepLeadDays`, RESTOCK จาก `InventoryItem.lowThreshold`

## ภาพรวมโปรเจกต์

ระบบจัดการการเลี้ยง **ปูคอนโด** ที่ใช้ระบบน้ำหมุนเวียน **RAS** (Recirculating Aquaculture System)
- **Backend นี้:** Node.js + Express + Prisma + MySQL + TypeScript (repo นี้)
- **Frontend (แยก repo, ทำทีหลัง):** Vue.js
- **ผู้ใช้:** เจ้าของฟาร์มคนเดียว (single user) — เพิ่งเริ่มเลี้ยง

### Pain points ที่ระบบต้องแก้ (เรียงตามความสำคัญ)
1. **แจ้งเตือนงานที่ลืมทำ** + "ตามจิก" จนกว่าจะทำจริง (ดู Reminder Engine)
2. **Dashboard ต้นทุน/กำไร** รวมศูนย์แทน Excel ที่กระจัดกระจาย
3. **Dashboard วิเคราะห์** น้ำหนัก/%ความแน่นเนื้อ-ไข่ เทียบระยะเวลาเลี้ยง ว่าคุ้มไหม

## คำศัพท์สำคัญ (ระวังสับสน)
- **"ระบบปู" (CrabSystem)** = ระบบน้ำ RAS จริง 1 ชุด (ถังกรองแยกกัน = คนละระบบ) สร้างได้หลายระบบ
- **"ระบบ" เฉยๆ** = ตัวเว็บ/แอปนี้
- ตอนนี้ของจริงมี 1 ระบบ: 30 กล่องปู + 3 ถังกรอง
- **ปู 1 ตัว = 1 กล่อง** เสมอ

## Tech & Architecture decisions (ตกลงแล้ว)
| หัวข้อ | เลือก | เหตุผล |
|---|---|---|
| ภาษา | **TypeScript** | logic ซับซ้อน (dosing calc, task state, profit calc) |
| DB | **MySQL** | host (Host Atom) มีให้ใช้ไม่จำกัด |
| Deploy | **Host Atom / Plesk + Passenger** | ผู้ใช้เช่าไว้แล้ว เคยขึ้น Node หลายระบบ |
| Scheduler | **endpoint `/api/scheduler/tick` + Plesk Scheduled Task ยิงทุก 15 นาที** | Passenger พัก process ตอน idle → in-process cron ไม่ชัวร์ |
| Email | **nodemailer + Host Atom SMTP** (`bot01@family-sivarom.com` @ `thsv35.hostatom.com:587`, env `EMAIL_USER`/`EMAIL_PASS`) | ใช้อีเมลโดเมนตัวเอง ไม่ติด limit (Line ทำทีหลัง) |
| ปลายทางแจ้งเตือน | **dynamic จาก `User.email`** (ไม่ fix ใน env) | ส่งหา Gmail ของ user ที่ใช้งาน; `MAIL_TO` เป็นแค่ fallback |
| Validation | **zod** | คุม input + แปลง type |
| โครงสร้าง | `routes → (validate) → service → prisma` | แยก business logic ออกจาก route |

### ⚠️ ข้อจำกัด Plesk/Passenger ที่ต้องจำ
- process อาจถูกพักตอน idle → **ห้ามพึ่ง `setInterval`/in-process cron เป็นกลไกหลัก** ของการเตือน
- การเตือนซ้ำทุก 15 นาทีต้องมาจาก **Plesk Scheduled Task** ที่ยิง HTTP เข้า `/api/scheduler/tick` (แนบ header `x-scheduler-secret`)
- ตอน dev ในเครื่องใช้ `ENABLE_INTERNAL_CRON=true` ให้ node-cron จำลองการยิง tick
- Startup file บน Plesk = `dist/server.js` (ต้อง `npm run build` ก่อน), `postinstall` รัน `prisma generate` ให้ตรง OS host

### ⚠️ ข้อควรระวัง DB (gotcha จริงในโปรเจกต์นี้)
- **รหัสผ่าน DB มี `@`** → ต้อง URL-encode เป็น `%40` ใน `DATABASE_URL` ไม่งั้น Prisma parse host ผิด (encode: `@`→`%40`, `#`→`%23`, `/`→`%2F`)
- dev ต่อ MySQL **remote** (`14.207.141.5`) → ต้องเปิด Remote Access ใน Plesk + whitelist IP เครื่อง dev
- `prisma migrate dev` ต้องมี **shadow DB** (มี `SHADOW_DATABASE_URL` ชี้ DB ว่างอีกตัว) เพราะ user สร้าง DB เองไม่ได้บน shared hosting; ตอน deploy ใช้ `prisma migrate deploy` (ไม่ต้อง shadow)

## ★ Reminder Engine — กลไกหัวใจ (ข้อ 6)
3 ชั้น: **ReminderRule → Task → Notification**
- `ReminderRule` = กฎ (อะไร/เมื่อไร/ตามจิกทุกกี่นาที) schedule แบบ ทุก N วัน / ทุก N เดือน / cron / event
- `Task` = งานจริง 1 ชิ้น มี `dueAt`, `status` (PENDING→DONE), ตัวนับ `notifyCount`
- **การปิด Task ต้องมาจากการบันทึกข้อมูลจริง** (เช่นบันทึก `WaterTest`) ไม่ใช่แค่กดรับทราบ → set `linkType`/`linkId` + status=DONE
- tick (ทุก 15 นาที): หา Task `PENDING` ที่ `dueAt <= now` และถึงรอบเตือนซ้ำ → ส่ง Gmail → เพิ่ม `notifyCount`
- **Event chain:** บันทึก WaterTest → เช็ค `DosingRule` → ถ้าค่าหลุดเป้า สร้าง Task "ปรุงน้ำ" (childTask) ต่อทันที

## Data model (7 โมดูล) — ดูเต็มใน `prisma/schema.prisma`
- **User:** เจ้าของฟาร์ม (email ปลายทางแจ้งเตือน) → `CrabSystem.owner`, `Task.user`
- **A. ฮาร์ดแวร์:** `CrabSystem` → `CrabBox`, `FilterTank`
- **B. ปู:** `Crab` → `FeedingRecord`, `FirmnessRecord`
- **C. น้ำ:** `WaterTest`, `WaterTarget`, `Substance`, `DosingRule`, `DosingRecord`, `SubstancePrep`
- **D. แจ้งเตือน:** `ReminderRule`, `Task`, `Notification`
- **E. คู่ค้า:** `Contact`, `Transaction` (มี status QUOTE = คำนวณกำไรล่วงหน้า), `OutreachLog`
- **F. การเงิน:** `LedgerEntry` (สมุดบัญชีรวม income/expense)
- **G. คลัง:** `InventoryItem`

### หลักการออกแบบที่ตั้งใจไว้
- `Substance` เป็น master list เดียว (เพิ่มสารใหม่ได้โดยไม่แก้โค้ด) — รองรับข้อ 2.1-2.3
- `DosingRule` แยก logic การปรุงน้ำออกจากโค้ด: รองรับทั้ง "เติมสาร+คำนวณปริมาณ", "แนะนำให้วัดค่าต่อ", "แค่เตือน"
- dosing amount = **calibration-based ต่อระบบ** (Phase 3 redesign): `dose = (targetMax − current) / DosingCalibration.effectPerUnit`; ถ้าไม่มี calibration → ใช้ `DosingRule.fixedDose` (จำนวน fix). **เลิกใช้สูตรปริมาตรเดิม** (`amountPerDose × waterVolumeL/amountBasisL`) แล้ว
- `Transaction.status = QUOTE` รองรับข้อ 4.5 (กรอกราคาที่ไปถามมา → คำนวณกำไรล่วงหน้า ก่อนตกลงจริง)
- `OutreachLog` ติดตามการไล่ทักคู่ค้าทีละเจ้าต่อรอบ (ข้อ 4.4)

## โครงสร้างไฟล์
```
src/
  config/env.ts        — โหลด+validate env ด้วย zod
  lib/prisma.ts        — Prisma client (singleton)
  lib/http.ts          — AppError, asyncHandler
  middleware/error.ts  — error handler รวม (zod/Prisma/AppError)
  middleware/validate.ts
  routes/index.ts      — mount โมดูล
  routes/health.ts
  app.ts / server.ts
prisma/schema.prisma
```

## Conventions
- Response error: `{ error: string, details?: unknown }`
- ใช้ `asyncHandler` ห่อ async route ทุกตัว
- Validate input ด้วย `validate({ body/query/params })` ก่อนเข้า handler
- เงินใช้ `Decimal(12,2)` เสมอ — ระวัง Prisma คืนเป็น `Prisma.Decimal` (แปลงด้วย `.toNumber()` ตอนคำนวณ/ส่ง JSON)
- คอมเมนต์ domain เป็นภาษาไทยได้ (ผู้ใช้ถนัดไทย)

## Roadmap (phase)
- [x] **Phase 1** — รากฐาน: scaffold, Prisma schema เต็ม, health check, CLAUDE.md
- [x] **Phase 2** — CRUD โมดูล A (CrabSystem/Box/FilterTank) + B (Crab) + seed ✅
- [x] **Phase 3** — โมดูล C: WaterTest, WaterTarget, Substance, DosingCalibration, DosingRule + คำนวณ dosing (calibration-based) ✅
- [x] **Phase 4** — Reminder Engine: ReminderRule/Task/Notification, tick endpoint, mailer, event chain ✅
- [ ] **Phase 5** — โมดูล E: Contact, Transaction (QUOTE/กำไร), OutreachLog
- [ ] **Phase 6** — โมดูล F: Dashboard/analytics endpoints
- [ ] **Phase 7** — seed ข้อมูลจริง (ย้ายมาทำพร้อม Phase 2 — ดูบล็อกล่าง)

## Seed data (ทำพร้อม Phase 2) — `prisma/seed.ts`
ข้อมูลจริงของผู้ใช้ที่ต้อง seed:
- **User เจ้าของ:** email `jame.piyawat111@gmail.com` (owner ของระบบ, `notifyByEmail=true`)
- **CrabSystem:** 1 ระบบ ชื่อ "ระบบข้างบ้าน" → `CrabBox` 30 กล่อง (code A1..A30 หรือตามผู้ใช้) + `FilterTank` 3 ถัง
- **WaterTarget** (7 พารามิเตอร์ ให้ผู้ใช้ปรับ min/max เอง): PH, ALKALINITY, MAGNESIUM, CALCIUM, SALINITY, AMMONIA, NITRITE
- **Substance** (master list — หน่วย/ปริมาณผู้ใช้ปรับเองได้):
  - MINERAL: แร่ธาตุรวม, แมกนีเซียม, แคลเซียม, เบกกิ้งโซดา, เกลือ
  - MICROORGANISM: จุลินทรีย์สังเคราะห์แสง (`needsPrep`, `prepLeadDays` นาน), จุลินทรีย์ ปม.1 (`needsPrep`, `prepLeadDays≈1`), แบคทีเรีย biodigest (`needsRepurchase`)
- **ReminderRule** ตัวอย่างตามพฤติกรรมจริง:
  - วัดค่าน้ำ — EVENT `AFTER_FRESHWATER` และ/หรือ ทุก N วัน
  - ให้อาหาร — CRON วันเว้นวัน 20:00 (`0 20 */2 * *` หรือ logic วันเว้นวัน)
  - เก็บเศษอาหาร — EVENT `AFTER_FEEDING` +3 ชม.
  - ล้างกรอง — INTERVAL_MONTHS ทุก N เดือน (ข้อ 5)
  - เติมน้ำจืด — แบ่ง ~3 ครั้ง MIN→MAX (`payload.splitCount=3`, ข้อ 2.4)
  - เตรียมจุลินทรีย์ — เตือนล่วงหน้าตาม `prepLeadDays` (ข้อ 2.3)
- **DosingRule** ตัวอย่าง: ถ้า ALKALINITY < min → DOSE เบกกิ้งโซดา; ถ้า PH < min → MEASURE_NEXT (แนะนำวัดค่าต่อ)
> ค่าตัวเลขจริง (min/max, ปริมาณสาร, รอบวัน) ให้ถามผู้ใช้ตอนทำ seed เพราะผู้ใช้ custom เอง

## Log การเปลี่ยนแปลง
- **2026-06-14** — เริ่มโปรเจกต์ Phase 1: scaffold + schema 7 โมดูล + health check
- **2026-06-14** — เพิ่ม `User` (เจ้าของระบบ) → ปลายทางแจ้งเตือน dynamic; เปลี่ยน email เป็น Host Atom SMTP (`EMAIL_USER`/`EMAIL_PASS`)
- **2026-06-14** — รัน migration `init` สำเร็จบน MySQL remote (`familysi_farmland`), ทดสอบ `/api/health` + `/api/health/db` ผ่าน — Phase 1 ✅
- **2026-06-14** — Phase 2 CRUD: โมดูล A (`services/system.service.ts`, `routes/systems.ts`) + B (`services/crab.service.ts`, `routes/crabs.ts`), helper `serialize`/`validation`, mount ใน `routes/index.ts`, typecheck ผ่าน
- **2026-06-14** — `prisma/seed.ts` รันลง DB จริง (user+ระบบ+30 กล่อง+3 ถัง+7 WaterTarget+8 Substance); ทดสอบ CRUD+box-occupancy ผ่าน server — Phase 2 ✅. บันทึก insight โมเดล dosing = calibration-based (กระทบ schema Phase 3)
- **2026-06-14** — Phase 3 โมดูล C: redesign dosing เป็น calibration-based (เพิ่ม model `DosingCalibration`, `DosingRule` ทิ้ง `amountBasisL`/`amountPerDose`→`fixedDose`); migration `phase3_water_dosing_calibration` apply ลง DB จริง; เพิ่ม `water.service`/`dosing.service` + `routes/water`/`routes/dosing`; ทดสอบบน server จริง (dose `(14−9)/2.5=2` ถูก) — Phase 3 ✅
- **2026-06-14** — Phase 4 Reminder Engine: เพิ่ม `lib/cron.ts` (cron matcher เขียนเอง) + `lib/notify.ts` + `task/reminder/scheduler.service` + `routes/scheduler`; tick endpoint + ตามจิก + event chain (WaterTest ปิด Task → สร้าง Task ปรุงน้ำ); internal cron (dev) + seed 3 ReminderRule; **ไม่ต้อง migrate** (model D มีอยู่แล้ว); typecheck ผ่าน — Phase 4 ✅ (ยังไม่ทดสอบ server/เมลจริง)
