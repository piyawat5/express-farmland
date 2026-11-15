# API v2 — express-farmland

> สัญญา API สำหรับหน้าเว็บ (`farmland-web` branch `v2`) · อัปเดตทุกครั้งที่แก้ route · API ของ v1 อยู่ที่ tag `v1-final`
> Base: `/api` · JSON · error = `{ error: string, details?: unknown }` · เงินเป็น number (บาท) · น้ำหนักเป็นกรัมเสมอ · วันที่เป็น ISO

## ชั้นสิทธิ์
| ชั้น | ต้องมี | ถ้าไม่ผ่าน |
|---|---|---|
| public | — | — |
| ล็อกอินแล้ว | `Authorization: Bearer <accessToken>` | 401 |
| มีสิทธิ์ใช้งาน | ล็อกอิน + แพ็กเกจที่ยังไม่หมด (แอดมินผ่านเสมอ) | **402** `details.code = "SUBSCRIPTION_REQUIRED"` → หน้าเว็บพาไปหน้า "รอเปิดใช้งาน" · บัญชีถูกระงับ = 403 |
| แอดมิน | ล็อกอิน + `role = ADMIN` | 403 |

## Access (สิทธิ์ใช้งาน) — ฝังอยู่ใน `/auth/me` และ `/billing/me`
```ts
{
  active: boolean,                 // ใช้ระบบตัวจริงได้ไหม
  reason: 'ADMIN'|'ACTIVE'|'GRACE'|'NONE'|'EXPIRED'|'SUSPENDED',
  lifetime: boolean,               // ซื้อขาด
  planName: string|null,
  expiresAt: string|null,          // วันหมดอายุจริง
  graceUntil: string|null,         // ใช้ต่อได้ถึง (หมดอายุ + ช่วงผ่อนผัน)
  daysLeft: number|null,           // ติดลบ = เลยวันหมดอายุแล้ว (อยู่ในช่วงผ่อนผัน)
  pendingSlips: number
}
```
`GRACE` = หมดอายุแล้วแต่ยังอยู่ในช่วงผ่อนผัน (`graceDays` ในตั้งค่าร้าน ค่าเริ่มต้น 3 วัน) — ยังใช้ได้ แต่ควรโชว์แถบเตือนให้ต่ออายุ

## public
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/health` · `/health/db` | |
| GET | `/public/shop` | เหมือน `/billing/shop` แต่ไม่ต้องล็อกอิน (ช่องทางติดต่อบนหน้านโยบาย/ลบข้อมูล) |
| POST | `/auth/register` | `{ email, password(≥8), name? }` → `{ accessToken, refreshToken, user }` |
| POST | `/auth/login` | `{ email, password }` → เหมือนข้างบน · บัญชีถูกระงับ = 403 |
| POST | `/auth/refresh` | `{ refreshToken }` → ชุดใหม่ (ตัวเดิมใช้ซ้ำไม่ได้) |
| POST | `/auth/logout` | `{ refreshToken? }` → 204 |
| GET | `/auth/providers` | `{ providers: ('facebook'\|'google'\|'line')[] }` — ปุ่มโซเชียลที่ตั้งค่าแล้ว (โชว์เฉพาะตัวที่ใช้ได้) |
| GET | `/auth/oauth/:provider/start` | provider = `google` · `line` · `facebook` → redirect ไปหน้า consent |
| GET | `/auth/oauth/:provider/callback` | redirect กลับ `FRONTEND_URL/oauth/callback#accessToken=..&refreshToken=..` หรือ `#error=..` |
| GET/POST | `/scheduler/tick` | ใช้ secret แทนการล็อกอิน: header `x-scheduler-secret` หรือ `?secret=` (ผิด = 401) → `{ now, checked, sent, failed }` · Plesk Scheduled Task เรียก**ทุก 15 นาที** · ส่งอีเมลสรุปงานค้างให้คนที่ถึงชั่วโมงส่ง (ชั่วโมงละไม่เกิน 1 ฉบับ/คน · ไม่มีงานค้าง/ไม่มีอีเมล/หมดสิทธิ์ = ไม่ส่ง) |

redirect URI ที่ต้องลงทะเบียนในแต่ละ console: `<OAUTH_CALLBACK_BASE>/<provider>/callback` (dev: `http://localhost:3000/api/auth/oauth/<provider>/callback`)

## ล็อกอินแล้ว
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/auth/me` | โปรไฟล์ + `providers[]` + `access` (ดูด้านบน) · `emailIsPlaceholder` = อีเมลเทียมของ LINE/Facebook · `emailHours: number[]` (ชั่วโมงส่งอีเมลสรุป) |
| PATCH | `/auth/me` | `{ name?, notifyEmail?, weightUnit? 'KHIT'\|'GRAM', emailHours?: number[](0–23) }` · `notifyEmail: ''` หรือ `null` = ไม่ส่งอีเมล · `emailHours: []` = ไม่ส่งตามเวลา |
| PATCH | `/auth/me/prefs` | object ใดๆ → merge ลง `uiPrefs` (ธีม/เสียง/หน้าแรก/ทัวร์) → คืน prefs ทั้งก้อน |
| POST | `/auth/me/password` | `{ currentPassword?, newPassword }` (บัญชี OAuth ตั้งครั้งแรกไม่ต้องใส่รหัสเดิม) → 204 |
| GET | `/billing/shop` | `{ shopName, promptPayId, promptPayName, phone, facebookName, facebookUrl, lineOaUrl, graceDays }` |
| GET | `/billing/plans` | แพ็กเกจที่เปิดขาย `[{ id, code, name, description, priceTHB, durationDays(null=ซื้อขาด) }]` |
| GET | `/billing/me` | `{ access, slips[], subscriptions[] }` |
| POST | `/billing/slips` | `{ planId, imageUrl, imagePublicId?, amount?, note? }` → 201 · มีสลิปรอตรวจได้ไม่เกิน 3 ใบ |
| POST | `/uploads/image?kind=slip\|crab\|bug` | multipart field `image` (≤8MB) → `{ url, publicId }` · ไม่ได้ตั้ง Cloudinary = 503 |

## มีสิทธิ์ใช้งาน
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/attention` | `{ items: [{ key, level 'setup'\|'warn'\|'urgent', menu, target, title, cta }] }` — ป้าย ⚠ นำทาง · `target` = ค่า `data-attention` ของปุ่มเป้าหมาย |

key ที่มีตอนนี้: `system_missing` (menu `crabs`, target `crabs-add-system`) · `first_lot_missing` (`crabs`, `crabs-intake`) · `lot_cost_missing` (`crabs`, `crabs-lots`, มี `count`) · `notify_email_missing` (`profile`, `profile-notify-email`) · `tasks_due` (`reminders`, `reminders-today`, มี `count` = งานที่ถึงเวลาแล้ว · `level: 'urgent'` เมื่อมีงานด่วนมาก)

## แอดมิน (`/admin`)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/admin/overview` | `{ totalUsers, newUsers(7 วัน), activeCustomers, expiringSoon(≤7 วัน), waiting(ยังไม่เคยมีสิทธิ์), pendingSlips }` |
| GET | `/admin/users?q&access=active\|none\|expired\|pending&skip&take` | `{ total, items: [user + access + oauthAccounts] }` |
| GET | `/admin/users/:id` | `{ user, access, subscriptions[], slips[] }` |
| PATCH | `/admin/users/:id` | `{ active?, role?, name? }` · ระงับ = เตะออกทุกเครื่อง · ระงับ/ลดสิทธิ์ตัวเองไม่ได้ |
| POST | `/admin/users/:id/subscriptions` | `{ planId? \| days? \| lifetime?, source 'MANUAL'\|'TRIAL', note? }` · ยังมีสิทธิ์อยู่ = นับต่อจากวันหมดเดิม |
| POST | `/admin/subscriptions/:id/revoke` | ยกเลิกสิทธิ์แถวนั้น (มีผลทันที) |
| GET | `/admin/slips?status&skip&take` | `{ items, total }` · รอตรวจเรียงเก่าสุดก่อน |
| POST | `/admin/slips/:id/approve` | `{ note? }` → สิทธิ์ที่ได้ · อนุมัติซ้ำ = 400 · ส่งอีเมลบอกลูกค้า (ถ้ามีอีเมลจริง) |
| POST | `/admin/slips/:id/reject` | `{ reason }` (บังคับ — ลูกค้าเห็น) |
| GET/POST | `/admin/plans` | `{ code, name, description?, priceTHB, durationDays?(null=ซื้อขาด), active?, sortOrder? }` |
| PATCH/DELETE | `/admin/plans/:id` | ลบได้เฉพาะแพ็กเกจที่ยังไม่มีคนใช้ (ที่ใช้แล้วให้ `active:false`) |
| GET/PUT | `/admin/settings` | ตั้งค่าร้าน · `promptPayId` = เบอร์ 10 หลัก หรือเลขบัตร 13 หลัก · ลิงก์ใส่ `''` = ลบ |

## ฟาร์ม (P2) — ต้องมีสิทธิ์ใช้งาน · เห็นได้เฉพาะของตัวเอง (ของคนอื่น = 404)

### ระบบปู
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/systems` | `[{ id, name, layout, rows, cols, sortOrder, aliveCrabs }]` |
| POST | `/systems` | `{ name, layout 'BASKET'\|'CONDO_SINGLE'\|'CONDO_DOUBLE', rows(1–30), cols(1–60) }` → สร้างกล่องให้ครบ (หน้า-หลัง = 2 ด้าน) รหัส `A1` (A = ชั้นบนสุด) |
| PATCH | `/systems/:id` | `{ name?, rows?, cols? }` · ย่อผังได้เฉพาะเมื่อกล่องที่หายไม่มีปู (400 บอกรหัสกล่อง) |
| DELETE | `/systems/:id` | ได้เฉพาะระบบที่ไม่เคยมีปู |
| GET | `/systems/:id/grid` | `{ system, checkEveryDays(รอบเช็คปูจากแจ้งเตือน · null = ปิดเรื่องนี้ ไม่ขึ้น ⚠), boxes:[{id,side,row,col,code}], crabs:[{id,boxId,name,type,sex,grade,cableTieColor,lastWeightG,lastPct,lastPhotoUrl,lastCheckedAt, lot:{id,receivedAt,costMissing}}] }` — ปูที่ยังเลี้ยงอยู่เท่านั้น |

### คู่ค้า / ล็อต
| Method | Path | หมายเหตุ |
|---|---|---|
| GET/POST | `/contacts` | `?type=SELLER\|CUSTOMER` · POST `{ type, name, phone?, note? }` |
| PATCH | `/contacts/:id` | `{ name?, phone?, note? }` |
| GET | `/lots?systemId&costMissing=true` | ล่าสุดก่อน + `crabCount/aliveCount/soldCount/deadCount` |
| POST | `/lots` | `{ systemId, sellerId?, receivedAt?, totalCost?(null = ใส่ทีหลัง), note? }` |
| GET | `/lots/:id` | + `crabs[]` (มี `allocatedCost`) |
| PATCH | `/lots/:id` | เปลี่ยน `totalCost` → แบ่งต้นทุนให้ทุกตัวตามน้ำหนักตอนรับเข้า (ไม่มีน้ำหนักครบ = แบ่งเท่ากัน · เศษยกให้ตัวสุดท้าย) |
| DELETE | `/lots/:id` | ได้เฉพาะล็อตที่ไม่มีปูแล้ว |

### ปู + การเช็ค
| Method | Path | หมายเหตุ |
|---|---|---|
| POST | `/crabs` | `{ boxId, lotId \| newLot:{sellerId?,receivedAt?,totalCost?}, type 'EGG'\|'MEAT'\|'SOFT', name?(ค่าเริ่มต้น = รหัสกล่อง), sex?, grade?, cableTieColor?, note?, check?: CheckInput }` |
| GET | `/crabs/:id` | รายละเอียด + `checks[]` (ใหม่สุดก่อน) + `lot` + `box` + `system` |
| PATCH | `/crabs/:id` | `{ name?, type?, sex?, grade?, cableTieColor?, note?, boxId?(ย้ายกล่อง), lotId?(ย้ายล็อต) }` |
| POST | `/crabs/:id/dead` | `{ dead: boolean, diedAt? }` — ปูตาย / กดผิดเอากลับ |
| DELETE | `/crabs/:id` | ลบเพราะบันทึกผิด (ซ่อน) + แบ่งต้นทุนล็อตใหม่ |
| POST | `/crabs/:id/checks` | **"เช็ควันนี้"** = เพิ่มรอบใหม่เสมอ · body = CheckInput |
| PATCH | `/crab-checks/:id` | **"แก้รอบนี้"** (ส่งเฉพาะช่องที่แก้) |
| DELETE | `/crab-checks/:id` | → คืนรายละเอียดปู (ค่าล่าสุดคำนวณใหม่) |

`CheckInput = { checkedAt?(ค่าเริ่มต้น = ตอนนี้), weightG?, pct?(0–100), aiPct?, photoUrl?, photoPublicId?, note? }`
กติกา: ต้องมีอย่างน้อย 1 อย่าง · **มีรูปแล้วต้องมี `pct`** (ยกเว้นปูนิ่ม) → 400 "มีรูปใหม่แล้ว ใส่ % ไข่ด้วย"
ค่า `last*` บนตัวปู = จากการเช็คล่าสุดที่มีค่านั้น · น้ำหนักทุกช่องเป็น **กรัม**

### AI ประเมิน % ไข่
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/egg-ai` | `{ enabled }` — ไม่มี `ANTHROPIC_API_KEY`/Cloudinary = `false` (หน้าเว็บซ่อนปุ่ม) |
| POST | `/egg-ai/estimate` | `{ imageUrl(ต้องเป็นรูปบน Cloudinary ของเรา), crabId?(ปูไข่ของเราเท่านั้น) }` → `{ usable, pct, confidence, reason, referenceCount, previousPct, model }` · 503 = ปิดอยู่ · 502 = key ผิด/AI มีปัญหา (โชว์ข้อความ) · จำกัด 60 ครั้ง/10 นาที |

## แจ้งเตือน (P3) — `/reminders` · ต้องมีสิทธิ์ใช้งาน · ของคนอื่น = 404

กฎ (ReminderRule) = ทำอะไร ทุกเมื่อไร สำคัญแค่ไหน · งาน (Task) = 1 รอบที่ต้องทำ · **กฎ 1 ข้อมีงานเปิดได้ทีละ 1 งาน** (ไม่ทำก็แค่ "เลยมา N วัน" ไม่กองซ้อน) · **รอบถัดไปนับจากวันที่ทำจริง**
สร้างระบบปู = ได้แจ้งเตือนเริ่มต้น 6 เรื่อง (`locked`: แก้ชื่อ/ลบไม่ได้) — วัดค่าน้ำ ทุก 4 วัน ด่วนมาก · ให้อาหารปู ตามแผนให้อาหาร (P4) ด่วนมาก · เช็คเนื้อ/ไข่ปู ทุก 21 วัน ทั่วไป · ใส่จุลินทรีย์ ทุก 4 วัน ปานกลาง · เติมน้ำจืด ทุก 3 วัน ด่วนมาก · เปลี่ยนใยกรองละเอียด ทุก 5 วัน ทั่วไป (รอบแรกนับเหมือนเพิ่งทำวันที่สร้างระบบ)
งานสร้างให้เองตอนเปิดหน้า (ไม่ต้องรอ cron): ตามเวลา = ขึ้นตั้งแต่ต้นวันที่ครบกำหนด · เช็คปู = มีปูถึงรอบ (ปิดเองเมื่อเช็คครบ) · ใส่ราคาล็อต = ล็อตที่มีปูแต่ยังไม่มีราคา (ปิดเองเมื่อใส่ราคา กดเสร็จเองไม่ได้)

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/reminders/today` | `{ now, tasks: Task[], upcoming: [{ ruleId, kind, title, icon, priority, dueAt, systemId, systemName }] }` — งานที่เปิดอยู่ทุกระบบ (ด่วนก่อน) + รอบที่จะมาภายใน 3 วัน |
| GET | `/reminders/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&systemId?` | `{ tasks: Task[], planned: [{ ruleId, kind, title, icon, priority, dueAt, systemId }] }` · งานที่ครบกำหนดหรือทำเสร็จในช่วงนั้น + รอบอนาคต "ตามแผน" · ช่วงไม่เกิน 2 เดือน (เกิน = 400) |
| POST | `/reminders/tasks/:id/done` | `{ doneAt?(ISO, ทำย้อนหลังได้ ≤60 วัน · อนาคต = ตอนนี้) }` → 204 · ปิดแล้ว = 400 · งานใส่ราคาล็อต = 400 |
| POST | `/reminders/tasks/:id/skip` | → 204 · รอบถัดไปนับจากวันนี้ |
| GET | `/reminders/rules?systemId` | `Rule[]` — ค่าเริ่มต้นเรียงตามลำดับข้างบน แล้วตามด้วยเรื่องที่เพิ่มเอง |
| POST | `/reminders/rules` | `{ systemId, title, icon?, priority, repeat 'EVERY_DAYS'\|'WEEKDAYS'\|'ONCE', everyDays?(1–365), weekdays?(0=อาทิตย์), timeOfDay?('HH:mm' ค่าเริ่มต้น 08:00), active?, startDate?('YYYY-MM-DD' · ONCE บังคับ) }` → 201 · สูงสุด 30 เรื่อง/ระบบ |
| PATCH | `/reminders/rules/:id` | ช่องเดียวกัน (ส่งเฉพาะที่แก้) · ส่งช่องรอบ/เวลา = คิดรอบใหม่ (จาก `lastDoneAt` ถ้าเคยทำ ไม่งั้นจากตอนนี้ · งานที่เลยกำหนดแล้วคงไว้) · `active:false` = ลบงานค้างของเรื่องนั้น · เปลี่ยน `priority` = งานที่เปิดอยู่เปลี่ยนตาม · 🔒 แก้ชื่อไม่ได้ · ให้อาหารแก้รอบไม่ได้ · เช็คปูแก้ได้แค่ `everyDays` |
| DELETE | `/reminders/rules/:id` | เฉพาะเรื่องที่เพิ่มเอง (ค่าเริ่มต้น = 400) · งานของเรื่องนั้นลบตาม |
| GET | `/reminders/rules/:id/history` | 30 รอบล่าสุด `[{ id, status 'DONE'\|'SKIPPED', dueAt, doneAt, closedBy 'USER'\|'AUTO', lateDays }]` |
| POST | `/reminders/rules/:id/done` | ทำก่อนกำหนด (จาก "เร็วๆ นี้") → 204 |
| POST | `/reminders/test-email` | ส่งสรุปงานค้างไปที่ `notifyEmail` ทันที (ไม่มีงานก็ส่ง) → `{ sentTo, tasks }` · ไม่มีอีเมล = 400 · ยังไม่ตั้ง SMTP = 503 · กดซ้ำภายใน 1 นาที = 429 · ส่งไม่ผ่าน = 502 |

```
Task = { id, kind, title, icon, priority 'HIGH'|'MEDIUM'|'LOW', dueAt, status 'OPEN'|'DONE'|'SKIPPED', doneAt, closedBy,
         systemId, systemName, ruleId, refId(id ล็อตของงานใส่ราคา), isDue(ถึงเวลาแล้ว), overdueDays(0 = วันนี้),
         canComplete(กดเสร็จเองได้), count(เช็คปู: จำนวนปูที่ถึงรอบ) }
kind = WATER_TEST | FEEDING | CRAB_CHECK | MICROBES | FRESHWATER | FILTER | CUSTOM | LOT_COST | FEED_LOW
Rule = { id, systemId, kind, defaultKey, locked, title, icon, priority, repeat(+'FEEDING_PLAN'), everyDays, weekdays: number[],
         timeOfDay, active, nextDueAt(รอบถัดไป · เช็คปู = พักเตือนถึง), lastDoneAt, createdAt }
```

## อาหารปู (P4) — `/feed` · ต้องมีสิทธิ์ใช้งาน · ของคนอื่น = 404

สต็อก (ต่อเจ้าของ ใช้ร่วมทุกระบบ) · แผน (ต่อระบบ) · รอบให้อาหาร (1 ระบบเปิดได้ทีละรอบ) · ผลการกินรายตัว
อาหารเริ่มต้น "ปลา 🐟" / "หอย 🐚" หน่วยชิ้น (สร้างให้ตอนใช้ครั้งแรก) · **ไม่บังคับใส่สต็อก**: ยังไม่เคยซื้อ/นับ (`stockSet=false`) = ไม่ตัดสต็อก ไม่เตือนใกล้หมด

**ชีวิตของรอบ:** เปิดเองเมื่อถึงเวลาให้อาหาร (หรือกด "เริ่ม") — ทุกตัวได้แถวผลการกินเป็น `ATE` ตั้งแต่เปิด → `fed` (แจ้งเตือน "ให้อาหารปู" ปิดเอง) → แตะเฉพาะตัวที่ไม่กิน/กินน้อย → `close` (ตัดสต็อกจากแถวรายตัว)
**ลืมปิด:** ถึงเวลารอบใหม่แล้วรอบเก่ายังเปิด → ปิดให้เอง (`autoClosed`, `reviewPending`) แล้วถามยืนยัน: `ok` / แก้ย้อนหลัง (PATCH entries) / `not_fed` (รอบเป็น SKIPPED คืนสต็อก ลบผลการกิน)
ไม่ได้เปิดแอปหลายวัน = เปิดเฉพาะรอบล่าสุด ไม่สร้างรอบย้อนหลัง · ไม่สร้างรอบของเวลาก่อนมีแผน

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/feed/items` | `[{ id, name, emoji, unit, qty, stockSet, active, sortOrder, forecast: { used, rounds(พออีกกี่รอบ), runsOutOn('YYYY-MM-DD' \| null = พอเกิน 30 วัน), perRound, low(< 2 รอบ) } }]` |
| POST | `/feed/items` | `{ name, emoji?, unit?('ชิ้น') }` → `{ id }` · ชื่อซ้ำ = 400 (ที่เคยลบ = เอากลับมา) |
| PATCH | `/feed/items/:id` | `{ name?, emoji?, unit?, active? }` · ลบ (`active:false`) อาหารที่อยู่ในแผน = 400 |
| POST | `/feed/items/:id/buy` | `{ qty>0, priceTHB?, note? }` → 204 · ครั้งแรก = เริ่มนับสต็อกจากตรงนี้ |
| POST | `/feed/items/:id/count` | `{ qty≥0 }` นับใหม่ (มีจริงเท่านี้) → 204 · เก็บส่วนต่างเป็น ADJUST |
| GET | `/feed/items/:id/moves` | 40 รายการล่าสุด `[{ kind 'BUY'\|'USE'\|'ADJUST', qty(±), priceTHB, note, at, round: { feedDate, systemName } \| null }]` |
| GET | `/feed/plan?systemId` | `{ plan \| null, crabs, preview: 14 วัน [{ date, feed, skip, itemId, override, dueAt, need }] }` |
| PUT | `/feed/plan` | `{ systemId, onDays(1–14), offDays(0–14 · 0=ทุกวัน), anchorDate?('YYYY-MM-DD' ไม่ส่ง = วันนี้), timeOfDay, pattern 'SINGLE'\|'ALTERNATE', itemId, altItemId?(ALTERNATE บังคับ ต่างจาก itemId), piecesPerCrab(0–20), active? }` → เหมือน GET |
| PUT | `/feed/plan/day` | `{ systemId, date, skip, itemId \| null }` ปรับวันเดียว · ทั้งคู่ว่าง = กลับไปตามแผน · `skip` วันที่มีรอบเปิดแต่ยังไม่ให้ = รอบนั้นเป็น SKIPPED |
| GET | `/feed/current?systemId` | (เรียก sync ก่อน) `{ plan, items, round: { id, feedDate, dueAt, fedAt, entries:[{crabId,boxId,itemId,pieces,result}] } \| null, next: { date, dueAt, itemId, pieces, crabs, need } \| null, shortages:[{itemId,need,have}], review:[{id,feedDate,dueAt,fedAt,total,little,none}], last: { roundId, feedDate, results:[{crabId,result}](เฉพาะไม่กิน/กินน้อย) } \| null }` |
| GET | `/feed/rounds?systemId&take(≤60)` | ล่าสุดก่อน `[{ id, feedDate, dueAt, status, fedAt, closedAt, autoClosed, reviewPending, total, little, none, food:[{itemId,qty}] }]` |
| GET | `/feed/rounds/:id` | รอบ + `entries[{ crabId, boxId, itemId, pieces, result, crabName, boxCode, side }]` เรียงด้าน/แถว/ช่อง |
| POST | `/feed/rounds/start` | `{ systemId }` → 201 `{ id }` รอบของวันนี้ (ก่อนเวลา/นอกแผนได้) · วันนี้ปิดไปแล้ว = 400 · รอบเก่าที่ยังเปิด = ปิดให้ (autoClosed) |
| POST | `/feed/rounds/:id/fed` | "ให้อาหารแล้ว" → 204 |
| POST | `/feed/rounds/:id/close` | "เสร็จแล้ว" → 204 ตัดสต็อก · ปิดซ้ำ = 400 |
| POST | `/feed/rounds/:id/review` | `{ action: 'ok' \| 'not_fed' }` → 204 |
| PATCH | `/feed/rounds/:id/entries` | **อย่างใดอย่างหนึ่ง** `{ crabIds[], result? , itemId?, pieces? }` (ปูที่ยังไม่มีแถว = สร้างให้) หรือ `{ fromItemId, itemId }` (ของไม่พอ → เปลี่ยนทั้งรอบ) → 204 · รอบที่ปิดแล้วแก้ได้ ≤ 30 วัน (สต็อกคำนวณใหม่ + ล้าง reviewPending) |

`EatResult = 'ATE' | 'LITTLE' | 'NONE'` · งานแจ้งเตือนที่ผูกกับอาหาร: `FEEDING` (มีเมื่อรอบเปิดแต่ยังไม่ `fed` · กด "เสร็จแล้ว" ที่งาน = `fed` ให้) · `FEED_LOW` (พอไม่ถึง 2 รอบ · ปิดเองเมื่อซื้อ/นับใหม่ · กดเสร็จเองไม่ได้)
⚠ ใหม่: `feeding_plan_missing` (menu `feed`, target `feed-plan`) · `feed_stock_missing` (`feed`, `feed-stock`) · `feed_low` (`feed`, `feed-stock`, count) · `feeding_review` (`crabs`, `crabs-feed-review`, count)

## น้ำ (P5) — `/water` · ต้องมีสิทธิ์ใช้งาน · ของคนอื่น = 404

ค่าที่วัด + เกณฑ์ (ต่อระบบ · ค่าเริ่มต้น 8 ค่า `PH ALK MG CA SAL NH3 NO2 K` สร้างตอนสร้างระบบ ยังไม่มีเกณฑ์) · กฎปรุงน้ำ (ต่อค่า: `LOW`/`HIGH` อย่างละ 1) · สาร (ต่อเจ้าของ แค่ชื่อ · เริ่มต้น 5 อย่าง) · ผลวัด (วัดไม่ครบก็ได้)
**คำแนะนำ** คิดจาก "ค่าล่าสุดที่รู้" ของแต่ละค่า (ผลวัดครั้งล่าสุดไม่ได้วัด = ใช้ค่าเดิม `stale`) · กฎ `DOSE`: จำนวน = ระยะถึงเป้า ÷ (`effect` ÷ `amount`) — ต่ำ → ดันถึงสูงสุด · สูง → ลดถึงต่ำสุด · ไม่มี `effect` = ใส่เท่า `amount` · ปัด ≥10 = จำนวนเต็ม / น้อยกว่า = ทีละครึ่ง

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/water?systemId` | `WaterState = { params:[{ id, key, name, unit, color, min, max, active, sortOrder, rules:[{ when, action, substanceId, amount, doseUnit, effect, note }] }], substances:[{id,name}], lastTest:{id,testedAt} \| null, latest:[{ paramId, value, testedAt, testId, stale, status 'LOW'\|'HIGH'\|'OK'\|'NA' }], advice:[{ paramId, testId, when, action 'DOSE'\|'WARN'\|'RETEST'\|null(ยังไม่ตั้งกฎ), substanceId, substanceName, amount, unit, note, label, done:{id,label,at} \| null }] }` |
| GET | `/water/summary?systemId` | แถบหน้ากล่องปู `{ params(จำนวนที่วัด), missingTargets, testedAt \| null, off:[{paramId,key,name,status}], pending(ข้อที่ยังไม่ทำ · ไม่นับวัดซ้ำ) }` |
| GET | `/water/tests?systemId&take(≤60, 20)&before(ISO)` | ใหม่ก่อน `[{ id, testedAt, note, readings:[{paramId,value}], actions:[{id,paramId,label,at}] }]` |
| POST | `/water/tests` | `{ systemId, testedAt?(ISO ไม่ส่ง = ตอนนี้ · อนาคต/เกิน 1 ปี = 400), note?, values:[{paramId,value}] ≥1 }` → 201 `WaterState & { testId }` · **งาน "วัดค่าน้ำ" ของระบบปิดเอง** (AUTO · รอบถัดไปนับจากเวลาที่วัด · ย้อนหลังเก่ากว่าครั้งล่าสุด = ไม่แตะ) · มีคำแนะนำ `RETEST` = แจ้งเตือนรอบถัดไปเป็นพรุ่งนี้ |
| PATCH | `/water/tests/:id` | `{ testedAt?, note?, values?:[{paramId, value \| null(ลบค่านั้น)}] }` → 204 · ไม่เหลือค่าเลย = 400 |
| DELETE | `/water/tests/:id` | 204 |
| POST | `/water/params` | `{ systemId, name, unit?, color '#rrggbb', min?, max? }` → 201 `{ id }` · ชื่อซ้ำ = 400 (ที่ซ่อนไว้ = เอากลับมา) |
| PATCH | `/water/params/:id` | `{ name?, unit?, color?, min?, max?, active? }` → 204 · `active:false` = ไม่ได้วัดค่านี้ (ซ่อน · ประวัติยังอยู่) · min > max = 400 |
| PUT | `/water/params/targets` | ตั้งทีเดียวทุกค่า `{ systemId, items:[{ id, min, max, unit?, active }] }` → `WaterState` |
| PUT | `/water/params/:id/rules/:when` | `when = LOW \| HIGH` · `{ action, substanceId? \| substanceName?(สารใหม่), amount?, doseUnit?, effect?, note? }` → 204 · `DOSE` ต้องมีสาร + amount + doseUnit |
| DELETE | `/water/params/:id/rules/:when` | 204 |
| POST | `/water/substances` | `{ name }` → 201 `{ id }` (มีอยู่แล้ว/เคยลบ = ตัวเดิม) · PATCH `/water/substances/:id` `{ name?, active? }` |
| POST | `/water/actions` | "ใส่แล้ว ✓" `{ testId, paramId, amount?(ใส่จริง) }` → 204 · เก็บ `label` ไว้ (เช่น "ใส่แมกนีเซียม 4 ช้อนแกง") · ไม่ได้หลุดแล้ว/กดซ้ำ = 400 · ไม่มีกฎ = "รับทราบแล้ว" |
| DELETE | `/water/actions/:id` | ยกเลิก → 204 |

⚠ ใหม่: `water_targets_missing` (menu `water`, target `water-targets`, count = ค่าที่วัดแต่ยังไม่มีเกณฑ์) · `water_action` (`water`, `water-advice`, count = คำแนะนำที่ยังไม่ได้ทำ)

## Realtime (WebSocket) — `ws(s)://<api-host>/ws`
ต่อด้วย subprotocol `['jwt', <accessToken>]` (ผิด/หมดอายุ = ปิดด้วย 4401 → refresh แล้วต่อใหม่) · server ส่ง `{ t:'hello' }`
client ส่ง `{ t:'subscribe', systemId }` (ระบบของตัวเองเท่านั้น — ไม่ใช่ = `{ t:'error' }`) / `{ t:'unsubscribe', systemId }` / `{ t:'ping' }`
server "เคาะ" `{ t:'feeding.changed', systemId }` ทุกครั้งที่รอบ/ผลการกินเปลี่ยน → client ไป `GET /feed/current` ใหม่ (ไม่มี payload — หลุดก็ไม่เพี้ยน)
`GET /health` → `realtime: { enabled, path }` · ปิดด้วย `REALTIME_ENABLED=false` (หน้าเว็บถอยไป polling 20 วิ)
