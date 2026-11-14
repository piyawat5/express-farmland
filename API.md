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

redirect URI ที่ต้องลงทะเบียนในแต่ละ console: `<OAUTH_CALLBACK_BASE>/<provider>/callback` (dev: `http://localhost:3000/api/auth/oauth/<provider>/callback`)

## ล็อกอินแล้ว
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/auth/me` | โปรไฟล์ + `providers[]` + `access` (ดูด้านบน) · `emailIsPlaceholder` = อีเมลเทียมของ LINE/Facebook |
| PATCH | `/auth/me` | `{ name?, notifyEmail?, weightUnit? 'KHIT'\|'GRAM' }` · `notifyEmail: ''` หรือ `null` = ไม่ส่งอีเมล |
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

key ที่มีตอนนี้: `system_missing` (menu `crabs`, target `crabs-add-system`) · `first_lot_missing` (`crabs`, `crabs-intake`) · `lot_cost_missing` (`crabs`, `crabs-lots`, มี `count`) · `notify_email_missing` (`profile`, `profile-notify-email`)

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
| GET | `/systems/:id/grid` | `{ system, boxes:[{id,side,row,col,code}], crabs:[{id,boxId,name,type,sex,grade,cableTieColor,lastWeightG,lastPct,lastPhotoUrl,lastCheckedAt, lot:{id,receivedAt,costMissing}}] }` — ปูที่ยังเลี้ยงอยู่เท่านั้น |

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
