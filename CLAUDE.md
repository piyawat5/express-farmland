# CLAUDE.md — express-farmland (Backend) · v2

> context หลักสำหรับ Claude ทุก session ใหม่ — อ่านก่อนเริ่มงานเสมอ · อัปเดตทุกครั้งที่จบเฟส / ตัดสินใจเรื่องสำคัญ / เปลี่ยน schema

## 👉 ทำต่อจากตรงนี้ (NEXT)
**กำลังรื้อทำใหม่เป็น v2** (เริ่ม 2026-11-08) — ระบบจัดการปูสำหรับ **ขาย** ให้คนเลี้ยงปู (รายเดือน/รายปี/ซื้อขาด ต้องจ่ายก่อนถึงใช้ได้)
- 📄 **แผนเต็ม (ผู้ใช้อนุมัติแล้ว): [docs/v2-plan.md](./docs/v2-plan.md)** — มีคำตอบ/ไอเดียของทุกข้อที่ผู้ใช้ถาม, เมนูใหม่, schema v2, ลำดับเฟส P0–P9
- 📄 ประวัติ + บทเรียนทั้งหมดของ v1: [docs/v1-notes.md](./docs/v1-notes.md) · โค้ด v1 ทั้งก้อนอยู่ที่ tag `v1-final` (ทั้ง 2 repo)
- branch ที่ทำงาน = **`v2`** (ทั้ง backend และ `../../Frontend/farmland-web`) · `main` ยังเป็น v1 ที่ใช้งานจริงอยู่บน Plesk จนถึงวันย้าย

| เฟส | สถานะ |
|---|---|
| P0 เก็บ v1 + เตรียม | ✅ commit + tag `v1-final` + branch `v2` ทั้ง 2 repo (ยังไม่ push) · DB ใหม่พร้อม |
| P1 รากฐาน | ✅ **เสร็จ 2026-11-08** — BE tsc ✅ · สโมคเทส REST 35 ข้อ ✅ · FE `vue-tsc` + `build` + `build:demo` ✅ · เปิดบน Chrome จริง + ถ่ายภาพหน้าจอ 21 ภาพ (มือถือ/เดสก์ท็อป · มืด/สว่าง · ธีมเทศกาล) ✅ · flow อนุมัติสลิปบนเบราว์เซอร์ ✅ |
| P2 ฟาร์ม & ปู | ✅ **เสร็จ 2026-11-14** — BE tsc ✅ · สโมคเทส REST 30 ข้อ ✅ · FE `vue-tsc` + `build` + `build:demo` ✅ · demo ถ่ายหน้าจอ 21 ภาพ ไม่มี console error ✅ · flow จริงบน Chrome + backend 12 ขั้น (สร้างระบบหน้า-หลัง → รับปู → ⚠ ล็อต → ใส่ราคา → เช็ควันนี้ → สลับกรัม) ✅ ข้อมูลใน DB ตรง |
| P3 แจ้งเตือน | ✅ **เสร็จ 2026-11-15** — BE tsc ✅ · สโมคเทส REST 38 ข้อ ✅ (+ P2 30 ข้อซ้ำ ✅) · FE `vue-tsc` + `build` + `build:demo` ✅ · demo บน Chrome 41 ข้อ (มือถือ+เดสก์ท็อป) ไม่มี console error ✅ · flow จริง Chrome + backend 10 ขั้น + ตรวจ DB ✅ |
| P4 อาหาร | ✅ **เสร็จ 2026-11-15** — BE tsc ✅ · สโมคเทส REST+WebSocket 30 ข้อ ✅ (+ P3 38 / P2 30 ซ้ำ ✅) · FE `vue-tsc` + `build` + `build:demo` ✅ · demo บน Chrome 32 ข้อ (มือถือ+เดสก์ท็อป) ไม่มี console error ✅ · flow จริง Chrome + backend 10 ขั้น (2 แท็บซิงค์ผ่าน WebSocket) + ตรวจ DB ✅ · ⏳ **รอผู้ใช้ทดสอบเสียงไทยบนมือถือ** (หน้าทดสอบ https://claude.ai/artifact/Ap3FGZL5edQc1j6oDU6wRo) — ถ้าเสียงไม่ดีค่อยเปลี่ยนเป็น Cloud TTS |
| **P5 น้ำ** | ⏭️ **ถัดไป** — ค่าที่วัดเพิ่มเองได้ (สีขวด + เกณฑ์) · ประโยคกฎปรุงน้ำ "ถ้า [Mg] ต่ำกว่า [1250] → ใส่ [..] [1] [ช้อน] ค่าขึ้น [+20]" · บันทึกค่า → ผลทันที · ประวัติการ์ดรายวัน + กราฟ · แถบสถานะน้ำบนหน้ากล่องปู (โชว์เฉพาะตัวที่หลุด) · งาน "วัดค่าน้ำ" ปิดเองเมื่อบันทึก (docs/v2-plan.md ข้อ 5.7) |
| P6–P9 | ยังไม่เริ่ม |

**ค้างให้ผู้ใช้ทำ (ไม่ขวางการพัฒนา):** ตอนขึ้น v2 บน Plesk ตั้ง **Scheduled Task → Fetch URL `https://<api>/api/scheduler/tick?secret=<SCHEDULER_SECRET>` ทุก 15 นาที** (v1 ตั้งวันละครั้ง 12:30 — ไม่งั้นอีเมลแจ้งเตือนส่งแค่รอบเดียว) · สร้าง Facebook App แล้วใส่ `FACEBOOK_APP_ID/SECRET` (ปุ่ม Facebook ซ่อนเองจนกว่าจะใส่) · ตั้งราคาแพ็กเกจจริงที่หลังบ้าน (seed ใส่ 199 / 1,990 / 4,990 เป็นค่าตั้งต้น) · ล็อกอินแอดมินครั้งแรกด้วย Google (`jame.piyawat111@gmail.com` — ผูกบัญชีจากอีเมลให้เอง) หรือรัน `SEED_ADMIN_PASSWORD=... npm run prisma:seed`

### P4 ที่ทำไปแล้ว (2026-11-15)
- **schema** (migration `p4_feeding`): `FeedItem` (ต่อเจ้าของ · `qty` + `stockSet` — ยังไม่เคยใส่ = ไม่ตัดสต็อก ไม่เตือน) · `FeedStockMove` (BUY/USE/ADJUST · `roundId`) · `FeedingPlan` (1 ระบบ 1 แผน · onDays/offDays/anchorDate/timeOfDay · `pattern` SINGLE/ALTERNATE · itemId/altItemId · `piecesPerCrab`) · `FeedingPlanDay` (ปรับรายวัน: skip / เปลี่ยนอาหาร) · `FeedingRound` (unique systemId+feedDate · OPEN/DONE/SKIPPED · `fedAt` · `autoClosed` · `reviewPending`) · `FeedingEntry` (**ปูรายตัว**: itemId · pieces · result ATE/LITTLE/NONE — สร้างตอนเปิดรอบ เริ่มที่ ATE) · `ReminderKind.FEED_LOW`
- **โค้ด** `services/feed/`: `items.ts` (อาหารเริ่มต้น ปลา/หอย — ต้องตรงกับ FE `api/mock/feed.ts`) · `plan.service.ts` (`dayPlan` = อาหารของวัน) · `stock.service.ts` (`forecast` "พออีก N รอบ" จากแผนจริง 30 วัน · `applyRoundStock` idempotent) · `round.service.ts` (`syncFeeding` · current · start/fed/close/review · `updateEntries`) · `lib/feedingCycle.ts` (เขียนใหม่ ตัดของ v1 ที่ไม่ใช้ · สำเนาที่ FE `lib/feedCycle.ts`) · `lib/realtime.ts` (เขียนใหม่ เหลือแค่ห้องรอบให้อาหาร) · route `routes/feed.ts`
- **รอบเปิดเองแบบขี้เกียจ** ใน `syncOwner` ของแจ้งเตือน (เรียก `syncFeeding` ก่อนทุกอย่าง): วันให้อาหารล่าสุดที่ถึงเวลาแล้ว · ไม่สร้างย้อนหลังหลายวัน · ไม่สร้างรอบของเวลาก่อนมีแผน (`plan.createdAt`) · มีรอบวันนี้/ใหม่กว่าแล้ว = ไม่ทำ · รอบเก่าที่ยังเปิด = ปิดให้ (autoClosed + reviewPending)
- **สต็อก**: ตัดตอนปิดรอบจากแถวรายตัว · แก้ย้อนหลัง/ไม่ได้ให้ = `applyRoundStock` คำนวณส่วนต่าง (ลบ USE ของรอบแล้วสร้างใหม่ 1 แถวต่ออาหาร) · ของไม่พอ → `PATCH entries {fromItemId,itemId}` เปลี่ยนทั้งรอบ · ใกล้หมด (< 2 รอบ) = งาน `FEED_LOW` + ⚠ `feed_low`
- **แจ้งเตือน "ให้อาหารปู"** (กฎ `FEEDING` repeat `FEEDING_PLAN`): มีงานเมื่อรอบเปิดแต่ยังไม่ `fed` · `fed`/ปิดรอบ = ปิดเอง · กด "เสร็จแล้ว" ที่งาน = `markFedForSystem`
- **WebSocket** (`/ws`, subprotocol `['jwt', token]`): ห้องต่อระบบ (เฉพาะเจ้าของ) · ส่งแค่ "เคาะ" `feeding.changed` ให้ client ไป GET ใหม่ · `/health` บอก `realtime.enabled` · ⚠️ ตอนขึ้น Plesk โดเมน API ต้อง**ปิด** Proxy mode
- ⚠ ใหม่: `feeding_plan_missing` · `feed_stock_missing` · `feed_low` · `feeding_review`

### P3 ที่ทำไปแล้ว (2026-11-15)
- **schema** (migration `p3_reminders`): `ReminderRule` (ต่อระบบปู · `kind` · `defaultKey` = เรื่องเริ่มต้น unique ต่อระบบ · `priority` HIGH/MEDIUM/LOW · `repeat` EVERY_DAYS/WEEKDAYS/ONCE/FEEDING_PLAN · `nextDueAt` = รอบถัดไป (เช็คปู = "พักเตือนถึง") · `lastDoneAt`) · `Task` (`openKey` unique **มีค่าเฉพาะตอนงานเปิด** "rule:12"/"lot:5" ปิดแล้ว = null → กันงานซ้ำด้วย `createMany skipDuplicates` · `closedBy` USER/AUTO · `refId` = id ล็อต) · `User.emailHours` ("8,12,16,20") + `lastDigestAt`
- **โค้ด** `services/reminders/`: `schedule.ts` (pure — สำเนาอยู่ที่ FE `src/lib/schedule.ts` ต้องแก้คู่กัน) · `defaults.ts` (6 เรื่อง — ต้องตรงกับ FE `api/mock/reminders.ts`) · `task.service.ts` (sync/วันนี้/เสร็จ/ข้าม/ปฏิทิน/ประวัติ) · `rule.service.ts` · `digest.service.ts` · route `routes/reminders.ts` (+ `/scheduler/tick` ชั้น public ใช้ secret)
- **งานสร้างแบบขี้เกียจ** (`syncOwner`) ตอนเปิดหน้า/ตอน tick — หน้าเว็บถูกต้องโดยไม่พึ่ง cron (Passenger พัก process ได้) · cron ใช้แค่ส่งอีเมล · throttle 15 วิ/คน · ทุกคำขอที่แก้ข้อมูลฟาร์ม (non-GET หลัง `requireActiveSubscription`) เรียก `markDirty` ตอน response จบ → งานเช็คปู/ใส่ราคาล็อตปิดเองทันทีในคำขอถัดไป
- **กติกา**: กฎ 1 ข้อมีงานเปิดได้ทีละงาน (ไม่กองซ้อน) · รอบถัดไปนับจากวันที่ทำจริง · ข้าม = นับจากวันนี้ · ระบบใหม่: รอบแรกนับเหมือนเพิ่งทำวันสร้าง (กันงาน 4 เรื่องเด้งพร้อมกันพรุ่งนี้) · เปิดสวิตช์ใหม่ = นับจากตอนนี้ (ไม่ "เลยมา 26 วัน") · ปิดสวิตช์ = ลบงานค้างของเรื่องนั้น · เปลี่ยนความสำคัญ = งานที่เปิดอยู่เปลี่ยนตาม (ลดจากด่วน = ป๊อปอัปหยุดทันที) · เช็คปูกดเสร็จทั้งที่ยังมีปูถึงรอบ = พักเตือนเท่ารอบเช็ค · ใส่ราคาล็อตกดเสร็จเองไม่ได้
- **รอบเช็คปู** อ่านจากเรื่อง "เช็คเนื้อ/ไข่ปู" (`grid.checkEveryDays` · ปิดเรื่องนี้ = null = ไม่ขึ้น ⚠ บนกล่อง) แทนค่าคงที่ 21 วัน
- **อีเมลสรุป**: tick ทุก 15 นาที → คนที่ถึงชั่วโมงส่ง + ยังไม่ได้ส่งในชั่วโมงนี้ → จองชั่วโมงด้วย conditional `updateMany` แล้วค่อยส่ง (tick ซ้อน = ฉบับเดียว) · ไม่มีงานค้าง/ไม่มีอีเมล/หมดสิทธิ์ = ไม่ส่ง · ข้อความที่ผู้ใช้พิมพ์ต้องผ่าน `escapeHtml` · ปุ่ม "ส่งอีเมลทดสอบ" 1 ครั้ง/นาที · ลบ env `DIGEST_MIN_INTERVAL_MIN` ของ v1 ออกแล้ว
- ⚠ ใหม่: `tasks_due` (urgent เมื่อมีงานด่วนที่ถึงเวลา)
- บั๊กที่เจอจากการทดสอบแล้วแก้: ⚠️ **sync ซ้อนกัน** — `/attention` กับ `/reminders/today` มาพร้อมกัน ตัวหลังเห็น throttle แล้วข้ามไปอ่านงานก่อนตัวแรกสร้างเสร็จ (หน้าแรก "ไม่มีงานค้าง" แต่เมนูขึ้น ⚠) → คำขอที่มาระหว่าง sync ต้อง **รอ** promise ที่วิ่งอยู่ (`inflight`) ไม่ใช่ข้าม

### P2 ที่ทำไปแล้ว (2026-11-14)
- **schema** (migration `p2_farm_crabs` + `p2_crab_lot_cascade`): `CrabSystem` (layout BASKET/CONDO_SINGLE/CONDO_DOUBLE · rows × cols ต่อด้าน) · `CrabBox` (side FRONT/BACK · รหัส `A1` = แถว A ชั้นบนสุด, unique ต่อด้าน · `active=false` = ย่อผังออก) · `Contact` (SELLER/CUSTOMER) · `CrabLot` (`totalCost` null = ยังไม่ใส่ราคา) · `Crab` (lotId บังคับ · `code` ไม่ซ้ำต่อเจ้าของ ซ่อน · `name` ค่าเริ่มต้น = รหัสกล่อง (หน้า-หลัง = "หน้า A1") · type EGG/MEAT/SOFT · ค่า `last*` = สำเนาจากรอบเช็คล่าสุด) · `CrabCheck` (เช็ควันนี้ = แถวใหม่เสมอ · `aiPct` เก็บคู่ค่าที่ผู้ใช้ยืนยัน)
- **ข้อมูลฟาร์มแยกขาดต่อเจ้าของ แอดมินก็ไม่เห็น** (`lib/scope.ts` `assertOwned` → 404) — เปลี่ยนจาก v1 ที่แอดมินเห็นทุกฟาร์ม
- **ต้นทุนล็อต** (`services/farm/lot.service.ts` `allocateLotCost`): แบ่งตามน้ำหนัก**ตอนรับเข้า** (รอบเช็คแรก) ไม่ใช่น้ำหนักล่าสุด · ไม่มีน้ำหนักครบ = แบ่งเท่ากัน · เศษยกตัวสุดท้าย · ปูตาย/ขายยังนับ · ปูลบ (บันทึกผิด) ไม่นับ
  - ⚠️ อัปเดตทั้งล็อตด้วย **`UPDATE … CASE` คำสั่งเดียว** (ทีละตัว = ล็อต 100 ตัวยิง 100 คำสั่งทุกครั้งที่รับปูเพิ่ม บน DB remote ช้ามาก) + transaction ใช้ `TX_OPTS` (timeout 20 วิ)
  - ⚠️ `Crab.lot` เป็น `onDelete: Cascade` (ไม่ใช่ Restrict) — ไม่งั้นลบบัญชีผู้ใช้แล้ว cascade ชนกันพัง · การลบล็อตที่ยังมีปูกันไว้ที่ service แทน
- **กติกาการเช็ค** (บังคับทั้ง BE `crab.service` และ FE `lib/checkDraft.ts`): มีรูปต้องมี % (ปูนิ่มไม่ต้อง) · ต้องมีอย่างน้อย 1 อย่าง
- **AI % ไข่** ย้ายมา `services/farm/eggEstimate.service.ts` ใช้ `CrabCheck` · ใช้ได้เฉพาะปูไข่ของตัวเอง · ส่ง `referenceCount` (ฟาร์มใหม่ = 0 → หน้าเว็บบอกว่า AI ยังไม่รู้จักฟาร์ม) · ใช้ `fallbacks: "default"` · ⚠️ **ยังไม่มี `ANTHROPIC_API_KEY`** → ปิดเงียบ (`GET /egg-ai` = `enabled:false`) · demo เปิด AI จำลองให้ดู
- ⚠ ใหม่: `system_missing` · `first_lot_missing` · `lot_cost_missing` (มี `count`)
- **FE** (รายละเอียดใน CLAUDE.md ของหน้าเว็บ): หน้า `CrabsView` · ตัวเลือกระบบบนแถบบน · หน้าต่างสร้างระบบ · รับปูเข้า 3 ขั้น · ป๊อปอัปปู · ล็อตปู · เพิ่มปูลงกล่อง · ตัวดูรูปกลาง · ช่องน้ำหนักสลับ ขีด/กรัม · `SelectOrCreate` · demo มีฟาร์มตัวอย่าง (`api/mock/farm.ts` — **กติกาต้องตรงกับ backend แก้ที่หนึ่งต้องแก้อีกที่**)
- บั๊กที่เจอจากการทดสอบบนเบราว์เซอร์แล้วแก้: กด Esc ปิดตัวดูรูปแล้วป๊อปอัปปูข้างหลังปิดตาม (Dialog ของ PrimeVue ดัก Esc ที่ document → ตัวดูรูปต้องดักที่ capture phase ของ window) · กล่องข้อความ ⚠ ลอยทับปุ่มสลับด้านจนกดไม่ได้ (→ เปลี่ยนเป็นแทรกใต้ปุ่ม)

### P1 ที่ทำไปแล้ว (2026-11-08)
- **DB v2** = `familysi_farmland_v2` (user `familysi_piyawattyr5t`) + shadow `familysi_farmland_shadow` (user `familysi_piyawattyr6t`) — ⚠️ **ชื่อ user บน Plesk ต้องมี `familysi_` นำหน้า** (ไม่มี = รหัสผ่านผิด) · `.env` เก็บค่า v1 ไว้เป็นคอมเมนต์ `# v1:` · migration เดียว `20261108084022_init_v2`
- **schema P1:** `User` (role ADMIN|USER, `notifyEmail` แยกจากอีเมลล็อกอิน — ว่าง = ไม่ส่งเมล, `weightUnit` KHIT|GRAM, `uiPrefs`, `lastLoginAt`) · `OAuthAccount` (+FACEBOOK) · `RefreshToken` · `Plan` · `Subscription` · `PaymentSlip` · `AppSetting` (key `shop`)
- **สิทธิ์ใช้งาน** (`services/subscription.service.ts`): `computeAccess()` เป็น pure function ใช้ทั้งเช็คทีละคนและหน้ารายชื่อ · ต่ออายุซ้อน = เริ่มต่อจากวันหมดเดิม · ช่วงผ่อนผัน `graceDays` (ค่าเริ่มต้น 3) · cache 30 วิ ต่อคน + `invalidateAccess()` ทุกครั้งที่อนุมัติ/ให้/ยกเลิก/ระงับ · อนุมัติสลิปใช้ conditional `updateMany` (กดซ้ำ = 400)
- **ชั้น route** (`routes/index.ts`): public (health, auth, `/public/shop`) → `requireAuth` (billing, uploads, admin+`requireAdmin`) → `requireActiveSubscription` (**402** + `details.code=SUBSCRIPTION_REQUIRED`) → ของฟาร์มทั้งหมด · บัญชีถูกระงับ = 403 แม้ token ยังไม่หมด
- **โมดูล v1 ที่ลบออกจาก branch v2** (ดึงกลับทีละเฟสด้วย `git checkout v1-final -- <path>`): services ทั้งหมดยกเว้น auth/oauth · routes ทั้งหมดยกเว้น health/auth/uploads · `lib/{notify,realtime,reservations,scope}.ts` · `scripts/egg-eval.ts` · ที่ยังเก็บไว้เพราะไม่ผูก schema: `lib/{cron,feedingCycle,cloudinary,mailer}.ts`
- `GET /auth/providers` → หน้าเว็บโชว์เฉพาะปุ่มโซเชียลที่ตั้งค่าแล้ว (ตอนนี้ google + line)
- ⚠️ Facebook Login ต้องมีหน้า **นโยบายความเป็นส่วนตัว** + **การลบข้อมูล** → ทำไว้แล้วที่หน้าเว็บ `/privacy` `/data-deletion` (เนื้อหาเป็นร่าง ผู้ใช้ควรอ่านทวน)

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
- FE v2 (เจอจริงตอน P1): **Vue scoped `:global(.a) .b` จะถูกแทนเป็น `.a` เฉยๆ (ทิ้ง `.b`)** → ต้องเขียน `:global(.a .b)` ทั้งก้อน · TS ของ farmland-web เปิด `erasableSyntaxOnly` → ห้ามใช้ parameter property ใน constructor (`constructor(public x)`) · Vite dev ครั้งแรกอาจตอบ 504 "Outdated Optimize Dep" ระหว่างสร้าง cache — รีโหลดหายเอง ไม่เกิดใน build จริง
- **ถ่ายภาพหน้าจอเช็ค UI:** ในเครื่องไม่มี `chromium-cli` → ติดตั้ง `playwright-core` ใน scratchpad แล้ว `chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })` (ไม่ต้องโหลดเบราว์เซอร์) · demo รันด้วย `npx vite --mode demo --port 5174`

## Conventions
- `routes → validate(zod) → service → prisma` · ห่อ async route ด้วย `asyncHandler` · error = `{ error, details? }`
- เงิน `Decimal(12,2)` → แปลง `.toNumber()` ก่อนคำนวณ/ส่ง JSON (`lib/serialize.ts`)
- ข้อมูลของลูกค้าแต่ละคนแยกขาดด้วย owner (`lib/scope.ts`) · ADMIN เห็นทั้งหมด
- ข้อมูลเริ่มต้นของลูกค้า (อาหาร / ค่าน้ำ / แจ้งเตือน 6 เรื่อง) สร้างใน service ตอนสมัคร/สร้างระบบปู — seed มีแค่แพ็กเกจ + ตั้งค่าร้าน + แอดมิน
- คอมเมนต์ / ข้อความเป็นภาษาไทย · `API.md` ต้องอัปเดตทุกครั้งที่แก้ route (v2 จะเขียน API.md ใหม่ตอน P1)

## Log
- **2026-11-15** — **P4 เสร็จ** (รายละเอียดในหัวข้อ NEXT) · ขั้นแรกของเฟสทำหน้าทดสอบเสียงไทยเป็น artifact ให้ผู้ใช้เปิดบนมือถือ (ยังไม่ได้ผล) · ⚠️ **หยุด dev server ต้องหยุดตัว `tsx watch` ด้วย** ไม่ใช่แค่โปรเซสที่ฟังพอร์ต (watcher สตาร์ตใหม่เอง → ถือไฟล์ query engine ของ Prisma ไว้ → `prisma generate` ล้มด้วย EPERM) · ⚠️ ชื่อ type ซ้ำกับของเดิมได้ง่าย (`PlanInput` ของแพ็กเกจ) → ของอาหารใช้ `FeedPlanInput`
- **2026-11-15** — **P3 เสร็จ** (รายละเอียดในหัวข้อ NEXT) · ⚠️ เทสที่ขึ้นกับเวลา (เช่น "งานครบกำหนด 20:00 วันนี้ถึงเวลาหรือยัง") ต้องย้อนวันข้อมูลทดสอบ ไม่งั้นรันหลังเที่ยงคืนแล้วพัง · ⚠️ สโมคเทสที่เรียก `runDigests` จริงต้อง mock `transporter.sendMail` และคืนค่า `lastDigestAt` ของแอดมิน (user id 1 มี notifyEmail)
- **2026-11-14** — **P2 เสร็จ** (รายละเอียดในหัวข้อ NEXT) · ⚠️ เครื่องมือ: heredoc ขนาดใหญ่ใน Bash tool บนเครื่องนี้พังบ่อย (`unexpected EOF`) → เขียนไฟล์ด้วย Write/Edit แทน
- **2026-11-08** — **P1 เสร็จ** (รายละเอียดในหัวข้อ NEXT) · ผู้ใช้ตอบเพิ่ม: พร้อมเพย์ `0616366635`, ติดต่อทาง Facebook "pintusornsri james piyawat", LINE OA ยังไม่มี, **เก็บธีมเทศกาลไว้** (ย้าย `ThemeDecor.vue` มาแล้ว + เลือกได้จากเมนูโปรไฟล์)
- **2026-11-08** — เริ่ม v2: ผู้ใช้อนุมัติแผน `docs/v2-plan.md` · P0: commit งานค้างของ v1 ทั้ง 2 repo (frontend เดิมมีแค่ "first commit" งานที่เหลือไม่เคย commit เลย) + tag `v1-final` + branch `v2` · ย้าย CLAUDE.md เดิมไป `docs/v1-notes.md`
