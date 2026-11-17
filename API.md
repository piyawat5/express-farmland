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
| POST | `/billing/slips` | `{ planId, imageUrl, imagePublicId?, amount?, note? }` → 201 · มีสลิปรอตรวจได้ไม่เกิน 3 ใบ · ส่งซ้ำภายใน 1 นาที = 400 (ล็อกแถวผู้ใช้ 2 คำขอพร้อมกันได้ใบเดียว) · ส่งแล้วอีเมลหาแอดมินทุกคน (`notifyEmail` ก่อน ไม่มีใช้อีเมลล็อกอิน) พร้อมรูปสลิป + ลิงก์หน้าตรวจ |
| POST | `/uploads/image?kind=slip\|crab\|bug` | multipart field `image` (≤8MB) → `{ url, publicId }` · ไม่ได้ตั้ง Cloudinary = 503 |
| GET | `/bugs` | (P8) เรื่องที่ฉันแจ้ง ล่าสุดก่อน `[{ id, excerpt, photo, pageTitle, status, userUnread, adminUnread, comments, lastActivityAt, createdAt }]` |
| POST | `/bugs` | `{ body, photos?: [{url, publicId?}](≤3, ต้องเป็นรูปจาก /uploads), page?, pageTitle?, device?: { ua, screen, theme, app, lang } }` → `BugDetail` 201 · วันละ ≤10 เรื่อง (429) |
| GET | `/bugs/:id` | `BugDetail` `{ …, device, comments: [{ id, fromAdmin, body\|null, photos, status\|null, createdAt }] }` · เปิดอ่าน = `userUnread:false` (⚠ `bug_reply` หาย) · ของคนอื่น = 404 |
| POST | `/bugs/:id/comments` | `{ body, photos? }` → `BugDetail` · เรื่องที่ "แก้แล้ว"/"ขอข้อมูลเพิ่ม" = กลับเป็น `RECEIVED` |
| GET | `/announcements` | (P8) ประกาศที่กำลังแสดง ใหม่สุดก่อน `[{ id, kind 'MUST_READ'\|'GENERAL', title, body, linkUrl, startsAt, expiresAt, acked }]` |
| POST | `/announcements/:id/ack` | รับทราบ (ต้องรู้) / ปิดการ์ด (ทั่วไป) → 204 · กดซ้ำได้ |
| GET | `/learn/videos` | (P8) `{ [เรื่องสอน]: url }` — ลิงก์คลิปสอนที่แอดมินใส่ |

แจ้งปัญหา/ประกาศ/คลิปอยู่ชั้นนี้ (ยังไม่จ่ายก็แจ้งปัญหาได้) · สถานะเรื่องที่แจ้ง: `RECEIVED` รับเรื่องแล้ว · `FIXING` กำลังแก้ · `FIXED` แก้แล้ว · `NEED_INFO` ขอข้อมูลเพิ่ม

## มีสิทธิ์ใช้งาน
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/attention` | `{ items: [{ key, level 'setup'\|'warn'\|'urgent', menu, target, title, cta, count?, systemIds?, itemIds? }] }` — ป้าย ⚠ นำทาง · `target` = ค่า `data-attention` ของปุ่มเป้าหมาย · `systemIds` = เรื่องของระบบไหน (หน้าเว็บขึ้น ⚠ บนปุ่มเฉพาะตอนเลือกระบบนั้น · เมนูขึ้นถ้ามีระบบไหนค้าง · มีหลายระบบ `title` ขึ้นต้นด้วยชื่อระบบ) · `itemIds` = อาหารที่เกี่ยวข้อง (⚠ ที่ปุ่ม "ซื้อ" ของอาหารนั้น) |

key ที่มีตอนนี้: `bug_reply` (P8 · `community`, `community-bugs`, มี `count` · ทีมงานตอบ/เปลี่ยนสถานะเรื่องที่แจ้งแล้วยังไม่ได้เปิดอ่าน) · `system_missing` (menu `crabs`, target `crabs-add-system`) · `first_lot_missing` (`crabs`, `crabs-intake`) · `lot_cost_missing` (`crabs`, `crabs-lots`, มี `count`) · `notify_email_missing` (`profile`, `profile-notify-email`) · `tasks_due` (`reminders`, `reminders-today`, มี `count` = งานที่ถึงเวลาแล้ว · `level: 'urgent'` เมื่อมีงานด่วนมาก)

## แอดมิน (`/admin`)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/admin/overview` | `{ totalUsers, newUsers(7 วัน), activeCustomers, expiringSoon(≤7 วัน), waiting(ยังไม่เคยมีสิทธิ์), pendingSlips, unreadBugs, openBugs, pendingIdeas }` |
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
| GET | `/admin/bugs?status=OPEN\|RECEIVED\|FIXING\|FIXED\|NEED_INFO&unread=1&skip&take` | (P8) `{ total, counts{สถานะ: n}, unread, items: [BugRow + user{id,name,email}] }` · ยังไม่อ่านขึ้นก่อน · `OPEN` = ยังไม่แก้ |
| GET | `/admin/bugs/:id` | `BugDetail + user` · เปิดอ่าน = `adminUnread:false` |
| POST | `/admin/bugs/:id/reply` | `{ body?, photos?, status? }` ต้องมีอย่างน้อย 1 อย่าง (ข้อความว่าง+สถานะเดิม = 400) → `BugDetail` · ผู้ใช้ได้ ⚠ `bug_reply` |
| GET | `/admin/ideas?status&sort=top\|new&skip&take` | (P8) เหมือน `/ideas` + `authorId`, `authorEmail` |
| PATCH/DELETE | `/admin/ideas/:id` | `{ status?, reply?(null=ลบคำตอบ), title?, body? }` · ตอบใหม่ = `repliedAt` ตอนนี้ |
| GET/POST | `/admin/announcements` | (P8) GET = ทุกประกาศ + `ackCount`(นับแค่ลูกค้า) + `state 'SCHEDULED'\|'ACTIVE'\|'EXPIRED'` · POST `{ kind, title, body, linkUrl?(http/https), startsAt?(ว่าง=ทันที), expiresAt?(ว่าง=ไม่หมด) }` · แอดมินที่ประกาศ = รับทราบแล้ว (ไม่เด้งใส่ตัวเอง) · หมดอายุก่อนเริ่ม = 400 |
| PATCH/DELETE | `/admin/announcements/:id` | แก้/ลบ |
| POST | `/admin/announcements/:id/reset-acks` | ล้างการรับทราบของลูกค้า → ป๊อปอัป/การ์ดกลับมาอีกรอบ |
| GET/PUT | `/admin/content` | (P8) `{ nowBuilding: string\|null, videos: { [เรื่องสอน]: url } }` · PUT `videos` = แทนทั้งชุด · ค่า `''` = ลบลิงก์ · key = `[a-z0-9_-]` · ลิงก์ http/https เท่านั้น |

## ฟาร์ม (P2) — ต้องมีสิทธิ์ใช้งาน · เห็นได้เฉพาะของตัวเอง (ของคนอื่น = 404)

### ระบบปู
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/systems` | `[{ id, name, layout, rows, cols, sortOrder, aliveCrabs }]` |
| POST | `/systems` | `{ name, layout 'BASKET'\|'CONDO_SINGLE'\|'CONDO_DOUBLE', rows(1–30), cols(1–60) }` → สร้างกล่องให้ครบ (หน้า-หลัง = 2 ด้าน) รหัส `A1` (A = ชั้นบนสุด) · **หน้า-หลัง: ด้านหลังต่อตัวอักษรจากด้านหน้า** (4 ชั้น: หน้า A-D หลัง E-H) รหัสไม่ซ้ำทั้งระบบ · ชื่อซ้ำกับระบบอื่นของตัวเอง = 400 (ล็อกแถวผู้ใช้ กดสร้างพร้อมกันได้ระบบเดียว) |
| PATCH | `/systems/:id` | `{ name?, rows?, cols? }` · ย่อผังได้เฉพาะเมื่อกล่องที่หายไม่มีปู (400 บอกรหัสกล่อง) · หน้า-หลังเปลี่ยนจำนวนชั้น = รหัสด้านหลังเลื่อนตาม (ปูที่ชื่อยังเป็นรหัสเดิมเปลี่ยนชื่อตาม) · ชื่อซ้ำ = 400 |
| DELETE | `/systems/:id` | ได้เฉพาะระบบที่ไม่เคยมีปู |
| GET | `/systems/:id/grid` | `{ system, checkEveryDays(รอบเช็คปูจากแจ้งเตือน · null = ปิดเรื่องนี้ ไม่ขึ้น ⚠), boxes:[{id,side,row,col,code}], crabs:[{id,boxId,name,type,sex,grade,cableTieColor,lastWeightG,lastPct,lastPhotoUrl,lastCheckedAt, lot:{id,receivedAt,costMissing}, sale:{id,no,customer} \| null(P6 ใบจองที่ถือปูตัวนี้ → ป้าย 🔖)}] }` — ปูที่ยังเลี้ยงอยู่เท่านั้น |

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
| GET | `/crabs/history?systemId?&status?&type?&q?&skip&take(≤100 · ค่าเริ่มต้น 15)` | **ประวัติปู (P7) แท็บ "ปูทั้งหมด"** — รวมปูที่ขาย/ตาย/**ลบ** · `status` `ALIVE`\|`SOLD`\|`DEAD`\|`DELETED`(ลบเพราะบันทึกผิด) · `q` = ชื่อมีคำนี้ หรือรหัสกล่องตรง (ตัวเล็กก็ได้) · ไม่ส่ง systemId = ทุกระบบ · ล็อตใหม่สุดก่อน แล้วตามลำดับที่รับเข้า → `{ total, counts:{ALIVE,SOLD,DEAD,DELETED}(ตามชนิด/คำค้น ไม่สนสถานะที่กรอง), items:[{ id, name, type, status, systemId, allocatedCost, lastWeightG, lastPct, lastPhotoUrl, lastCheckedAt, diedAt, soldAt, deletedAt, checks(จำนวนรอบ), box:{code,side}\|null, lot:{id,receivedAt}, sale:{id,no,status,customer}\|null, salePrice(ใบที่ขายแล้วเท่านั้น)\|null }] }` |
| GET | `/crabs/compare?systemId` | **ประวัติปู (P7) แท็บ "ก่อน-หลัง"** — ปูที่ยังเลี้ยงอยู่ (รวมจองไว้) ที่เช็คแล้ว ≥ 2 ครั้ง เรียงตามผัง → `[{ id, name, type, box:{code,side}\|null, lotReceivedAt, checks, first, prev, last }]` (รอบแรก · รอบก่อนล่าสุด · รอบล่าสุด = `{id, checkedAt, weightG, pct, photoUrl}`) |
| GET | `/crabs/:id` | รายละเอียด + `checks[]` (ใหม่สุดก่อน) + `lot` + `box` + `system` + `soldAt` + `sale:{id,no,status,customer} \| null` (P6) · ⚠️ route `/crabs/history` `/crabs/compare` ต้องอยู่ก่อน `/:id` |
| PATCH | `/crabs/:id` | `{ name?, type?, sex?, grade?, cableTieColor?, note?, boxId?(ย้ายกล่อง), lotId?(ย้ายล็อต) }` |
| POST | `/crabs/:id/dead` | `{ dead: boolean, diedAt? }` — ปูตาย / กดผิดเอากลับ · **ปูในใบจอง/ใบขาย = 400** ("ปูตัวนี้จองไว้ในใบที่ 3 — … เอาออกจากใบก่อน") — ลบ / ย้ายข้ามระบบ ก็เช่นกัน |
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
| GET | `/feed/items` | `[{ id, name, emoji, unit, qty, stockSet, piecesPerKg(1 กก. กี่ชิ้น · null = ยังไม่เคยซื้อเป็นกิโล), active, sortOrder, forecast: { used, rounds(พออีกกี่รอบ), runsOutOn('YYYY-MM-DD' \| null = พอเกิน 30 วัน), perRound, low(< 2 รอบ) } }]` |
| POST | `/feed/items` | `{ name, emoji?, unit?('ชิ้น') }` → `{ id }` · ชื่อซ้ำ = 400 (ที่เคยลบ = เอากลับมา) |
| PATCH | `/feed/items/:id` | `{ name?, emoji?, unit?, active?, piecesPerKg? }` · ลบ (`active:false`) อาหารที่อยู่ในแผน = 400 |
| POST | `/feed/items/:id/buy` | `{ qty>0 }` หรือ **`{ kg>0, piecesPerKg>0 }`** (ซื้อเป็นกิโล → ชิ้น = round(kg × piecesPerKg) + จำ piecesPerKg ไว้ที่อาหาร) `+ priceTHB?, note?` → 204 · ไม่ส่งจำนวน/กิโลไม่บอกชิ้นต่อกิโล = 400 · ครั้งแรก = เริ่มนับสต็อกจากตรงนี้ |
| POST | `/feed/items/:id/count` | `{ qty≥0 }` หรือ `{ kg≥0, piecesPerKg }` นับใหม่ (มีจริงเท่านี้) → 204 · เก็บส่วนต่างเป็น ADJUST |
| GET | `/feed/items/:id/moves` | 40 รายการล่าสุด `[{ kind 'BUY'\|'USE'\|'ADJUST', qty(±), kg(ซื้อ/นับเป็นกิโล \| null), priceTHB, note, at, round: { feedDate, systemName } \| null }]` · บัญชีลงชื่อ "ซื้อหอย 2 กก." เมื่อซื้อเป็นกิโล |
| GET | `/feed/analysis?days(30–730 · ค่าเริ่มต้น 180)` | **วิเคราะห์อาหาร (P7)** ทั้งฟาร์ม → `FeedAnalysis` (ดูด้านล่าง) |
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
**วิเคราะห์อาหาร (P7)** — กติกาอยู่ที่ `src/lib/feedAnalysis.ts` (pure · สำเนาที่หน้าเว็บ demo ใช้)
- ไข่ขึ้นเร็วแค่ไหน: ปูไข่ (ไม่รวมที่ลบ) เช็ค `pct` 2 ครั้งติดกัน ห่าง 5–60 วัน = 1 ช่วง (ช่วงที่**จบ**ในช่วงที่ดู · ไข่ 100% แล้วไม่นับ) → % ต่อสัปดาห์ · อาหารที่กินในช่วงนั้น (รอบ `DONE` เท่านั้น: กินหมด 1 · กินน้อย ½ · ไม่กิน 0 · ต้อง ≥ 2 มื้อ) อาหารเดียว ≥ 70% = กลุ่มอาหารนั้น ไม่ถึง = ผสม (`itemId:null`) · สรุปได้เมื่อมี ≥ 2 อาหารที่มี ≥ 5 ช่วงจากปู ≥ 3 ตัว · ต่าง < 1%/สัปดาห์ = พอๆ กัน
- กินหมดแค่ไหน: ต่ออาหาร `score` = (กินหมด + กินน้อย/2) ÷ มื้อ · สรุปได้เมื่อมี ≥ 2 อาหารที่มี ≥ 20 มื้อ · ต่าง < 3 จุด = พอๆ กัน
- `FeedAnalysis = { from, to, days, items:[{id,name,emoji}], growth:{ groups:[{itemId\|null, intervals, crabs, perWeek}], verdict: {kind:'faster',fastId,slowId,diff} \| {kind:'same',ids,diff} \| {kind:'single',itemId\|null}(ให้อย่างเดียว) \| {kind:'not_enough',need:[{itemId,intervals,crabs}]} }, eating:{ items:[{itemId,meals,ate,little,none,score}], verdict: {kind:'better',bestId,worstId,diff} \| {kind:'same',ids,diff} \| {kind:'single',itemId} \| {kind:'not_enough',need:[{itemId,meals}]} }, totals:{crabs,intervals,meals} }`

⚠ ใหม่: `feeding_plan_missing` (menu `feed`, target `feed-plan`, `systemIds` = ระบบที่ยังไม่มีแผน) · `feed_stock_missing` (`feed`, `feed-stock-set`, `itemIds` = อาหารที่อยู่ในแผนแต่ยังไม่ใส่จำนวน · ยังไม่มีแผนเลย = ทุกอาหารถ้ายังไม่มีอันไหนใส่จำนวน) · `feed_low` (`feed`, `feed-low`, count, `itemIds`) · `feeding_review` (`crabs`, `crabs-feed-review`, count) · (2026-11-17 แยก target ของ 2 เรื่องสต็อก เดิมใช้ `feed-stock` ร่วมกัน)

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

⚠ ใหม่: `water_targets_missing` (menu `water`, target `water-targets`, count = ค่าที่วัดแต่ยังไม่มีเกณฑ์, `systemIds`) · `water_first_test` (`water`, `water-record`, `systemIds` = ตั้งเกณฑ์ครบแล้วแต่ยังไม่เคยวัด · ลำดับนำทาง ตั้งเกณฑ์ → วัดครั้งแรก) · `water_action` (`water`, `water-advice`, count = คำแนะนำที่ยังไม่ได้ทำ, `systemIds`)

## ขายปู (P6) — `/sales` · ต้องมีสิทธิ์ใช้งาน · ของคนอื่น = 404

ใบ 1 ใบ = ปูหลายตัวจากระบบเดียวกัน ลูกค้าคนเดียว · `status` `RESERVED`(จองไว้ — ปูยังอยู่ในกล่อง ป้าย 🔖) → `DONE`(ขายแล้ว — ปู `SOLD` ออกจากผัง ลงบัญชีวัน `soldAt`) · `CANCELLED`(ปูกลับเข้ากล่องเดิม)
ปูในใบถูกล็อกด้วย `Crab.saleId` (updateMany แบบมีเงื่อนไข) → ปูที่อยู่ในใบอื่น/ไม่ได้เลี้ยงอยู่แล้ว = **400 ทั้งใบย้อนกลับ** (2 เครื่องขายตัวเดียวกันพร้อมกัน = สำเร็จเครื่องเดียว)
ราคารายตัวคิดที่หน้าเว็บ (น้ำหนัก × ราคา/กก. ปัดบาท) แล้วส่งมา · ใบเก็บ **สำเนา** ชื่อ/กล่อง/น้ำหนัก/%/รูป ณ วันขาย (ใบเสร็จไม่เปลี่ยนตามทีหลัง)

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/sales?from&to(YYYY-MM-DD รวมวัน to · ไม่ส่ง = 90 วันล่าสุด)&status?` | ใบจอง **ทั้งหมด** + ใบที่ขาย (`soldAt`)/ยกเลิก (`cancelledAt`) ในช่วง → `[{ id, no, status, system:{id,name}, customer:{id,name,phone} \| null, total, count, weightG, photos(≤4), reservedAt, soldAt, cancelledAt, createdAt }]` |
| POST | `/sales` | `{ systemId, status 'RESERVED'\|'DONE', customerId?(จอง = บังคับ), soldAt?(ขายย้อนหลัง), note?, items:[{ crabId, price ≥0, pricePerKg?(null = ใส่ราคาเอง) }] ≥1 }` → 201 `SaleDetail` · เลขที่ใบ `no` นับต่อเจ้าของ |
| GET | `/sales/:id` | `SaleDetail = { id, no, status, system, customer, total, reservedAt, soldAt, cancelledAt, note, createdAt, items:[{ id, crabId, price, pricePerKg, name, place, type, weightG, pct, photoUrl, cost(ต้นทุนตัวนี้ · null = ล็อตยังไม่ใส่ราคา), crabStatus, lot:{id,receivedAt,costMissing} }] }` |
| PATCH | `/sales/:id` | `{ customerId?, soldAt?(เฉพาะขายแล้ว), note?, items?(ทั้งชุดใหม่ — ตัวที่หายไป = ปล่อยกลับเข้าผัง · ตัวใหม่ = ล็อก) }` · ใบจองเอาลูกค้าออก / ใบยกเลิกแล้ว = 400 |
| POST | `/sales/:id/done` | ใบจอง → ขายแล้ว `{ soldAt? }` (สำเนาน้ำหนัก/%/รูปล่าสุดใหม่) · ไม่ใช่ใบจอง = 400 |
| POST | `/sales/:id/cancel` | ยกเลิก (จอง/ขายแล้ว) → ปูกลับเข้ากล่องเดิม · รายรับหายจากบัญชี · ซ้ำ = 400 |

## บัญชี (P6) — `/ledger` · ต้องมีสิทธิ์ใช้งาน · ของคนอื่น = 404

หมวด (คำง่ายแทนศัพท์บัญชี): **ต้นทุนปู** `DIRECT` = `CRAB`(ซื้อปู*) `FEED`(อาหาร*) `SUBSTANCE` · **ค่าใช้จ่ายฟาร์ม** `INDIRECT` = `ELECTRIC` `WATER` `EQUIPMENT` `LABOR` `OTHER` · **รายรับ** `INCOME` = `SALE`(ขายปู*) `INCOME`(อื่นๆ)
\* ระบบลงให้ **อ่านจากต้นทางทุกครั้ง ไม่คัดลอกเก็บ**: ล็อตที่ใส่ราคา (`receivedAt`) · การซื้ออาหารที่ใส่ราคา (`FeedStockMove BUY`) · ใบที่ขายแล้ว (`soldAt`) → แก้ที่ต้นทาง = บัญชีเปลี่ยนตาม
ตาราง `LedgerEntry` เก็บแค่ที่ลงเอง + ค่าไฟจากตัวช่วย (เดือนละแถว `autoMonth`)

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/ledger?from&to` | (YYYY-MM-DD รวมวัน to · ไม่เกิน 13 เดือน) ใหม่ → เก่า `[{ key("sale:12"\|"lot:5"\|"feed:33"\|"m:7"), source 'LOT'\|'FEED'\|'SALE'\|'MANUAL'\|'ELECTRIC', category, group, amount(บวกเสมอ), at, title, detail, refId, systemName }]` · ลงค่าไฟเดือนที่ยังไม่ได้ลงให้ก่อนตอบ |
| POST | `/ledger` | ลงเอง `{ category(ไม่รวม CRAB/SALE), amount > 0, at, note? }` → 201 `{ id }` |
| PATCH | `/ledger/:id` | `{ category?, amount?, at?, note? }` → 204 · ค่าไฟจากตัวช่วยแก้ยอดได้ (ตัวช่วยไม่ทับอีก) เปลี่ยนหมวดไม่ได้ |
| DELETE | `/ledger/:id` | 204 · ค่าไฟจากตัวช่วย = ซ่อน (ไม่ลงเดือนนั้นซ้ำ) |
| GET | `/ledger/lots` | กำไรรายล็อต ใหม่ → เก่า `[{ lotId, systemId, systemName, receivedAt, seller, crabs, sold, dead, alive, reserved, cost \| null, costMissing, revenue, shared(ค่าอาหาร+ค่าฟาร์ม ประมาณ · ปัดบาท), profit, finished(ขาย/ตายหมด) }]` |
| GET | `/ledger/electric` | ตัวช่วยค่าไฟ `{ devices:[{key,name,watts,qty,hours}], rate, active, startMonth, monthly }` \| `null` (ยังไม่เคยตั้ง) |
| PUT | `/ledger/electric` | `{ devices(≤30), rate(บาท/หน่วย), active }` → ยอดเดือนนี้เปลี่ยนตาม (ถ้ายังไม่ได้แก้เอง) · เดือนก่อนๆ ไม่แตะ · ตั้งครั้งแรก/เปิดใหม่ = เริ่มเดือนนี้ · ปิด = เอาค่าไฟเดือนนี้ที่ลงให้ออก |

ค่าไฟ/เดือน = Σ(วัตต์ × จำนวน × ชม./วัน × 30 ÷ 1000) × ค่าไฟต่อหน่วย (ปัดบาท · เดือนละ 30 วันเท่ากัน)
**ส่วนแบ่งค่าอาหาร/ค่าฟาร์มของล็อต**: ค่าใช้จ่ายที่ไม่ใช่ซื้อปู/รายรับ รวมเป็นกองรายเดือน ÷ จำนวน "ตัว-วัน" ของปูทั้งฟาร์มในเดือนนั้น × ตัว-วันของล็อต (ตั้งแต่วันรับเข้าล็อต ถึงวันขาย/ตาย/วันนี้) · เดือนที่ไม่มีปู = ไม่มีใครรับ (`src/lib/profit.ts` — สำเนาที่หน้าเว็บ)

## ไอเดีย (P8) — `/ideas` · ต้องมีสิทธิ์ใช้งาน · ทุกคนเห็นของทุกคน
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/ideas?status&mine=1&sort=top\|new&skip&take` | `{ total, counts{PENDING,IN_PROGRESS,DONE,DECLINED}, nowBuilding, items: [Idea] }` · ไม่กรองสถานะ = ที่ยังเปิด (รอพิจารณา/กำลังทำ) ขึ้นก่อน แล้วตาม ❤ หรือใหม่สุด · `counts` ไม่ขึ้นกับสถานะที่กรอง |
| POST | `/ideas` | `{ title(3–120), body? }` → `Idea` 201 · ผู้เสนอได้ ❤ 1 เอง · วันละ ≤5 (429) |
| PATCH/DELETE | `/ideas/:id` | ของตัวเอง + ยัง `PENDING` เท่านั้น (ทีมงานรับเรื่องแล้ว = 400 · ของคนอื่น = 404) · ลบ = ❤ หายด้วย |
| PUT | `/ideas/:id/like` | `{ liked: boolean }` (สถานะที่ต้องการ ไม่ใช่สลับ) → `{ likeCount, liked }` · ยิงซ้ำ/พร้อมกันได้ผลเดิม |

`Idea` = `{ id, title, body, status, reply, repliedAt, likeCount, liked, mine, authorName('สมาชิก' ถ้าไม่มีชื่อ), createdAt, updatedAt }` — **ไม่มีอีเมลผู้เขียน** (หลังบ้านเท่านั้น)

## หมู่บ้านฟาร์ม (P9) — `/village` · ต้องมีสิทธิ์ใช้งาน
กติกา: ต้อง **เข้าร่วมหมู่บ้าน** ก่อนถึงจะเห็นคนอื่น/คนอื่นเห็นเรา · เข้าฟาร์มคนอื่นได้เมื่อทั้งคู่เข้าร่วม + (ระบบนั้น `villageOpen` หรือเจ้าของอนุญาตเรา) · เจ้าของเข้าฟาร์มตัวเองได้เสมอ · **แอดมินไม่มีสิทธิ์พิเศษ** · เข้าไม่ได้ = 404 · ข้อมูลคน = `VillagePerson { id, name, avatarUrl, farmAvatar }` (ไม่มีอีเมล)

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/village/me` | `{ me: VillagePerson, joined, systems[{id,name,villageOpen}], requests[คำขอรอเราตัดสิน {id,status,message,requestedAt,visitor}], visitors[คนที่เราอนุญาต], outgoing[{id,ownerId,requestedAt}], letters[จดหมายใหม่ในฟาร์มเรา {id,systemId,systemName,body,mood,createdAt,author}], replies[คำตอบใหม่ของจดหมายเรา {id,systemId,systemName,body,reply,repliedAt,owner}] }` |
| PUT | `/village/me/joined` | `{ joined: boolean }` · ออก = หายจากรายชื่อ + คนที่ยืนในฟาร์มเรา/เราที่ยืนในฟาร์มคนอื่นถูกพาออก (สิทธิ์ที่อนุญาตไว้ไม่ลบ) |
| PUT | `/village/me/avatar` | `{ skin?, face?, hair?, hairColor?, shirt?, shirtColor?, pants?, pantsColor?, hat?, hatColor?, accessory?, mount?, mountColor?, riding?, pet?, petColor? }` · `.strict()` · คีย์ `[a-z0-9_-]{1,24}` · สี `#rrggbb` เท่านั้น (ถูกวาดลง SVG ที่เครื่องคนอื่น) → `VillagePerson` |
| GET | `/village/users` | ยังไม่เข้าร่วม = **403** · `[VillagePerson + systems[{id,name,villageOpen,canVisit}], access 'SELF'\|'APPROVED'\|'OPEN'\|'PENDING'\|'DENIED'\|'NONE', accessId]` |
| POST | `/village/access` | `{ ownerId, message?(≤200) }` → 201 `{ id, status, alreadyApproved }` · ขอเข้าทุกระบบของเจ้าของ · ฟาร์มตัวเอง = 400 · เราไม่ได้เข้าร่วม = 403 · เจ้าของไม่อยู่ในหมู่บ้าน = 404 · เพิ่งถูกปฏิเสธ (< 1 วัน) = 429 |
| POST | `/village/access/:id/approve` · `/deny` | เจ้าของเท่านั้น (คนอื่น = 404) |
| DELETE | `/village/access/:id` | เจ้าของถอนสิทธิ์ / ผู้ขอยกเลิกคำขอ · แขกที่ยืนในฟาร์มถูกพาออกทันที · ขอใหม่ได้เลย |
| GET | `/village/farms/:systemId` | `{ system{id,name,layout,ownerId,villageOpen,owner}, boxes[{id,side,row,col,code, crabs[{id,name,type,cableTieColor,lastWeightG,lastPct,lastPhotoUrl,lastCheckedAt,days}]}], decor[], letters[], isOwner }` · ปูเฉพาะที่ยังเลี้ยงอยู่ · `days` = เลี้ยงมากี่วัน (จากวันรับล็อต) · **ไม่มีต้นทุน/ล็อต/คนขาย/ลูกค้าที่จอง/โน้ต** · จดหมาย: เจ้าของเห็นทุกฉบับ แขกเห็นของตัวเอง |
| PATCH | `/village/farms/:systemId` | `{ villageOpen }` เจ้าของเท่านั้น · ปิด = คนที่เข้ามาเพราะสวิตช์นี้ถูกพาออก |
| GET | `/village/farms/:systemId/logbook` | สมุดฟาร์ม: `{ params[{id,key,name,unit,color,min,max}], tests[10 ครั้งล่าสุด {id,testedAt,values[{paramId,value,status}]}] }` (ไม่มีโน้ต) |
| PUT | `/village/farms/:systemId/decor` | `{ items: [{ kind([a-z0-9_-]≤40), x,y(0–200), z?, rot?(0/90/180/270), scale?(50–200), flip?, variant? }] ≤300 }` · แทนที่ทั้งผัง → ผังใหม่ · เจ้าของเท่านั้น |
| GET/POST | `/village/farms/:systemId/letters` | POST `{ x, y, body(1–500), mood? }` → 201 · แขกเท่านั้น (เจ้าของ = 400) · ค้างได้ ≤20 ฉบับ/คน/ฟาร์ม |
| POST | `/village/farms/:systemId/letters/read-all` | เจ้าของอ่านทั้งฟาร์ม → `{ marked }` |
| POST | `/village/letters/:id/reply` | `{ reply(1–500) }` เจ้าของเท่านั้น · ตอบ = อ่านแล้ว · ผู้เขียนเห็น ⚠ อีกครั้ง |
| POST | `/village/letters/:id/read` | เจ้าของ = อ่านจดหมาย · ผู้เขียน = เห็นคำตอบแล้ว |
| DELETE | `/village/letters/:id` | ผู้เขียน หรือเจ้าของฟาร์ม (ซ่อน ไม่ลบจริง) |

⚠ ใหม่: `village_request` (`village`, `village-requests`, มี `count`) · `village_mail` (`village`, `village-mail`, `count` = จดหมายใหม่ + คำตอบใหม่)

## Realtime (WebSocket) — `ws(s)://<api-host>/ws`
ต่อด้วย subprotocol `['jwt', <accessToken>]` (ผิด/หมดอายุ = ปิดด้วย 4401 → refresh แล้วต่อใหม่) · server ส่ง `{ t:'hello' }`
client ส่ง `{ t:'subscribe', systemId }` (ระบบของตัวเองเท่านั้น — ไม่ใช่ = `{ t:'error' }`) / `{ t:'unsubscribe', systemId }` / `{ t:'ping' }`
server "เคาะ" `{ t:'feeding.changed', systemId }` ทุกครั้งที่รอบ/ผลการกินเปลี่ยน → client ไป `GET /feed/current` ใหม่ (ไม่มี payload — หลุดก็ไม่เพี้ยน)
`GET /health` → `realtime: { enabled, path }` · ปิดด้วย `REALTIME_ENABLED=false` (หน้าเว็บถอยไป polling 20 วิ)

**หมู่บ้าน (P9)** — ห้องเดินเล่นแยกจากห้องรอบให้อาหาร (แขกไม่ได้ `feeding.*`)
client: `{ t:'village.enter', systemId, x, y, f }` (เช็คสิทธิ์ครั้งเดียวตอนเข้า — ไม่มีสิทธิ์ = `{ t:'village.kicked' }`) · `{ t:'village.move', systemId, x, y, f }` (≤10 ครั้ง/วิ · บีบให้อยู่ 0–200 · ปัด 1 ตำแหน่ง) · `{ t:'village.emote', systemId, emote }` · `{ t:'village.leave', systemId }` · `f` = `'u'|'d'|'l'|'r'`
server: `village.entered {peers}` · `village.join {peer}` (เข้ามาใหม่ / แต่งตัวใหม่) · `village.leave {userId}` · `village.move` · `village.emote` · เคาะ `village.letter` / `village.decor` (ไป GET ใหม่) · `village.kicked` (ถูกถอนสิทธิ์/ฟาร์มปิด/ออกจากหมู่บ้าน) · `village.inbox` (ถึงตัวผู้ใช้ทุกเครื่อง: มีคำขอ/จดหมาย/คำตอบใหม่ → โหลด ⚠ ใหม่)
`PresenceUser = { userId, name, avatarUrl, farmAvatar, x, y, f }` — อยู่ในหน่วยความจำล้วน (ไม่แตะ DB) · ต่อไม่ได้ = หน้าเว็บเดินคนเดียวได้ (ไม่มี REST เขียนตำแหน่ง)
