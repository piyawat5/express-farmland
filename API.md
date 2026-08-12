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
| GET | `/api/auth/me` | — (ต้องมี Bearer) | `{ id, email, name, role, avatarUrl, uiPrefs }` |
| PATCH | `/api/auth/me/prefs` | `{ <key>: <value>, ... }` (merge ทับของเดิม) | user object — ใช้จำ `{tourDoneAt, tourSkipped, tourVersion}` ของโหมดสอน (Phase 22) |

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

**Body (POST):** `{ name*, location?, waterVolumeL?, minLevelNote?, maxLevelNote?, status?(ACTIVE|INACTIVE), ownerId?, notifyEmail?, eggCheckDays?, meatCheckDays?, sizeBuckets?, note? }`
- `ownerId` ถ้าไม่ส่ง → ตั้งเป็น **ผู้สร้าง** (req.user) อัตโนมัติ; `notifyEmail` = อีเมลแจ้งเตือนเฉพาะระบบ (ข้อ 4)
- `eggCheckDays`/`meatCheckDays` (Int, nullable) = เกณฑ์ "เลี้ยงครบกี่วันควรเช็คไข่/เนื้อ" → scheduler สร้าง Task `CRAB_CHECK` (ข้อ 3)
- `sizeBuckets` (Json, nullable) = ช่วงไซส์ตัวโลสำหรับข้อความโพสต์ `[{minPerKilo, maxPerKilo}]` (ข้อ 5) — set null ใช้ `Prisma.DbNull` ที่ service
- `receiptSettings` (Json, nullable) = ตั้งค่าใบเสร็จ/หน้าร้าน `{ shopName, logoUrl, color, footerNote, blockOrder, priceEgg, priceMeat }`
- `reportSettings` (Json, nullable) = ตั้งค่ารายงาน/คำนวณราคาปู `{ fixedCosts:[{label,monthly}], daysPerMonth, boxCount, sizeTiers:[{label,minG,maxG,pricePerKilo,divisorG}] }` — set null ใช้ `Prisma.DbNull` ที่ service
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
| GET | `/api/crabs/export?systemId` | **ส่งออก CSV** (ข้อ 6) — คืน `text/csv` (มี BOM), 1 แถว/ตัว |
| GET | `/api/crabs/progress?systemId` | **ภาพรวมพัฒนาการปู before/after** (ปูที่ยังเลี้ยงอยู่ + 2 รอบวัดล่าสุด) |
| POST | `/api/crabs` | สร้าง |
| GET | `/api/crabs/:id` | รายตัว (+`history[]` แยกโซน) |
| PATCH | `/api/crabs/:id` | แก้ |
| DELETE | `/api/crabs/:id` | ลบ |
| PATCH | `/api/crabs/history/:id` | **แก้ไขรอบในประวัติ 1 แถว** (ข้อ 1) — body `{ weightG?, currentFirmnessPct?, imageUrl?, imagePublicId?, lastCheckedAt? }` (null = ลบ/เคลียร์); ตัวเลข/วันที่แก้ได้เฉพาะโซน MEASURE; **ถ้าเป็นรอบ MEASURE ล่าสุด → sync ค่าปัจจุบันของปูให้ตรง** |
| DELETE | `/api/crabs/history/:id` | ลบประวัติแยกโซน 1 แถว (ข้อ 8) — ใช้ลบแถวซ้ำ/ผิด (ลบรูปบน Cloudinary ให้ด้วย best-effort) |

- `status`: `FATTENING` · `READY` · `SOLD` · `DEAD`
- `type`: `MEAT` · `EGG` · `UNKNOWN`
- `sex`: `MALE` (ผู้) · `INTERSEX` (กะเทย) · `FEMALE` (เมีย) · `UNKNOWN` — default `UNKNOWN`
- `grade`: `A` (สมบูรณ์) · `B` (ไม่สมบูรณ์) · `null`
- **Body:** `{ systemId*, code?, boxId?, cableTieColor?, feedingNote?, lastCheckedAt?, type?, sex?, grade?, sourceSellerId?, buyerId?, lockedForBuyerId?, purchasePrice?, purchaseDate?, weightG?, startFirmnessPct?(0-100), currentFirmnessPct?(0-100), readyAt?, sellPrice?, sellDate?, status?, round?, note?, measureImageUrl?, measureImagePublicId? }`
- `measureImageUrl`/`measureImagePublicId` = รูปแนบรอบวัด (จาก `POST /api/uploads/crab-image`) — เก็บใน `snapshot` ของ `CrabHistory` โซน MEASURE; **ส่งมาเฉพาะตอนอัปรูปใหม่** (มีรูป → บังคับสร้างรอบ MEASURE ใหม่แม้ค่าอื่นไม่เปลี่ยน)
- **`GET /api/crabs/progress`** คืน `[{ id, code, boxId, boxCode, type, cableTieColor, status, before, after, deltaDays }]` — `before`/`after` = `{ recordedAt, measuredAt, weightG, firmnessPct, imageUrl } | null` (`after`=รอบล่าสุด, `before`=รอบก่อน), `deltaDays`=จำนวนวัน before→after
- `cableTieColor` = สีเคเบิ้ลไทล์รัดกล้าม (hex/ชื่อสี) — **1 กล่องใส่ปูได้หลายตัว** ใช้สีแยกว่าตัวไหนเป็นตัวไหน (ข้อ 2.2)
- `currentFirmnessPct` = %ความแน่นเนื้อ (MEAT) หรือ **%ไข่ (EGG)** — frontend โชว์บนกล่อง (ข้อ 3)
- `feedingNote` = พฤติกรรมการกิน (ไม่กินปลา/ไม่กินหอย/กินน้อย ...) โชว์หน้ากล่อง (ข้อ 4)
- `lastCheckedAt` = วันเช็คไข่/เนื้อล่าสุด (ข้อ 3,8) — ถ้าบันทึกค่าวัด (weight/firmness) โดยไม่ส่งมา → auto = วันนี้; ใช้คิด due ของ Task `CRAB_CHECK`
- **`GET /api/crabs/:id` คืน `history[]`** (ข้อ 8): `[{ id, zone('MEASURE'|'CLASSIFY'|'FEEDING'|'SOURCE'), snapshot(Json), recordedAt }]` เรียงใหม่→เก่า — `PATCH` บันทึก `CrabHistory` **เฉพาะโซนที่ค่าเปลี่ยนจริง**; แก้โซน MEASURE → ปิด Task `CRAB_CHECK` ของปูตัวนั้น
- **gotcha:** ผูกปูเข้ากล่อง (`boxId`) → backend sync `CrabBox.status` (มีปูเป็นๆ ≥1 = OCCUPIED); **ไม่กันจำนวนปูต่อกล่องแล้ว** (เดิมกัน 1 ตัว/กล่อง)

## B2. แผนให้อาหาร & รอบบันทึกการกิน (Phase 21)

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/systems/:id/feeding-plan` | แผน + พรีวิว 14 วัน → `{ plan, preview:[{date,feed}] }` |
| PUT | `/api/systems/:id/feeding-plan` | สร้าง/แก้แผน — body `{ onDays*, offDays*, anchorDate*, timeOfDay*, recordLeadHours?, active?, note? }` |
| DELETE | `/api/systems/:id/feeding-plan` | ลบแผน (204) |
| GET | `/api/systems/:id/feeding-round/current` | รอบที่เปิดอยู่ + แผน → `{ plan, round }`; **เปิดรอบให้แบบ lazy ถ้าถึงเวลาแล้วแต่ cron ยังไม่ยิง** |
| POST | `/api/systems/:id/feeding-round/open` | เปิดรอบเอง (นอกแผน) — body `{ at? }` → `RoundProgress` (201) |
| GET | `/api/systems/:id/feeding-rounds?take&skip` | ประวัติรอบ + สถิติ (อ่านจากคอลัมน์ denormalize) |
| GET | `/api/systems/:id/feeding-energy?rounds=5` | **หลอดพลัง** — คะแนนการกินเฉลี่ย N รอบล่าสุดต่อปู |
| GET | `/api/feeding-rounds/:id` | snapshot รอบ |
| POST | `/api/feeding-rounds/:id/entries` | **บันทึกการกินปู 1 ตัว** — body `{ crabId*, tags[]*, note? }` → `{ round, celebrated }` |
| DELETE | `/api/feeding-rounds/:id/entries/:crabId` | ยกเลิกการบันทึกของปูตัวนั้น |
| POST | `/api/feeding-rounds/:id/close` | ปิดรอบทั้งที่ยังบันทึกไม่ครบ |
| POST | `/api/feeding-rounds/:id/skip` | ข้ามรอบ (ไม่ได้ให้อาหารวันนั้น) |

- **วงรอบ:** `onDays/offDays` = "ให้ N วัน เว้น M วัน" — วันเว้นวัน=`1/1` · 2เว้น1=`2/1` · 3เว้น1=`3/1` · 2เว้น2=`2/2` · ทุกวัน=`1/0`. คำนวณจาก `anchorDate` (`src/lib/feedingCycle.ts`) เพราะ **cron เขียนแบบนี้ไม่ได้** (คาบไม่หารลงตัวกับเดือน)
- **ตั้งใจแยกจาก `ReminderRule`**: ถ้าผูกกัน การกด "ทำเสร็จแล้ว" จะ recompute `nextRunAt` ด้วย `minAdvance` → วงรอบหลุด anchor. รอบนี้สร้าง `Task` ตรง ๆ (`ruleId=null`, `linkType:'FeedingRound'`) จึงได้เมลสรุป/หน้างาน/ปฏิทินครบเหมือนเดิม
- **Task 2 ใบต่อรอบ:** `FEEDING` ที่ `dueAt` + `SCRAP_COLLECT` ที่ `dueAt + recordLeadHours` (ผู้ใช้เดินเก็บเศษแล้วค่อยไล่บันทึก) — ปิดอัตโนมัติเมื่อบันทึกครบ
- **`RoundProgress`** = `{ id, systemId, planId, feedDate("YYYY-MM-DD"), dueAt, recordDueAt, status, startedAt, completedAt, total, recorded, remaining, boxes[], crabs[], stats }`
  - `boxes[]` = `{ boxId, code, label, total, recorded, done }` → ใช้ทำ**ป้ายบนกล่อง** (หายเมื่อ `done`)
  - `crabs[]` = `{ crabId, code, boxId, boxCode, cableTieColor, recorded, tags[], note, score, recordedAt, recordedByUserId, recordedByName }`
  - `stats` = `{ elapsedSec, normalCount, lowCount, noneCount, avgScore, recordedCount, expectedCount }`
- **คะแนนการกิน (`score`)**: กินปลาปกติ+กินหอยปกติ=100 · อย่างใดอย่างหนึ่ง=65 · กินน้อย=35 · ไม่กินเลย=0
- **`POST /entries` ไม่ regress ของเดิม** — เขียน `Crab.feedingNote` (`tags.join(', ')`) + `Crab.lastFedAt` (= `round.dueAt` ไม่ใช่เวลาที่กดบันทึก) + `CrabHistory` โซน `FEEDING` (คีย์ `feedingNote`/`fedAt` เหมือนเดิม); **บันทึกซ้ำตัวเดิม = อัปเดตแถวประวัติเดิม ไม่สร้างซ้ำ**
- **concurrency:** `@@unique([roundId,crabId])` → 2 คนกดปูตัวเดียวกันพร้อมกันได้แถวเดียว; ปิดรอบด้วย conditional update → `celebrated=true` เกิดขึ้น**ครั้งเดียว**เสมอ
- **`total` นับสด** จากปูจริงในระบบ (`deletedAt=null`, status `FATTENING|READY`) ไม่ใช่ `expectedCount` ที่เก็บไว้ — ปูขาย/เพิ่มกลางรอบแล้วตัวเลขขยับได้ FE ห้าม cache
- **`feeding-energy`** คืน `[{ crabId, boxId, avgScore, samples, lastScore, lastRecordedAt, series[] }]` — **ปูที่ไม่มีบันทึกในรอบนั้นจะไม่ถูกนับเป็น 0** (ลืมบันทึก ≠ อดอาหาร) ดู `samples` ประกอบ
- **สิทธิ์:** GET = login แล้วพอ (ไม่ใช่เจ้าของ → **404** จาก `assertOwnership`) · เขียน = `requireSystemEdit` (**403**)

### Realtime (WebSocket) — ซิงค์รอบให้อาหารระหว่างเครื่อง

| | |
|---|---|
| URL | `ws(s)://<host><WS_PATH>` (ดีฟอลต์ `/ws`) — ดูสถานะจาก `GET /api/health` → `realtime:{enabled,path}` |
| Auth | **subprotocol** `['jwt', <accessToken>]` (browser ตั้ง Authorization header ไม่ได้); fallback `?token=` สำหรับ debug |
| client→server | `{t:'subscribe'\|'unsubscribe', systemId}` · `{t:'ping'}` |
| server→client | `{t:'hello'\|'subscribed'\|'pong'\|'error'}` · **`{t:'feeding.opened'\|'feeding.progress'\|'feeding.completed', systemId, round}`** |

- `round` ที่ push = **snapshot เต็ม ก้อนเดียวกับที่ REST คืน** → client ไม่ต้อง reconcile, หลุดไปกี่ข้อความก็ self-heal
- ปิดด้วย **4401** = token ใช้ไม่ได้ → ให้ refresh แล้วต่อใหม่ 1 ครั้ง (ซ้ำอีก = ให้ logout); **4403** = origin ไม่ผ่าน (prod)
- server ping ทุก `WS_HEARTBEAT_SEC` (30 วิ) — กัน nginx ของ Plesk ตัดสายที่เงียบ
- **ถ้า Plesk/Passenger ไม่ proxy upgrade** → ต่อไม่ติด, FE ถอยไป polling `GET .../feeding-round/current` ทุก 5 วิ อัตโนมัติ (payload เหมือนกันเป๊ะ); ปิดสวิตช์ทั้งระบบด้วย `REALTIME_ENABLED=false`

---

### Uploads — รูปภาพ (Cloudinary)
| Method | Path | หมายเหตุ |
|---|---|---|
| POST | `/api/uploads/crab-image` | อัปโหลดรูป **multipart** (field `image`, ≤8MB, image/* เท่านั้น) → `{ url, publicId }` |

- ใช้ signed upload ผ่าน backend (มี `CLOUDINARY_API_SECRET`) — FE ได้ `url`/`publicId` มาแล้วส่งต่อเป็น `measureImageUrl`/`measureImagePublicId` ตอน `PATCH/POST /api/crabs`
- ถ้ายังไม่ตั้ง env `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` → คืน **503**

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

- **Body:** `{ testedAt?(default now), note?, ph?, alkalinity?, magnesium?, calcium?, potassium?, salinity?, ammonia?, nitrite? }` (กรอกเฉพาะตัวที่วัด)
- **event chain:** POST จะปิด Task วัดน้ำที่ค้าง + ถ้าค่าหลุดเป้าจะสร้าง Task ปรุงน้ำต่อให้ (`dosingTaskId`)

### WaterTarget (ช่วงเป้าหมาย min/max ต่อพารามิเตอร์)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/systems/:id/water-targets` | 7 พารามิเตอร์ |
| PUT | `/api/systems/:id/water-targets` | upsert ทีละตัว — `{ parameter*, minTarget?, maxTarget?, unit? }` |

- `parameter`: `PH` · `ALKALINITY` · `MAGNESIUM` · `CALCIUM` · `POTASSIUM` · `SALINITY` · `AMMONIA` · `NITRITE`

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
> response: `{ now, generated, restock, crabCheck, pending, emailsSent }` — `crabCheck` = Task `CRAB_CHECK` ที่สร้างใหม่ (ปูถึงกำหนดเช็ค, ข้อ 3)
- `type` ของ ReminderRule/Task รองรับค่าเพิ่ม `CRAB_CHECK` (สร้างอัตโนมัติจาก scheduler ไม่ใช่จากกฎ)

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
| GET | `/api/dashboard/finance?systemId&from&to&includeUnassigned` | `{ totalIncome, totalExpense, net, entryCount, byCategory[], byMonth[] }` (pain point #2) |
| GET | `/api/dashboard/crabs?systemId` | `{ soldCount, totalProfit, avgProfit, avgDurationDays, avgProfitPerDay, avgWeightG, avgFirmnessPct, byStatus, items[] }` (pain point #3) |

- แยกบัญชีต่อระบบ: เมื่อส่ง `systemId` จะกรอง **เฉพาะระบบนั้น** (ไม่รวมรายการส่วนกลาง `systemId=null`); ส่ง `includeUnassigned=true` เพื่อรวมรายการที่ไม่ผูกระบบเข้าไปด้วย
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

## H. หมู่บ้านฟาร์ม — เยี่ยมชมฟาร์มคนอื่น / ตกแต่ง / จดหมาย (Phase 23)

**สิทธิ์:** `canViewFarm` (lib/scope.ts) = เจ้าของ **หรือ** `CrabSystem.villageOpen=true` **หรือ** มี `FarmAccess` APPROVED ที่ยังไม่ถูกถอน **หรือ** ADMIN
⚠️ เข้าไม่ได้ = **404 ไม่ใช่ 403** (ตาม `assertOwnership` — กันใช้ endpoint ไล่เดาว่า systemId ไหนมีอยู่จริง)
⚠️ `villageOpen` **คนละเรื่องกับ `publicEnabled`** (หน้าร้าน QR ของลูกค้าที่ไม่ได้ล็อกอิน) — ห้ามใช้ปนกัน

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/village/users` | ผู้ใช้ที่ active **ทุกคน** + สถานะสิทธิ์ของเราต่อคนนั้น → `{ id, name, avatarUrl, farmAvatar, systems[], access, canVisit, accessId }`; `access` = `SELF\|APPROVED\|OPEN\|PENDING\|DENIED\|NONE`; `email` เฉพาะ ADMIN |
| GET | `/api/village/me` | `{ me, systems[], grantsGiven[], grantsReceived[] }` |
| PATCH | `/api/village/me/avatar` | หน้าตาตัวละคร `{ skin?, face?, hair?, hairColor?, shirt?, shirtColor?, pants?, pantsColor?, hat?, hatColor?, accessory? }` — zod `.strict()` (key แปลกปลอม = 400), สีต้องเป็น `#rrggbb` |
| GET | `/api/village/inbox` | `{ pending[], unreadLetters, unreadReplies }` — **derive จากข้อมูลจริง ไม่มีตาราง notification** |
| POST | `/api/village/replies/seen` | ผู้เขียนรับทราบคำตอบแล้ว → เคลียร์ badge |
| POST | `/api/village/access/request` | `{ ownerId*, message? }` → upsert เป็น PENDING + ยิง WS `village.request` ให้เจ้าของ; ขอตัวเอง = 400; อนุมัติอยู่แล้ว = คืน `alreadyApproved:true` ไม่รบกวนเจ้าของ |
| POST | `/api/village/access/:id/approve` \| `/deny` | เจ้าของเท่านั้น → ยิง WS `village.access` ให้ผู้ขอ |
| DELETE | `/api/village/access/:id` | ถอนสิทธิ์ (เจ้าของ) หรือยกเลิกคำขอ (ผู้ขอ) → set `revokedAt` + **เตะ socket ที่ยืนอยู่ในฟาร์มออกทันที** |
| GET | `/api/village/farms/:systemId` | snapshot ก้อนเดียว `{ system, boxes[], decor[], letters[], canEdit }`; `boxes` มีแค่ `{id, code, label, color, status, crabCount}` — **ไม่มีราคา/ต้นทุน/โน้ต**; ผู้มาเยือนเห็นเฉพาะจดหมายของตัวเอง |
| GET | `/api/village/farms/:systemId/presence` | ใครเดินอยู่ในฟาร์มตอนนี้ (อ่านจาก memory ของ realtime.ts) — REST fallback ตอน WS ใช้ไม่ได้ |
| PUT | `/api/village/farms/:systemId/decor` | `{ items: [{kind*, x*, y*, z?, rot?(0/90/180/270), scale?(50–200), flip?, variant?}] }` สูงสุด 300 ชิ้น — **แทนที่ผังทั้งชุด** (deleteMany+createMany ใน transaction); เจ้าของเท่านั้น |
| GET/POST | `/api/village/farms/:systemId/letters` | POST `{ x*, y*, body*(≤500), mood? }`; กันสแปม ≤20 ฉบับ/คน/ฟาร์ม (เกิน = 400) |
| POST | `/api/village/farms/:systemId/letters/read-all` | เจ้าของกดอ่านทั้งฟาร์มรวดเดียว |
| POST | `/api/village/letters/:id/reply` | `{ reply*(≤500) }` — เจ้าของฟาร์มเท่านั้น (คนอื่น 403) |
| DELETE | `/api/village/letters/:id` | ผู้เขียน หรือ เจ้าของฟาร์ม → soft delete |
| PATCH | `/api/systems/:id` | **ใช้ของเดิม** — เพิ่มฟิลด์ `villageOpen: boolean` (ปิดสวิตช์ = เตะคนที่เข้ามาได้เพราะสวิตช์นี้ออก) |

### WebSocket — ห้องหมู่บ้าน (แยกจากห้องข้อมูล)
⚠️ `ws.farmRooms` **แยกจาก `ws.rooms` โดยตั้งใจ** — `rooms` ส่ง `feeding.*` ที่มี snapshot รอบเต็ม (รหัสปู/โน้ต/คะแนน/ชื่อคนบันทึก) แขกที่เดินเข้ามาต้องไม่ได้รับ
สิทธิ์เช็ค **ครั้งเดียวตอน `village.enter`** (1 query) — หลังจากนั้น `village.move` (10 Hz) เช็คแค่ `Set.has` ใน memory ไม่มี query เลย

| ทิศทาง | ข้อความ | หมายเหตุ |
|---|---|---|
| → server | `{t:'village.enter', systemId, x?, y?}` | เช็ค `canViewFarm`; ไม่ผ่าน = `{t:'error'}` |
| → server | `{t:'village.leave', systemId}` | |
| → server | `{t:'village.move', systemId, x, y, f}` | `f` = `u/d/l/r`; server clamp พิกัด 0–200 + ปัด 1 ตำแหน่ง; **ทิ้งเงียบถ้ามาถี่กว่า 80ms** |
| → server | `{t:'village.emote', systemId, emote}` | |
| ← client | `village.entered` | `{ peers: PresenceUser[], me }` — snapshot เต็มตอนเข้า |
| ← client | `village.join` / `village.leave` / `village.move` / `village.emote` | **ไม่ echo กลับหาคนส่ง** (`publishFarm(..., except)`) |
| ← client | `village.letter` / `village.decor` | **แค่ "เคาะ" ไม่มี payload** → ให้ client ไป GET ใหม่ (กันชน `maxPayload` 16KB ตอนผังมี 300 ชิ้น) |
| ← client | `village.request` | ส่งถึงเจ้าของฟาร์มทุกเครื่อง (`publishToUser`) ไม่ว่าอยู่หน้าไหน → ป๊อปอัพ |
| ← client | `village.access` | `{ ownerId, systemIds, granted }` — `granted:false` = ถูกถอนสิทธิ์/ถูกเตะ |

- **ตำแหน่ง avatar ไม่ถูกเก็บลง DB เลย** (อยู่ใน memory ของ `realtime.ts`) — reconnect = เกิดใหม่ที่จุด spawn
- ไม่มี presence registry กลาง — scan `wss.clients` กรอง `farmRooms.has(id)` → cleanup ตอน disconnect ได้ฟรี

## Health
| Method | Path | |
|---|---|---|
| GET | `/api/health` | liveness → `{ status, service, time, realtime:{enabled, path} }` (FE ใช้ `realtime` ตัดสินใจว่าจะต่อ WebSocket ไหม) |
| GET | `/api/health/db` | เช็คต่อ DB ได้ |
