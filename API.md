# API Reference — express-farmland

> **สัญญา API (contract) สำหรับ frontend (Vue.js)** — แหล่งความจริงเดียวของทุก endpoint
> อัปเดตทุกครั้งที่เพิ่ม/แก้ route หรือเปลี่ยน request/response shape
> รายละเอียด business logic ดูใน [CLAUDE.md](./CLAUDE.md)

## พื้นฐาน
- **Base URL (dev):** `http://localhost:3000` → ทุก API path ขึ้นต้นด้วย `/api`
- **PORT:** env `PORT` (default `3000`)
- **CORS:** เปิดทุก origin (`cors()` แบบ default) — frontend dev เรียกได้เลย
- **Content-Type:** `application/json` (body limit 1mb)
- **เงิน/Decimal:** backend คืนเป็น **number** เสมอ (แปลง `Prisma.Decimal` ให้แล้ว) — frontend ไม่ต้อง parse
- **วันที่:** คืนเป็น ISO string (เช่น `"2026-06-14T13:00:00.000Z"`); ส่งเข้าได้ทั้ง ISO string / date
- **ต้อง login (ข้อ 1):** ทุก endpoint ใต้ `/api` (ยกเว้น `/api/health*`, `/api/auth/*`, `/api/scheduler/tick`) ต้องแนบ header `Authorization: Bearer <accessToken>` — ไม่มี/หมดอายุ → `401`
- **สิทธิ์ (RBAC):** อ่าน (GET) ได้ทุก user ที่ login; **แก้ไข** (POST/PATCH/PUT/DELETE) ระบบปู/กล่อง/ปู/น้ำ/ปรุงน้ำ ได้เฉพาะ **admin** หรือ **เจ้าของระบบ** (`CrabSystem.ownerId === user.id`) ไม่งั้น `403`

### Auth — `/api/auth` (ไม่ต้อง login ยกเว้น `/me`)
| Method | Path | Body | คืน |
|---|---|---|---|
| POST | `/api/auth/register` | `{ email*, password*(≥8), name? }` | `{ accessToken, refreshToken, user }` (role=FARM_OWNER) |
| POST | `/api/auth/login` | `{ email*, password* }` | `{ accessToken, refreshToken, user }` |
| POST | `/api/auth/refresh` | `{ refreshToken* }` | `{ accessToken, refreshToken, user }` (rotate — token เดิมใช้ไม่ได้อีก) |
| POST | `/api/auth/logout` | `{ refreshToken? }` | `204` (revoke refresh token) |
| GET | `/api/auth/me` | — (ต้องมี Bearer) | `{ id, email, name, role }` |

- `user` = `{ id, email, name, role:("ADMIN"\|"FARM_OWNER") }`
- access token อายุ `ACCESS_TOKEN_TTL` (default 15m), refresh `REFRESH_TOKEN_TTL` (default 30d)
- frontend เก็บ token ใน localStorage + axios interceptor refresh อัตโนมัติเมื่อ 401 (ดู `lib/api.ts`)

### OAuth — Google / LINE (ข้อ 1.2.3) — เปิดในเบราว์เซอร์ (redirect, ไม่ใช่ AJAX)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/auth/oauth/:provider/start` | `provider` = `google` \| `line` → 302 เด้งไปหน้า consent ของ provider |
| GET | `/api/auth/oauth/:provider/callback` | provider เด้งกลับมา → แลก token → 302 ไป `FRONTEND_URL/oauth/callback#accessToken=..&refreshToken=..` (error → `#error=..`) |

- frontend แค่ `window.location = <apiBase>/auth/oauth/<provider>/start` แล้วรับ token ที่หน้า `/oauth/callback` (อ่านจาก URL hash)
- **redirect URI ที่ต้องลงทะเบียนใน console:** `http://localhost:3000/api/auth/oauth/{google|line}/callback` (เปลี่ยน base ได้ด้วย env `OAUTH_CALLBACK_BASE`)
- env: `GOOGLE_CLIENT_ID/SECRET`, `LINE_CHANNEL_ID/SECRET`; LINE ต้องขอสิทธิ์ Email permission ถึงจะได้ email (ไม่งั้นผูกด้วย email เทียม `line_<sub>@oauth.local`)

### รูปแบบ error (ทุก endpoint)
```json
{ "error": "ข้อความภาษาไทย", "details": { } }
```
- `400` validation ไม่ผ่าน (zod) — `details` คือ field errors
- `401` ไม่ได้ login / token หมดอายุ / scheduler secret ผิด
- `403` ไม่มีสิทธิ์แก้ระบบของผู้อื่น (RBAC)
- `404` ไม่พบ record
- `500` error อื่น

### สถานะที่คืน
- `200` สำเร็จ (GET/PATCH/PUT) · `201` สร้างใหม่ (POST) · `204` ลบสำเร็จ (ไม่มี body)

---

## A. ฮาร์ดแวร์ — CrabSystem / CrabBox / FilterTank

### CrabSystem
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/systems` | list ทุกระบบ |
| POST | `/api/systems` | สร้างระบบ |
| GET | `/api/systems/:id` | รายตัว (รวม relation) |
| PATCH | `/api/systems/:id` | แก้ (body partial) |
| DELETE | `/api/systems/:id` | ลบ (cascade กล่อง/ถัง) |

**Body (POST):** `{ name*, location?, waterVolumeL?, minLevelNote?, maxLevelNote?, status?(ACTIVE|INACTIVE), ownerId?, notifyEmail?, note? }`
- `ownerId` ถ้าไม่ส่ง → ตั้งเป็น **ผู้สร้าง** (req.user) อัตโนมัติ; `notifyEmail` = อีเมลแจ้งเตือนเฉพาะระบบ (ข้อ 4)
- response มี field `ownerId` + `notifyEmail` — frontend ใช้ `ownerId` เทียบกับ user ปัจจุบันเพื่อรู้ว่าแก้ได้ไหม

### CrabBox (nested + รายตัว)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/systems/:id/boxes` | กล่องทั้งหมดในระบบ |
| POST | `/api/systems/:id/boxes` | สร้าง 1 กล่อง — `{ code*, label?, status?(EMPTY\|OCCUPIED), note? }` |
| POST | `/api/systems/:id/boxes/generate` | สร้างเป็นชุดแถวเดียว — `{ prefix?="A", from*, to*, label? }` (เช่น A1..A30) |
| POST | `/api/systems/:id/boxes/generate-grid` | สร้างเป็นตาราง — `{ rows*(1-26), cols*(1-50) }` (เช่น 6×5 → A1..F5) → `{ requested, created }` |
| PATCH | `/api/boxes/:id` | แก้กล่อง |
| DELETE | `/api/boxes/:id` | ลบกล่อง |

### FilterTank
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/systems/:id/filter-tanks` | ถังกรองในระบบ |
| POST | `/api/systems/:id/filter-tanks` | `{ name*, mediaType?, cleanIntervalDays?, lastCleanedAt? }` |
| PATCH | `/api/filter-tanks/:id` | แก้ |
| DELETE | `/api/filter-tanks/:id` | ลบ |

---

## B. ปู — Crab
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/crabs?systemId&status&type` | list + filter |
| POST | `/api/crabs` | สร้าง |
| GET | `/api/crabs/:id` | รายตัว |
| PATCH | `/api/crabs/:id` | แก้ |
| DELETE | `/api/crabs/:id` | ลบ |

- `status`: `FATTENING` · `READY` · `SOLD` · `DEAD`
- `type`: `MEAT` · `EGG` · `UNKNOWN`
- **Body:** `{ systemId*, code?, boxId?, cableTieColor?, type?, sourceSellerId?, buyerId?, lockedForBuyerId?, purchasePrice?, purchaseDate?, weightG?, startFirmnessPct?(0-100), currentFirmnessPct?(0-100), readyAt?, sellPrice?, sellDate?, status?, round?, note? }`
- `cableTieColor` = สีเคเบิ้ลไทล์รัดกล้าม (hex/ชื่อสี) — **1 กล่องใส่ปูได้หลายตัว** ใช้สีแยกว่าตัวไหนเป็นตัวไหน (ข้อ 2.2)
- `currentFirmnessPct` = %ความแน่นเนื้อ (MEAT) หรือ **%ไข่ (EGG)** — frontend โชว์บนกล่อง (ข้อ 3)
- **gotcha:** ผูกปูเข้ากล่อง (`boxId`) → backend sync `CrabBox.status` (มีปูเป็นๆ ≥1 = OCCUPIED); **ไม่กันจำนวนปูต่อกล่องแล้ว** (เดิมกัน 1 ตัว/กล่อง)

---

## C. น้ำ & ปรุงน้ำ

### WaterTest
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/systems/:id/water-tests?skip&take` | ประวัติการวัด |
| POST | `/api/systems/:id/water-tests` | บันทึกผลวัด → **คืน `{ waterTest, recommendations, closedTaskId?, dosingTaskId? }`** |
| GET | `/api/water-tests/:id` | รายตัว |
| PATCH | `/api/water-tests/:id` | แก้ |
| DELETE | `/api/water-tests/:id` | ลบ |

- **Body:** `{ testedAt?(default now), note?, ph?, alkalinity?, magnesium?, calcium?, salinity?, ammonia?, nitrite? }` (กรอกเฉพาะตัวที่วัด)
- **event chain:** POST จะปิด Task วัดน้ำที่ค้าง + ถ้าค่าหลุดเป้าจะสร้าง Task ปรุงน้ำต่อให้ (`dosingTaskId`)

### WaterTarget (ช่วงเป้าหมาย min/max ต่อพารามิเตอร์)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/systems/:id/water-targets` | 7 พารามิเตอร์ |
| PUT | `/api/systems/:id/water-targets` | upsert ทีละตัว — `{ parameter*, minTarget?, maxTarget?, unit? }` |

- `parameter`: `PH` · `ALKALINITY` · `MAGNESIUM` · `CALCIUM` · `SALINITY` · `AMMONIA` · `NITRITE`

### Dosing preview (ประเมินไม่บันทึก)
| Method | Path | หมายเหตุ |
|---|---|---|
| POST | `/api/systems/:id/dosing-preview` | body = ค่าน้ำ (เหมือน WaterTest) → คืน recommendations |

### Substance (master list สาร/จุลินทรีย์)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/substances?all=true` | `all=true` รวม inactive |
| POST | `/api/substances` | `{ name*, category*(MINERAL\|MICROORGANISM\|OTHER), unit*, needsPrep?, prepLeadDays?, needsRepurchase?, note?, active? }` |
| GET/PATCH/DELETE | `/api/substances/:id` | รายตัว |

### DosingCalibration (สาร 1 หน่วย → ค่าเปลี่ยนเท่าไร, ต่อระบบ)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/systems/:id/dosing-calibrations` | list |
| PUT | `/api/systems/:id/dosing-calibrations` | upsert — `{ substanceId*, parameter*, effectPerUnit*, unit*, note? }` |
| DELETE | `/api/dosing-calibrations/:id` | ลบ |

### DosingRule (ถ้าค่าหลุดเป้า → ทำอะไร)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/systems/:id/dosing-rules` | rule ของระบบ |
| POST | `/api/systems/:id/dosing-rules` | สร้าง rule ผูกระบบ |
| POST | `/api/dosing-rules` | สร้าง rule กลาง (`systemId` null = ใช้ทุกระบบ) |
| PATCH/DELETE | `/api/dosing-rules/:id` | รายตัว |

- **Body:** `{ parameter*, condition*(BELOW_MIN\|ABOVE_MAX), actionType*(DOSE\|MEASURE_NEXT\|NOTE), substanceId?, fixedDose?, message?, active? }`

---

## D. Reminder Engine — Scheduler / ReminderRule / Task

### Scheduler tick (Plesk cron เรียก — ต้องมี secret)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET / POST | `/api/scheduler/tick` | secret ทาง header `x-scheduler-secret` **หรือ** query `?secret=` (= env `SCHEDULER_SECRET`) |

> frontend ปกติ **ไม่ต้องเรียก** อันนี้ — เป็นงานของ cron บน Plesk

### ReminderRule (กฎแจ้งเตือน)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/reminder-rules?systemId` | list |
| POST | `/api/reminder-rules` | สร้าง |
| GET/PATCH/DELETE | `/api/reminder-rules/:id` | รายตัว |

- **Body:** `{ systemId?, type*, title*, scheduleKind*, intervalValue?, cronExpr?, triggerEvent?, timeOfDay?("HH:mm"), leadDays?, reNotifyEveryMin?, payload?, active? }`
- `type`: `WATER_TEST` `DOSING` `FRESHWATER_TOPUP` `FEEDING` `SCRAP_COLLECT` `FILTER_CLEAN` `SUBSTANCE_PREP` `RESTOCK` `CUSTOM`
- `scheduleKind`: `INTERVAL_DAYS` `INTERVAL_MONTHS` `CRON` `EVENT`
- `triggerEvent`: `AFTER_FRESHWATER` `AFTER_WATER_TEST` `AFTER_FEEDING`

### Task (งานจริง — หน้า "งานที่ต้องทำ")
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/tasks?systemId&status&type` | list งาน |
| GET | `/api/tasks/:id` | รายตัว |
| PATCH | `/api/tasks/:id` | `{ status }` — เปลี่ยนสถานะ manual (**ห้ามตั้ง DONE ทางนี้** — DONE ต้องมาจากการบันทึก record จริง หรือปุ่ม "ทำเสร็จแล้ว") |
| POST | `/api/tasks/:id/complete` | ปุ่ม "ทำเสร็จแล้ว" — ปิดงานตามรอบที่เตือนเฉยๆ (ให้อาหาร/เติมน้ำจืด/ล้างกรอง ฯลฯ) → DONE; **บล็อก** type `WATER_TEST`/`DOSING`/`RESTOCK` (ต้องปิดจาก record จริง) |
| POST | `/api/tasks/:id/notify` | บังคับส่งเตือนทันที (debug) → `{ sent: boolean }` |

- `status`: `PENDING` `DONE` `SKIPPED` `CANCELLED`

### Fire event (ยิง event chain manual)
| Method | Path | หมายเหตุ |
|---|---|---|
| POST | `/api/systems/:id/fire-event` | `{ event(AFTER_FRESHWATER\|AFTER_WATER_TEST\|AFTER_FEEDING) }` → `{ event, tasksCreated }` |

---

## E. คู่ค้า & ซื้อขาย

### Contact
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/contacts?type&isRegular&active` | list (ลูกค้าประจำขึ้นก่อน) |
| POST | `/api/contacts` | `{ name*, type*(BUYER\|SELLER\|BOTH), phone?, lineId?, isRegular?, note?, active? }` |
| GET | `/api/contacts/:id` | รายตัว (+ txns & outreach 20 ล่าสุด) |
| PATCH/DELETE | `/api/contacts/:id` | รายตัว |

- **gotcha query boolean:** ใช้ `?isRegular=true` / `?isRegular=false` เท่านั้น (ค่าอื่น validation ไม่ผ่าน)

### Transaction (มี QUOTE = คำนวณกำไรล่วงหน้า)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/transactions?contactId&kind&status&crabId` | list |
| POST | `/api/transactions/preview` | **คำนวณกำไรไม่บันทึก** → `{ qty, pricePerUnit, totalPrice, costBasis, profit }` |
| POST | `/api/transactions` | สร้าง |
| GET/PATCH/DELETE | `/api/transactions/:id` | รายตัว |

- `kind`: `BUY` `SELL` · `status`: `QUOTE` `CONFIRMED` `DONE` `CANCELLED`
- **Body:** `{ contactId*, kind*, status?, crabId?, qty?(default 1), pricePerUnit*, costBasis?, round?, occurredAt?, note? }`
- **preview Body:** `{ kind*, qty?(default 1), pricePerUnit*, costBasis?, crabId? }`
- **คำนวณอัตโนมัติ (ไม่รับจาก client):** `totalPrice = pricePerUnit × qty`; `costBasis` (SELL) ดึงจาก `crab.purchasePrice` ถ้าไม่กรอก; `profit = totalPrice − costBasis`
- **hook:** status → `DONE` จะลง `LedgerEntry` อัตโนมัติ (ดูโมดูล F)

### OutreachLog (ไล่ทักคู่ค้าทีละเจ้าต่อรอบ)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/outreach?round&kind&status&contactId` | list |
| POST | `/api/outreach/start-round` | **เปิดรอบ** — `{ round*, kind*, contactIds? }` → สร้าง log PENDING ให้คู่ค้าที่ type ตรง (idempotent) |
| POST | `/api/outreach` | สร้างทีละรายการ — `{ contactId*, round*, kind*, status?, contactedAt?, note? }` |
| PATCH/DELETE | `/api/outreach/:id` | รายตัว (PATCH ออกจาก PENDING → set `contactedAt` ให้อัตโนมัติ) |

- `status`: `PENDING` `CONTACTED` `HAS_STOCK` `NO_STOCK` `DEALT`

---

## F. การเงิน — Ledger & Dashboard

### LedgerEntry (สมุดบัญชีรวม)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/ledger?systemId&kind&category&from&to` | list (เรียงล่าสุดก่อน) |
| POST | `/api/ledger` | สร้างรายการ manual |
| GET | `/api/ledger/:id` | รายตัว |
| PATCH/DELETE | `/api/ledger/:id` | รายตัว (**entry ที่มาจาก Transaction แก้/ลบไม่ได้** → ไปจัดการที่ Transaction) |

- `kind`: `INCOME` `EXPENSE`
- `category`: `CRAB_SALE` `CRAB_PURCHASE` (มาจาก txn อัตโนมัติ) · `FOOD` `SUBSTANCE` `EQUIPMENT` `OTHER` (manual)
- **Body:** `{ kind*, category*, amount*, occurredAt*, systemId?, note? }`
- `from`/`to` = ช่วงวันที่กรอง `occurredAt`

### Dashboard / analytics (read-only)
| Method | Path | คืนอะไร |
|---|---|---|
| GET | `/api/dashboard/overview?systemId` | `{ systemCount, crabs{by status}, boxes{by status}, pendingTasks, finance{totalIncome,totalExpense,net} }` |
| GET | `/api/dashboard/finance?systemId&from&to` | `{ totalIncome, totalExpense, net, entryCount, byCategory[], byMonth[] }` (pain point #2) |
| GET | `/api/dashboard/crabs?systemId` | `{ soldCount, totalProfit, avgProfit, avgDurationDays, avgProfitPerDay, avgWeightG, avgFirmnessPct, byStatus, items[] }` (pain point #3) |

- `byCategory[]`: `{ category, income, expense, net }`
- `byMonth[]`: `{ month("YYYY-MM"), income, expense, net }`
- `items[]` (crabs): `{ id, code, type, weightG, currentFirmnessPct, purchasePrice, sellPrice, profit, durationDays, profitPerDay }`

---

## G. คลังของ — InventoryItem (อาหาร/สาร/อุปกรณ์ + แจ้งเตือนใกล้หมด)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/inventory?category&lowOnly` | list (`lowOnly=true` เฉพาะที่ใกล้หมด) |
| POST | `/api/inventory` | `{ name*, category*(FOOD\|SUBSTANCE\|EQUIPMENT\|OTHER), unit*, currentQty?, lowThreshold?, substanceId?, note? }` |
| GET | `/api/inventory/:id` | รายตัว |
| PATCH | `/api/inventory/:id` | แก้ |
| POST | `/api/inventory/:id/adjust` | `{ delta }` — บวก=ซื้อเข้า, ลบ=ใช้ไป (ไม่ต่ำกว่า 0) |
| DELETE | `/api/inventory/:id` | ลบ |

- **แจ้งเตือนอัตโนมัติ:** `scheduler.tick` เช็คของที่ `currentQty <= lowThreshold` → สร้าง Task `RESTOCK` (กันซ้ำ, ผูกเจ้าของ) → เข้าเมลสรุป; เติมจนพ้นเกณฑ์ → ปิด Task ให้อัตโนมัติ

## Health
| Method | Path | |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/health/db` | เช็คต่อ DB ได้ |
