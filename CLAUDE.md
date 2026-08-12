# CLAUDE.md — express-farmland (Backend)

> ไฟล์นี้เป็น context หลักสำหรับ Claude ทุก session ใหม่ — อ่านก่อนเริ่มงานเสมอ
> อัปเดตทุกครั้งที่มี decision สำคัญ / สร้าง module ใหม่ / เปลี่ยน schema

## 👉 ทำต่อจากตรงนี้ (NEXT — session ใหม่อ่านตรงนี้ก่อน)
### 🏡 หมู่บ้านฟาร์ม + ลดคลิกบันทึกการกิน + แก้ทัวร์ไม่เด้ง (2026-08-12) — BE tsc + FE build ผ่าน, ✅ migration apply แล้ว, ✅ สโมคเทส REST 12 ข้อ + WS 12 ข้อผ่านหมด
แผน: `C:\Users\piyawat\.claude\plans\1-1-1-velvety-treasure.md`

**⚠️ ยังไม่ทดสอบบนเบราว์เซอร์จริง** — รอผู้ใช้เทส: เดินในฟาร์ม (คีย์บอร์ด+D-pad มือถือ), แต่งตัวละคร, วางของตกแต่ง, ขอ/อนุมัติเข้าชม 2 เครื่อง, เห็นกันเดินสด ๆ, ฝาก/ตอบจดหมาย

- **ข้อ 3 (บั๊กทัวร์ไม่เด้งหลัง OAuth) — root cause เจอแล้ว:** `stores/auth.ts:14` เขียน `computed(() => !!tokenStore.access && !!user.value)` — `tokenStore.access` อ่าน localStorage (**ไม่ reactive**) ตอนบูตหลัง OAuth ยังเป็น null → `&&` short-circuit → **`user.value` ไม่เคยถูกอ่าน → computed ไม่มี dependency เลย → cache `false` ถาวร** → watcher ใน `App.vue:66` ไม่ยิงซ้ำ. **ไม่ใช่แค่ทัวร์ที่พัง** — `startRealtime()`/`taskStore.refresh()`/`refreshIncome()` ก็ไม่ถูกเรียกด้วย (DashboardView เรียก `systemStore.load()` เองเลยบังอาการไว้). **แก้ = สลับลำดับให้อ่าน `user.value` ก่อน** (บรรทัดเดียว); เกิดกับ login email/password เหมือนกัน ไม่ใช่เฉพาะ OAuth
  - เสริม: `finishTour()` กดข้ามแล้ว**จำเสมอ** (เดิมไม่ติ๊ก checkbox = ไม่จำอะไรเลย → เด้งซ้ำทุก session) + เอา checkbox ที่ซ้ำซ้อนออกจาก `TourOverlay`; `hasSeenTour()` **เทียบ `tourVersion` แล้ว** (เดิมเขียนลง prefs แต่ไม่เคยเทียบ) + `watch` ใน TourOverlay เป็น `immediate`
- **ข้อ 2 (ลดคลิกบันทึกการกิน 3→2):** ตัดปุ่มเขียว "บันทึกการกินรอบนี้" ออก → `saveAll()` ใน `CrabsView.vue` ยิง `feedingApi.record()` ให้ทุกแท็บที่เลือกป้ายไว้ **ไม่แตะ backend เลย** (คะแนน/ตัวนับ/พลุ/หลอดพลังเหมือนเดิมเป๊ะ)
  - ⚠️ **ลำดับสำคัญ: record ก่อน → crabApi.update ทีหลังเสมอ** เพราะ `recordEntry` เขียน `Crab.feedingNote` + CrabHistory FEEDING ให้อยู่แล้ว พอ sync `f.feedingNote` ให้ตรงแล้วค่อย PATCH → diff เห็นว่าไม่เปลี่ยน จึง**ไม่เกิดแถวประวัติซ้ำ** (สลับลำดับ = โน้ตเก่าทับของใหม่)
  - ปูใหม่ระหว่างรอบเปิด: create ก่อนเอา id แล้วค่อย record (เดิมบันทึกการกินไม่ได้เพราะยังไม่มี id)
- **ข้อ 1 หมู่บ้านฟาร์ม (ฟีเจอร์ใหม่ทั้งก้อน) — migration `phase23_farm_village` ✅ apply ลง DB จริงแล้ว** (รวม 18 migrations):
  - **schema:** `CrabSystem.villageOpen Boolean @default(false)` + `User.farmAvatar Json?` + 3 model ใหม่ `FarmAccess`(+enum `FarmAccessStatus`)/`FarmDecor`/`FarmLetter`
  - ⚠️ **`villageOpen` ห้ามใช้ `publicEnabled` ซ้ำ** — `publicEnabled` คือหน้าร้าน QR ของลูกค้าที่**ไม่ได้ล็อกอิน** ถ้าใช้ร่วมกันจะกลายเป็น "เปิดร้าน = เปิดฟาร์มให้ทุกคน" และ "ปิดร้าน = เตะเพื่อนออก"
  - **สิทธิ์:** `lib/scope.ts` +`canViewFarm`/`visitableSystemIds`; `middleware/auth.ts` +`assertCanViewFarm`(**โยน 404 ไม่ใช่ 403** — 403 ทำให้ endpoint กลายเป็นเครื่องมือไล่เดา systemId)/`requireFarmView`
  - **BE ใหม่:** `services/village.service.ts` + `routes/village.ts` (mount `/api/village`) — ดูตารางครบใน [API.md](./API.md) หมวด H
  - ⚠️ **`GET /village/users` เป็นการอ่านข้ามผู้ใช้ครั้งแรกของแอป** (ทุก list เดิมกรองด้วย `ownerWhere`/`systemScopeWhere` หมด) — ใช้ `PUBLIC_USER_SELECT` เท่านั้น ห้าม `include` ทั้งแถว (passwordHash/uiPrefs/lineId จะรั่ว); `email` ให้เฉพาะ ADMIN
  - **`PUT .../decor` แทนที่ผังทั้งชุด** (ไม่ใช่ CRUD รายชิ้น) → ตัด logic reconcile optimistic update ทิ้งทั้งหมด; UI เป็นลากวางแล้วกดบันทึกทีเดียว
  - **แจ้งเตือน = derive ไม่มี model ใหม่:** `GET /village/inbox` นับจาก `FarmAccess.status='PENDING'` + `FarmLetter.readAt IS NULL` แล้ว push ผ่าน WS (model `Notification` เดิมผูกกับ `Task` + เป็นอีเมล ใช้ไม่ได้)
  - **WebSocket:** `ws.farmRooms` **แยกจาก `ws.rooms` เด็ดขาด** (rooms ส่ง `feeding.*` ที่มีรหัสปู/โน้ต/คะแนน — แขกต้องไม่ได้รับ); เช็คสิทธิ์ **ครั้งเดียวตอน `village.enter`** หลังจากนั้น `village.move` (10 Hz) เช็คแค่ `Set.has` ไม่มี query; refactor `publish()` → `broadcast(payload, inRoom, except)` + `publishFarm`(ไม่ echo กลับคนส่ง)/`publishToUser`(ป๊อปอัพ global)/`revokeFarmAccess`/`evictUnauthorizedVisitors`/`farmPresence`
    - `village.move` **ข้าม `serialize()`** สร้าง JSON string ตรง ๆ (เป็น path เดียวในระบบที่วิ่ง 10 ครั้ง/วิ/คน) + server ทิ้งเงียบถ้ามาถี่กว่า 80ms + clamp พิกัด
    - **ไม่มีตารางเก็บตำแหน่ง avatar** (อยู่ใน memory ล้วน) และ**ไม่มี presence registry** (scan `wss.clients` → cleanup ตอน disconnect ฟรี)
  - **FE ใหม่:** `stores/village.ts`, `lib/village/{avatarParts,catalog,world,walk}.ts`, `components/village/{FarmAvatar,AvatarEditor,FarmCanvas,DPad,DecorPalette,LetterDialog,VisitRequestPopup}.vue`, `views/{FarmVillageView,FarmSpaceView,MyFarmView}.vue`; เมนูกลุ่มใหม่ `village` ("หมู่บ้านฟาร์ม") ใน `NAV_GROUPS` + `hiddenRoutes` ใน router (route ที่มี param **ห้ามอยู่ใน `navRoutes`** ไม่งั้นเมนูขึ้นรายการที่คลิกแล้วพัง)
  - **เลือก DOM+SVG ไม่ใช่ `<canvas>`** — เหตุผลตัดสิน: `TourOverlay` วัดตำแหน่งด้วย `querySelector`+`getBoundingClientRect` ถ้าเป็น canvas จะใส่หมู่บ้านเข้าโหมดสอนไม่ได้เลย (+ ThemeDecor ใช้ไอดิออมนี้อยู่แล้ว, ~110 node เท่านั้น)
  - **ตกแต่ง 40 ชิ้น 5 หมวด** (`catalog.ts`) — `kind` เป็น String ไม่ใช่ enum → เพิ่มของใหม่ได้โดยไม่ต้อง migrate (precedent `CrabHistory.zone`)
  - **ทัวร์เพิ่ม 3 ขั้น** (village-my-farm / village-visit / village-letter) + `TOUR_VERSION = 2` → ทัวร์ 13 ขั้นจะเด้งใหม่ 1 ครั้งกับทุกคน (กดข้ามได้)
  - ⚠️ **anchor `data-tour` ต้องอยู่บน toolbar เท่านั้น ห้ามอยู่ในโลกที่ถูก transform** — `getBoundingClientRect` จะเพี้ยนทันทีที่กล้องเลื่อน
  - ⚠️ **`touch-action: none` ใส่เฉพาะปุ่ม D-pad** ห้ามใส่คอนเทนเนอร์โลก (มือถือจะเลื่อนหน้าไม่ได้) + จับ `pointercancel`/`pointerleave` ไม่งั้นนิ้วไถลออกจากปุ่มแล้วเดินไม่หยุด
  - ⚠️ **`stopRealtime()` ล้าง `handlers = []`** → `VisitRequestPopup` ต้องลงทะเบียน `onRealtime` ใน `watch(isAuthenticated)` **ไม่ใช่ `onMounted`** ไม่งั้น logout→login แล้วหูหนวกเงียบ ๆ
  - ⏭️ **ถ้า WS ใช้ไม่ได้บน Plesk** → หน้าฟาร์มยังเดินได้คนเดียว + ขึ้นชิป "ออฟไลน์ — คนอื่นมองไม่เห็นคุณ" และป๊อปอัพขอเข้าชมถอยไป poll ทุก 20 วิ (**ไม่มี REST endpoint เขียนตำแหน่ง** โดยตั้งใจ)

### 🔥 แก้เครื่องร้อนตอนบันทึกการกิน (backdrop-filter) (2026-08-02) — FE-only (farmland-web), `vue-tsc`+`vite build` ผ่าน, ไม่ต้อง migrate
- **ผู้ใช้รายงาน:** มือถือร้อนจี๋ตอนบันทึกการกินในหน้ากล่องปูช่วงมีรอบให้อาหารเปิดอยู่ — ตรวจแล้วไม่เกี่ยวกับ WebSocket/polling (`lib/realtime.ts` ปกติดี, backoff/interval สมเหตุสมผล) หรือแอนิเมชันปูขยับ/auto-scroll (transform-only, GPU-friendly) — **root cause = CSS `backdrop-filter: blur()`** (หนึ่งใน property ที่หนัก GPU มือถือสุด เพราะต้อง re-blur ทุกอย่างข้างหลังทุกเฟรม) ที่ทำงาน**ทุกครั้ง**ที่กดบันทึก ไม่ใช่แค่ตอนจบรอบ:
  - `FeedingQuestHud.vue` (HUD เลขเควสลอยกลางจอ) — โชว์ทุกครั้งที่บันทึก 1 ตัว นาน 2.5 วิ ซ้อนทับ dialog ปูที่มีแอนิเมชันข้างหลัง → เอา `backdrop-filter: blur(3px)` ออก (พื้นหลัง `rgba(20,24,32,0.86)` ทึบพอให้อ่านชัดอยู่แล้ว)
  - `FeedingCelebration.vue` (พลุฉลองจบรอบ) — สปาร์ค 70 ชิ้น `animation: infinite` **ไม่มี auto-dismiss** (ปิดได้ทางเดียวคือกดปุ่ม) → ถ้าผู้ใช้วางมือถือทันทีหลังบันทึกตัวสุดท้าย พลุ+blur ค้างไม่จำกัดเวลา (ตัวที่น่าจะร้อนที่สุด) → เอา `backdrop-filter: blur(2px)` ออก + เพิ่ม auto-dismiss timer 15 วิ (`watch(modelValue)` ตั้ง `setTimeout(close, 15000)`, mirror pattern `hideTimer` ของ QuestHud)
  - ไม่แตะแอนิเมชันอื่น (crab scuttle/legwiggle/clawwave, ThemeDecor, quest-pop, cb-firework keyframes) — ตรวจแล้วไม่ใช่ตัวปัญหา คงเอฟเฟกต์ภาพไว้เหมือนเดิม
- ⚠️ ยังไม่ทดสอบมือถือจริง (`vue-tsc`+`vite build` ผ่าน) — รอผู้ใช้เทสบันทึกรัว ๆ หลายตัว + บันทึกตัวสุดท้ายจบรอบแล้ววางมือถือทิ้งไว้ดูว่าพลุหยุดเองใน ~15 วิ + เครื่องไม่ร้อนเท่าเดิม

### 🎨 scroll อัตโนมัติไปโซนการกิน + ไอคอนขวดสารสีตามพารามิเตอร์น้ำ (2026-08-02) — FE-only (farmland-web), `vue-tsc`+`vite build` ผ่าน, ไม่ต้อง migrate
- **ข้อ 1 (auto-scroll โซน "การกิน" ตอนเปิด popup กล่องปู):** `CrabsView.vue` เดิมต้อง scroll หาโซนการกินเองทุกครั้งที่กดกล่อง (โซนอยู่ค่อนไปทางล่างของ popup) — เพิ่ม `feedZoneEls` (ref array ต่อแท็บ, ผูกกับ `<div class="zone-head">` ของโซนการกินผ่าน function ref `:ref="(el) => (feedZoneEls[i] = el)"`) + `scrollToFeedZone()` เรียก `scrollIntoView({behavior:'smooth', block:'start'})`; ทำงาน**เฉพาะตอนมีรอบให้อาหารเปิดอยู่** (`roundOpen`, ข้อมูลจาก Phase 21) — เรียกท้าย `openBox()` และใน `watch(activeTab, ...)` (สลับแท็บปูในกล่องเดียวกันก็เลื่อนตามให้ใหม่); ใช้ `nextTick()` + `setTimeout(300)` กัน dialog transition mount ช้ากว่า (mirror pattern `withScrollPreserved`)
- **ข้อ 2 (ไอคอนขวดสารเคมี SVG วาดเอง แทน mdi ทั่วไป):** ไฟล์ใหม่ `src/plugins/waterBottleIcons.ts` — วาดทรงขวดรีเอเจนต์ (ฝาเข้ม+คอคอด+ตัวขวด+แถบฉลากคาด) เป็น custom Vuetify icon set (`sets: { mdi, water: waterIconSet }` ใน `plugins/vuetify.ts`, เรียกผ่าน `waterParamIcon(param: WaterParam)` → string `water:<key>` ใช้กับ prop `icon`/`prepend-inner-icon` ได้เหมือน mdi ปกติทุกที่); สีตามที่ผู้ใช้กำหนด (แนบรูปขวดจริงอ้างอิงทรง): **Mg/Ca=ม่วง, แอมโมเนีย=เขียว, pH=น้ำเงิน, อัลคาไลน์=เทา, ไนไตรท์=แดง, โพแทสเซียม=ขาว** (เพิ่ม stroke เทาอ่อนกันหายกับพื้นการ์ดขาว) — Salinity ไม่ได้ระบุ เลือกฟ้าอมเขียวเอง
  - ปรับทุกจุดที่อ้างอิงพารามิเตอร์น้ำใน FE: `WaterView.vue` (ช่องกรอกค่า + ตารางค่าเป้าหมาย + ตารางประวัติ + หัว dialog ตั้งเป้า), `CrabsView.vue` (แถบชิปค่าน้ำล่าสุด), `DosingView.vue` (ตาราง calibration/rules + dropdown เลือกพารามิเตอร์)
  - พรีวิวไอคอนทั้ง 8 ตัวก่อนใช้งานจริง: artifact `water-bottle-icons-preview.html` (ให้ผู้ใช้ดูก่อนคอนเฟิร์ม)
- ⚠️ ยังไม่ทดสอบ browser จริง (`vue-tsc`+`vite build` ผ่าน) — รอผู้ใช้เทสเปิดกล่องปูช่วงมีรอบให้อาหารดู scroll อัตโนมัติ + ดูหน้า "น้ำ & ปรุงน้ำ"/"คลังสาร"/หน้าปูว่าไอคอนขวดสีถูกใจไหม

### 🐞 แก้บั๊กฟีดแบ็ค 2 ข้อ: คะแนนกินอาหารชนิดเดียว + พลุฉลองไม่ขึ้นทุกจอ (2026-08-02) — BE tsc + FE build ผ่าน, ✅ backfill DB จริงแล้ว, ไม่ต้อง migrate
- **ข้อ 1 (`scoreFromTags` เข้าใจผิดว่ารอบให้อาหาร 2 ชนิดเสมอ):** `lib/feedingCycle.ts` เดิมให้ 100 คะแนนต้องติ๊ก**ทั้ง** `กินปลาปกติ`+`กินหอยปกติ` — รอบที่ให้อาหารชนิดเดียว (ผู้ใช้ให้ทีละอย่างจริง ไม่เคยให้พร้อมกัน) ติ๊กแค่ 1 แท็กเลยได้ 65 (กินบางส่วน) ทั้งที่กินหมดแล้ว. แก้เป็นแยกแท็ก "ปฏิเสธชัดเจน" (`ไม่กินปลา`/`ไม่กินหอย`) ออกจาก "ไม่มีข้อมูล" (ไม่ติ๊กเลยเพราะไม่ได้ให้ชนิดนั้น) — มีแท็ก "กินปกติ" อย่างน้อย 1 + ไม่มีแท็กปฏิเสธเลย = 100; มีทั้งกินปกติ+ปฏิเสธ (ให้ 2 ชนิด กินแค่ 1) ยังคงเป็น 65 เหมือนเดิม (กินบางส่วนจริง)
  - **backfill รอบเก่า** (ผู้ใช้ยืนยันต้องการ): สคริปต์ one-off คำนวณ `FeedingEntry.score` ใหม่จาก `tags` ที่บันทึกไว้ + sync `FeedingRound.avgScore`/`normalCount` ของรอบ `COMPLETED` — รันแล้ว **แก้ไป 98/117 entries + 3/3 rounds** ลง DB จริง (ลบสคริปต์ทิ้งหลังรันเสร็จ ไม่ commit)
- **ข้อ 2 (พลุฉลองขึ้นแค่จอคนปิดรอบคนสุดท้าย ทั้งที่ตัวนับ HUD อัปเดตทุกจอ):** ตรวจ backend (`feeding.service.ts` `evaluateAndMaybeComplete`/`refreshAndPublish`) แล้วว่า broadcast `feeding.completed` ไปหาทุก socket ในห้องถูกต้องอยู่แล้ว — บั๊กอยู่ FE ล้วน (`CrabsView.vue`) 2 จุดอิสระกัน:
  - **(2a)** guard กันฉลองซ้ำใช้ `localStorage` (share กันทุกแท็บ/หน้าต่างของเบราว์เซอร์เดียวกัน) → แท็บที่ได้ event ทีหลังโดนบล็อกทั้งที่เป็นคนละจอจริง. แก้เป็น `sessionStorage` (private ต่อแท็บ แต่ยังอยู่รอด reload หน้าเหมือนเดิม)
  - **(2b)** จอที่ตกไปโหมด polling (WS หลุด/ต่อไม่ติด) ไม่มีทางรู้ว่ารอบปิดแล้ว เพราะ `getCurrentRound()` query แค่ `status:'OPEN'` — พอรอบ COMPLETED endpoint คืน `null` ทันที, `applyRound(null)` แค่เคลียร์ HUD ไม่มีโอกาสเห็นรอบจบเลย. แก้ `loadFeeding()`: ถ้า `current` คืน `round:null` แต่ก่อนหน้านี้ยังถือรอบ `OPEN` อยู่ → ดึงรอบเดิมซ้ำผ่าน `feedingApi.get(roundId)` (เพิ่ม endpoint ใหม่ในหน้า service ผูกกับ route `GET /feeding-rounds/:id` ที่มีอยู่แล้วแต่ FE ไม่เคยเรียก) เอาสถานะ COMPLETED สุดท้ายมาก่อนเคลียร์ กันพลาดพลุ
- ไม่ต้อง migrate ทั้ง 2 ข้อ (แก้ pure function + FE logic เท่านั้น); แก้ comment ไม่ตรง `schema.prisma` `FeedingEntry.score` ให้ตรง logic ใหม่ด้วย (ไม่กระทบ migration)
- ⚠️ ยังไม่ทดสอบ browser จริง (tsc/build ผ่าน) — รอผู้ใช้เทสให้อาหารชนิดเดียวจนจบรอบ + เทส 2 จอ/แท็บปิดรอบพร้อมกันดูว่าเห็นพลุทั้งคู่

### 🍤 แผนให้อาหาร + รอบบันทึกการกิน (realtime) + โหมดสอน + ธีม + รายงานมือถือ (2026-07-31) — BE tsc + FE build ผ่าน, ✅ migration apply แล้ว, ✅ smoke test BE ผ่านหมด
แผน: `C:\Users\piyawat\.claude\plans\1-theme-sharded-quiche.md`
- **migration ใหม่ 2 ตัว ✅ apply ลง DB จริงแล้ว** (รวมเป็น 17 migrations): `phase21_feeding_rounds` (3 ตารางใหม่ `FeedingPlan`/`FeedingRound`/`FeedingEntry` + enum `FeedingRoundStatus` — **ไม่ ALTER ตารางเดิมเลย**) และ `phase22_user_ui_prefs` (`User.uiPrefs Json?`)
- **ข้อ 2 แผนให้อาหาร (BE):** `lib/feedingCycle.ts` (pure, mirror `lib/cron.ts`) — `isFeedDay`/`nextFeedRunAt`/`ymdLocal`/`previewFeedDays`/`scoreFromTags`; วงรอบ "ให้ N วัน เว้น M วัน" คำนวณจาก `anchorDate` เพราะ **cron เขียนไม่ได้** (คาบไม่หารลงตัวกับเดือน). ทดสอบครบ 5 รูปแบบ (1/0, 1/1, 2/1, 3/1, 2/2) + modulo ติดลบ (anchor อนาคต)
  - ⚠️ **ห้ามใช้ `toISOString().slice(0,10)` ทำ `feedDate`** — เป็น UTC ทำให้ช่วง 00:00–07:00 น. ได้วันเมื่อวาน (ยืนยันแล้วว่าเกิดจริง) → ใช้ `ymdLocal` เท่านั้น
  - **ตั้งใจไม่ผูกกับ `ReminderRule`**: ถ้าผูก การกด "ทำเสร็จแล้ว" จะไป recompute `nextRunAt` ด้วย `minAdvance` (`task.service.ts:226`) → วงรอบหลุด anchor. สร้าง `Task` ตรง ๆ (`ruleId=null`, `linkType:'FeedingRound'`) 2 ใบต่อรอบ (`FEEDING` + `SCRAP_COLLECT`) → ได้เมลสรุป/หน้างาน/ปฏิทินครบเหมือนเดิม
  - `services/feeding.service.ts` + `routes/feeding.ts` (mount `/systems` + `/feeding-rounds`) + resolver `systemIdFromFeedingRound`; `scheduler.tick` เรียก `generateFeedingRounds` + มี `feedingRounds` ใน `TickResult`
  - **เปิดรอบ 2 ทาง (idempotent):** tick + lazy ตอน `GET .../feeding-round/current` — กันชนด้วย `@@unique([systemId, feedDate])` (จับ P2002)
  - **ไม่ regress ของเดิม:** `recordEntry` เขียน `Crab.feedingNote`/`lastFedAt` + `CrabHistory` โซน FEEDING (คีย์ `feedingNote`/`fedAt` เดิม) — บันทึกซ้ำตัวเดิม = **update แถวประวัติเดิม ไม่สร้างซ้ำ** (`FeedingEntry.historyId`); `lastFedAt = round.dueAt` ไม่ใช่ `now` (บันทึกตอนเก็บเศษ ช้ากว่า 2–3 ชม.)
  - **ปิดรอบครั้งเดียวเสมอ:** conditional `updateMany({id, status:'OPEN'})` → 2 คนกดตัวสุดท้ายพร้อมกัน มีคนเดียวที่ `count===1` → พลุไม่ซ้ำ
- **ข้อ 2.6 WebSocket (`ws`):** `lib/realtime.ts` เกาะ `server` handle ใน `server.ts` (ไม่แตะ `createApp` → ไม่มี import cycle); **auth ผ่าน subprotocol `['jwt', token]`** (browser ตั้ง header ไม่ได้), ห้อง = systemId (สิทธิ์จาก `ownedSystemIds` ครั้งเดียวตอนต่อ), heartbeat 30 วิ, `closeRealtime()` ก่อน `server.close()` (ไม่งั้นค้าง); env ใหม่ `REALTIME_ENABLED`/`WS_PATH`/`WS_HEARTBEAT_SEC`; `GET /api/health` คืน `realtime:{enabled,path}`
  - **FE ถอยเป็น polling อัตโนมัติ** ถ้าต่อไม่ติดใน 4 วิ หรือหลุด 2 ครั้งติด (เผื่อ Plesk/Passenger ไม่ proxy upgrade) — payload เหมือนกันเป๊ะ ไม่ต้องแก้ server
- **FE (`CrabsView` เป็นหลัก):** `lib/realtime.ts` (client + fallback), `feedingApi`, `components/FeedingPlanDialog.vue` (preset วันเว้นวัน/2เว้น1/3เว้น1/2เว้น2 + พรีวิว 14 วัน), `FeedingQuestHud.vue` (เลขเควสกลางจอ ข้อ 2.4), `FeedingCelebration.vue` (พลุ + สถิติเวลา/กินปกติ ข้อ 2.5), แถบรอบ + **ป้าย 🍤 บนกล่องที่ยังบันทึกไม่ครบ (ข้อ 2.7)** + ปุ่ม "บันทึกการกินรอบนี้" ทีละตัวใน popup + **โหมดหลอดพลัง** (`v-btn-toggle`, เฉลี่ย 5 รอบล่าสุด ข้อ 2.3)
- **ข้อ 3 โหมดสอน:** `lib/tour.ts` (11 ขั้น: รับปูเข้าล็อต → ตารางกล่อง → แผนอาหาร → บันทึกการกิน → หลอดพลัง → วัดค่าน้ำ → งาน → จองปู → ใบเสร็จ → รายงาน) + `components/TourOverlay.vue` (spotlight เจาะรูด้วย `box-shadow 0 0 0 9999px`, พาข้ามหน้าเอง, **หา target ไม่เจอ → ถอยเป็นการ์ดกลางจอ ไม่ค้าง**); `data-tour` 8 จุดใน CrabsView/WaterView/CommerceView; จำต่อ user ที่ `User.uiPrefs` + `PATCH /api/auth/me/prefs` (+ localStorage กันกระพริบ); เล่นซ้ำได้จากเมนูโปรไฟล์
- **ข้อ 1 ธีม:** `.theme-decor` เปลี่ยน `position:absolute; inset:0` → **`position:fixed` + `top:var(--v-layout-top)`** (Vuetify ตั้งตัวแปรนี้บน `v-main`) → แก้ทั้ง "โคมโดน navbar ทับ" และ "ของยึดล่างไปอยู่ก้นเพจ" ทีเดียว; คริสต์มาส **ต้นไม้ → สโนว์แมน** (มุมบน), สิงโต/เด็กสงกรานต์ย้ายขึ้นบน, opacity 0.13→0.18; **สงกรานต์รื้อใหม่** (สายน้ำโค้ง + เจดีย์ทรายมีธง + ขันเงิน + ดอกคูนร่วง + น้ำสาดเป็นวง แทนหยดน้ำตกตรง ๆ ที่ดูเป็นฝน); วาเลนไทน์ไม่แตะ
- **ข้อ 4 รายงานมือถือ:** `components/ScrollHint.vue` (เงาขอบ + **ลูกศรกลมลอยกดเลื่อนได้**, ตรวจด้วย ResizeObserver/MutationObserver) ใช้กับ dialog ไซส์/ราคา + dialog ต้นทุน + ตารางรายงานหลัก; ช่อง input ใส่ `min-width` (เรท 94px / ตัวเลข 104px)
- ✅ **smoke test BE ผ่านหมด** (สร้าง user ชั่วคราว → ลบทิ้งแล้ว): พรีวิววงรอบ, WS 2 เครื่องเห็นตัวนับพร้อมกัน, token ผิด→4401, celebrated ครั้งเดียว, ประวัติ FEEDING ไม่ซ้ำตอนแก้ซ้ำ, ปิดรอบ→Task DONE ทั้ง 2 ใบ, หลอดพลัง (ลืมบันทึก≠0), lazy open + nextDueAt ไม่ค้าง, uiPrefs merge
- ⚠️ **ยังไม่ทดสอบบนเบราว์เซอร์จริง** — รอผู้ใช้เทส: ฉากธีมแต่ละเทศกาล (5 ธีม × light/dark × มือถือ), ตั้งแผนอาหาร + บันทึก 2 เครื่องพร้อมกัน (ตัวนับ + พลุต้องขึ้นทั้งคู่), โหมดสอน, ตารางไซส์/ราคาบนมือถือ
- ⏭️ **ถ้า WS ใช้ไม่ได้บน Plesk จริง** → ตั้ง `REALTIME_ENABLED=false` ก็จบ (หน้าเว็บทำงานต่อได้ด้วย polling ทุก 5 วิ ไม่ต้องแก้โค้ด)

### 🐞 รอบฟีดแบ็ค 6 ข้อ: freeze รายงาน + ผู้ซื้อในรายงาน + อายุปู + รับล็อต + ฉากธีม + ดัก disabled รูป (2026-07-30) — FE-only, `vue-tsc`+`vite build` ผ่าน, ไม่ต้อง migrate
- **ข้อ 1 (freeze cell รายงานทับ):** คอลัมน์ "ราคาล็อต" ใช้ rowspan → กฎ `.freeze-first td:first-child` (global.css) ไปตรึง "กล่อง No" ของแถวต่อเนื่องแทน (ทับตอนเลื่อน X); แก้ใน `styles/global.css` เพิ่ม override `.v-table.freeze-first.report-table` → `td:first-child{position:static}` + `td.lot-cell{position:sticky;left:0}` (เพิ่มคลาส `.report-table` = specificity สูงกว่า ชนะกฎทั่วไป)
- **ข้อ 2 (รายงานไม่โชว์ผู้ซื้อ):** ปูที่ขายแล้ว txn เป็น `DONE` (ไม่ใช่ QUOTE/CONFIRMED) + `crab.buyerId` ถูกเซ็ต; `lib/reservations.parseReservationContacts` เดิมนับแค่ QUOTE/CONFIRMED → เพิ่ม `DONE`; `ReportView` reserver = `c.buyerId ?? reservationContacts.get(id)` (buyerId เป็น source of truth), header "ผู้จอง"→"ผู้จอง/ผู้ซื้อ"
- **ข้อ 3 (อายุปู "14d" ไม่แสดง):** `CrabsView.ageDays` เดิมใช้แค่ `purchaseDate` → ปูที่เพิ่มผ่านหน้ากล่อง (ไม่กรอกวันซื้อ) = null; แก้เป็น `daysSince(purchaseDate ?? lastCheckedAt)` (lastCheckedAt ดีฟอลต์วันนี้ตอนสร้างปูใหม่)
- **ข้อ 4.1 (รับล็อตไม่มีช่องราคา):** ย้ายช่อง "ราคารวมทั้งล็อต" ไปโซน "ค่าตั้งต้นของล็อต" (แสดงตั้งแต่ต้น ไม่ต้องรอบันทึกปูตัวแรก); ตารางแบ่งราคาตามน้ำหนักยังอยู่ล่าง
- **ข้อ 4.2 (ปิด dialog กลางคันไม่รีเฟรช):** `watch(intakeDialog)` — ปิดโดยไม่กด "จบล็อต" ขณะมีปูบันทึกแล้ว (`intakeList.length>0 && !intakeFinishing`) → `withScrollPreserved(reload)`
- **ข้อ 4.3 (จัดล็อตย้อนหลัง + โชว์ล็อต):** เพิ่ม dialog "จัดล็อตย้อนหลัง" (`retro*`) — เลือกปูที่เลี้ยงอยู่ (มีปุ่ม "เลือกที่ยังไม่มีราคา") + กรอกผู้ขาย/วันที่/ราคารวม → set `sourceSellerId`+`purchaseDate` เท่ากัน + แบ่ง `purchasePrice` ตามน้ำหนัก + ลง BUY; เพิ่ม `sourceSellerId` เข้า CrabForm + v-select "ผู้ขาย (ที่มา/ล็อต)" + ป้าย "ล็อต: <วันซื้อ> · <ผู้ขาย>" ในโซนที่มา&ต้นทุน; intake `saveIntakeCrab` เซ็ต `sourceSellerId` ให้ตรงกลุ่มล็อตด้วย (`crabBody` zod มี sourceSellerId อยู่แล้ว ไม่ต้องแก้ BE)
- **ข้อ 5 (ฉากอนิเมชันตามธีม):** ไฟล์ใหม่ `components/ThemeDecor.vue` (SVG/CSS ล้วน, pointer-events:none, `prefers-reduced-motion` ปิด) mount ใน `App.vue` ใต้ `v-main` (`.app-main{position:relative}` + `.app-content{z-index:1}` ให้ฉาก absolute อยู่หลังเนื้อหา): christmas=ต้นคริสต์มาส+หิมะตก, cny=เชิดสิงโต+โคม+พลุ, valentine=หัวใจจาง+ลูกโป่งหัวใจลอย, songkran=เด็กเสื้อลายดอกถือปืนฉีดน้ำ+หยดน้ำ; base=ไม่มีฉาก
- **ข้อ 6 (ดัก disabled ปุ่มบันทึกตอนอัปรูป):** เดิมปุ่มบันทึก **ไม่** disable ระหว่างอัปรูป → กดก่อนอัปเสร็จ = รูปไม่ถูกแนบ; เพิ่ม `:disabled="imgUploading"` ให้ปุ่ม saveAll (หน้ากล่อง) + saveIntakeCrab (รับล็อต), `:disabled="editHistUploading"` ให้ saveEditHist (แก้รอบ) + ป้าย "กำลังอัปโหลดรูป…"
- ⚠️ ยังไม่ทดสอบ browser จริง (build ผ่าน) — รอผู้ใช้เทส freeze รายงานเลื่อน X, ผู้ซื้อในรายงาน, ฉากธีมแต่ละเทศกาล, จัดล็อตย้อนหลัง

### 📊 เมนู "รายงาน" (Report) แบบ Excel + แยกบัญชีต่อระบบ + อนิเมชันปู (2026-07-29) — BE tsc + FE build ผ่าน, ✅ migration apply แล้ว
แผน: `C:\Users\piyawat\.claude\plans\lexical-humming-church.md`
- **migration ใหม่ `phase20_report_settings`** ✅ apply ลง DB จริงแล้ว: `CrabSystem.reportSettings Json?` เก็บ `{ fixedCosts:[{label,monthly}], daysPerMonth, boxCount, sizeTiers:[{label,minG,maxG,pricePerKilo,divisorG}] }`; zod ใน `routes/systems.ts` + `normalizeSystemData` (null→`Prisma.DbNull` mirror `receiptSettings`); regenerate client แล้ว
- **ข้อ 6 แยกบัญชีเด็ดขาดต่อระบบ:** `dashboard.service.financeSummary` เมื่อมี `systemId` กรอง `{ systemId }` ตรงๆ (เลิก `OR:[{systemId},{systemId:null}]`); รับ flag `includeUnassigned` (ดีฟอลต์ false) เผื่อ caller เดิมอยากได้ merged — `GET /api/dashboard/finance?...&includeUnassigned=true`; `overview` เรียก financeSummary strict (pendingTasks ยังนับ systemId=null ของ RESTOCK ตามเดิม)
- **FE deps ใหม่:** `xlsx` (SheetJS, gen .xlsx) + `x-data-spreadsheet` (สเปรดชีต canvas โหมด Excel) + `less` (dev, ให้ Vite คอมไพล์ `.less` ของ x-data-spreadsheet — import จาก main package ไม่ใช่ dist ที่ผูก window global)
- **หน้าใหม่ `ReportView.vue` route `/report` group `commerce` "รายงาน":** โหลดปู+box+txn+contact ของระบบที่เลือก; **สูตร:** `costPerBoxDaily = Σmonthly/daysPerMonth/boxCount`; `กำไร(3.8)=costPerBoxDaily×Day` (ค่าดำเนินการ ตามที่ผู้ใช้เลือก); `ราคาต้นทุนทั้งหมด(3.9)=กำไร+ต้นทุนปู`; `ราคาตลาด(3.10)=weightG×pricePerKilo/divisorG`; `ราคาล็อต(3.1)=Σต้นทุนในล็อต` (lotKey=`purchaseDate|sellerId`, rowspan+freeze คอลัมน์แรก); `ผู้จอง(3.11)` จาก `parseReservationContacts` (SELL QUOTE/CONFIRMED, helper ใหม่ใน `lib/reservations.ts`)
- **UI:** การ์ดสรุปต้นทุน + dialog ตั้งค่าต้นทุน/ตั้งค่าไซส์ (persist `systemApi.update({reportSettings})`); v-table `.freeze-first` + กรองรายคอลัมน์ (เมนู checkbox เรท/ผู้จอง + chip สถานะ + ค้นหา); ปุ่มดาวน์โหลด Excel (3 sheet: รายงาน/ต้นทุน/เรทไซส์); toggle โหมด spreadsheet เต็ม (mount x-data-spreadsheet mode:read ลง `ref`, teardown ตอน unmount/สลับ)
- **ข้อ 5 อนิเมชันปู:** `CrabsView` เพิ่มปู SVG ต่อกล่องที่มีปู (สีตาม cableTieColor ตัวแรก) + CSS keyframes scuttle/legwiggle/clawwave, `prefers-reduced-motion` ปิด, `pointer-events:none` z-index หลังแถวปู
- ⚠️ **defaults sizeTiers/ตัวหาร:** divisorG ดีฟอลต์ = maxG ของเรท (ตีความ "max ของเรทน้ำหนัก" จากภาพ 2) — เลข divisorG ในภาพเขียนมือ (333/250/142) ให้เลขต่างจากชีต Excel (261) ผู้ใช้แก้เองในหน้าตั้งค่าไซส์ได้; ยังไม่ทดสอบ browser จริง (BE tsc + FE build ผ่าน)

### 🧪 เพิ่มโพแทสเซียม (K) เข้าส่วนปรุงน้ำ (2026-07-28) — BE typecheck + FE build ผ่าน, ✅ migration apply แล้ว
- **migration ใหม่ `phase19_water_potassium`** ✅ apply ลง DB จริงแล้ว: `WaterTest.potassium Decimal(6,2)?` (ppm) + เพิ่ม `POTASSIUM` ใน enum `WaterParam` (MODIFY 3 คอลัมน์ที่ใช้ enum: `WaterTarget/DosingRule/DosingCalibration.parameter`); regenerate client แล้ว
- ทำ K เป็นพารามิเตอร์น้ำ**เต็มรูปแบบเหมือน Ca/Mg** (วัดได้ + ตั้งเป้า min/max + คำนวณ dose ผ่าน calibration): BE `dosing.service.PARAM_FIELD` +`POTASSIUM:'potassium'`, `water.service.WATER_FIELDS` +`'potassium'`, zod `waterParam`/`waterValues` ใน `routes/water.ts`+`routes/dosing.ts`; FE `types/api.ts` (`WaterParam` union + `WaterTest.potassium`), `WaterView` (PARAMS/WaterValues/emptyValues/cleanValues/testToValues, ไอคอน `mdi-alpha-k-box-outline` label "Potassium (K)"), `DosingView.paramOptions`, `CrabsView.WATER_ROWS` (label "K")
- **สาร "โพแทสเซียม" (MINERAL, หน่วยช้อนแกง):** เพิ่มใน `seed.ts` + **insert เข้า DB จริงให้เจ้าของระบบทุกคนแล้ว** (script ชั่วคราว upsert `ownerId_name`, ไม่รัน seed เต็มเพื่อกัน clobber reminder rules) — jame(1)/line(5)/line(9)/mech(7) ได้ substance id 18-21; WaterTarget POTASSIUM ไม่ backfill (สร้างตอน user ตั้งเป้าผ่าน UI ได้เอง เหมือนพารามิเตอร์อื่นที่ยังไม่ตั้ง)
- ⚠️ ยังไม่ทดสอบ browser จริง (BE `tsc` + FE `vue-tsc`+`vite build` ผ่าน) — รอผู้ใช้กรอกค่า K + ตั้งเป้า + ตั้ง calibration/dosing rule ของโพแทสเซียม

### 🔧 รอบฟีดแบ็ค 9 ข้อ: บั๊กรอบถัดไป + รื้อรับปูเข้าล็อต + icon ทุก input (2026-07-27) — BE typecheck + FE build ผ่าน, ไม่ต้อง migrate
- **ข้อ 1 (บั๊กรอบถัดไปไม่นับจากวันปิดงาน):** `reminder.computeNextRunAt(rule, after, {minAdvance})` เพิ่ม opt `minAdvance` — บังคับ +1 รอบเต็มเสมอ; `task.completeTaskManually` เรียกด้วย `{minAdvance:true}` → ปิดงานทุก 12 วันวันที่ 22 → รอบถัดไป = 3 ส.ค. (เดิม: ปิดช่วงก่อนเวลา timeOfDay 08:00 → `while` คืน "วันเดิม 08:00" (บวก 0 รอบ) → tick เด้งงานใหม่วันรุ่งขึ้น). createRule/generateDueTasks **ไม่ใช้** minAdvance (คงเดิม)
- **ข้อ 6 (เอาเตือนเช็คไข่ CRAB_CHECK ออก):** BE `scheduler.tick` เลิกเรียก generateCrabCheckTasks + **ลบไฟล์ `crabCheck.service.ts`** + เพิ่ม `cancelCrabCheckTasks()` (updateMany PENDING CRAB_CHECK→CANCELLED ทุก tick, idempotent กวาดของเก่า); FE ลบ settings `eggCheckDays/meatCheckDays` (settingsForm) + ป้ายบนกล่อง (`checkDue`/`boxHasDue`/`.crab-due`/`.box-due`) — enum `CRAB_CHECK` ยังอยู่ใน schema/routes (ไม่ migrate)
- **ข้อ 9 (รื้อ "รับปูเข้าล็อต" เป็นทีละตัว + คิดต้นทุนทีหลัง):** เดิมต้องกรอกน้ำหนักครบทุกตัวก่อนบันทึก = ผิดขั้นตอนจริง (หยิบทีละตัว→ส่องไข่/แนบรูป/ชั่ง→บันทึก→ตัวถัดไป). ใหม่ = **wizard ทีละตัว** (`intakeDialog`): เลือกกล่อง(paint)→`openIntake` → กรอกปูตัวเดียว (กล่อง dropdown/น้ำหนัก/ไข่%/สีเคเบิ้ลไทล์/รูป) → `saveIntakeCrab` **สร้างปูทันที** (status FATTENING, purchasePrice null) → เคลียร์ฟอร์มไปกล่องถัดไป (`intakeQueue`); จบล็อต `finishIntake` = ใส่ราคารวม → แบ่งตามน้ำหนัก PATCH purchasePrice ทุกตัว + ลง BUY (คิดต้นทุนทีหลัง); ลบของเดิม (`batchForm/allocations/setCount/saveBatch`)
- **ข้อ 2/5/7 (CalendarView):** (2) default chip เหลือ `pending` อย่างเดียว; (5) popup โชว์ "ประวัติรอบที่ผ่านมา" (`historyFor`/`detailHistory` คำนวณจาก tasks ที่โหลดมา — ไม่ยิง API); (7) เลยกำหนด>5วัน = `v-alert` แดง `isVeryLate`
- **ข้อ 7/8 (TasksView):** (8) จัดกลุ่มตามประเภทงาน (`groupedTasks` + `TYPE_ORDER`/`typeIcon` subheader); (7) แถวเลยกำหนด>5วัน = `.task-very-late` (ขอบ+พื้นแดง) + chip แดง "เลย N วัน"; popup = alert แดง
- **ข้อ 3 (App.vue navbar):** ถุงเงินขวาบนเปลี่ยน `finance().totalIncome` → `.net` (กำไรสุทธิ, แดงถ้าติดลบ)
- **ข้อ 4 (icon ทุก input):** ใส่ `prepend-inner-icon` ให้ text-field/select/textarea ทุกฟอร์ม (Water/Dosing/Reminders/Ledger/Inventory/Substances/Commerce/Dashboard/PublicShop/Crabs/Tasks/Calendar) — v-switch/v-file-input คงเดิม (มีไอคอนอยู่แล้ว)
- ⚠️ ยังไม่ทดสอบ browser จริง (BE `tsc` + FE `vue-tsc`+`vite build` ผ่าน) — งาน CRAB_CHECK ค้างเก่าจะถูกยกเลิกอัตโนมัติเมื่อ scheduler tick รอบถัดไปยิง

### 🗓️ ปฏิทินกรองสถานะ + แก้บั๊กกล่องหลังปูตัวสุดท้ายตาย (2026-07-20) — BE typecheck + FE build ผ่าน, ไม่ต้อง migrate
- **ข้อ 1 ปฏิทิน+กำหนดการ (CalendarView, FE):** เพิ่ม chip กรองสถานะ 4 หมวด `ยังไม่ทำ/เสร็จแล้ว/ข้าม/อื่นๆ` (`filterDefs`+`activeFilters` Set, toggle เปิด/ปิด, โชว์จำนวนต่อหมวด `filterCounts`) — กรองที่ `events` computed จึงมีผล**ทั้ง dayGridMonth และ listMonth (กำหนดการ)**; หมวด "อื่นๆ" = งาน CANCELLED + กำหนดเตือนถัดไปของ rule (`taskFilterKey`)
- **ข้อ 2 บั๊กปูตัวสุดท้ายตาย:**
  - (2.1 สีกล่องไม่กลับเป็นว่าง) FE `CrabsView.boxStyle` — ทาสี `box.color` เฉพาะเมื่อ `crabsInBox(box.id).length > 0`; กล่องไม่มีปูมีชีวิต → คืน undefined → ตกไป `.box-empty` (เทา) แทนสีเดิม
  - (2.2 popup ยังขึ้น "กำลังขุน") FE ซ่อน v-select สถานะเมื่อ `f.id == null` (ปูใหม่เริ่ม FATTENING เสมอ) → กล่องว่าง เปิดมา = ฟอร์มเปล่าไม่มีสถานะหลอก
  - (BE เสริมความถูกต้อง) `crab.service.updateCrab` sync สถานะกล่อง: ปูตาย/ขายในกล่องเดิม → ใช้ `freeBoxIfEmpty` (ว่างเฉพาะเมื่อไม่มีปูตัวอื่นเหลือ) แทนการ set `EMPTY` ตรงๆ — กันบั๊ก set EMPTY ทั้งที่ยังมีปูตัวอื่น (1 กล่องหลายตัว)
- ⚠️ ยังไม่ทดสอบ browser จริง (typecheck+build ผ่าน) — รอผู้ใช้เทสกรองปฏิทิน + ให้ปูตัวสุดท้ายตายแล้วเช็คสีกล่อง/popup

### 🗓️ รอบฟีดแบ็ค: ปฏิทิน/งาน/สมุดบัญชี/แดชบอร์ด (2026-07-18) — BE typecheck + FE build ผ่าน, ไม่ต้อง migrate
- **BE ใหม่ (endpoint เดียว):** `task.service.listTaskHistory(id,user)` + `GET /tasks/:id/history` (วางหลัง `/:id`) — คืนงานพี่น้อง `ruleId` เดียวกันที่ `status∈[DONE,SKIPPED]` (exclude ตัวเอง, orderBy completedAt desc, take 20, select id/status/completedAt/dueAt/title/type); งานครั้งเดียว (`ruleId=null`) คืน `[]`; FE type `TaskHistoryEntry` + `taskApi.history(id)`
- **ข้อ 1 ปฏิทิน+กำหนดการ (CalendarView, FE):** popup **ปิด/ข้ามงานได้เลย** (`completeTask`/`skipTask` mirror TasksView + `canComplete`) — (1.2) เอาปุ่ม "ไปหน้างาน/ไปหน้าแจ้งเตือน" + `goManage` ออก; (1.3) ตัด text ไม่จำเป็น (เตือนแล้ว N ครั้ง / caption กฎ); (1.4) โชว์ "ปิดงานล่าสุด" (`lastCompletedFor` คำนวณจาก `tasks.value` ที่โหลดมา — ไม่ยิง API เพิ่ม); + โชว์ "เลยกำหนดมา N วัน"
- **ข้อ 2 งานที่ต้องทำ (TasksView, FE):** (2.1) เรียงใหม่สุดก่อน (`sortedTasks` = dueAt desc, tie id desc); (2.2) **แก้มือถือเด้งบนสุดตอนปิดงาน** — action จาก dialog ทำ `window.scrollY=0` (scroll lock) → จับ `savedScrollY` **ก่อนเปิด dialog** ใน `openDetail` แล้ว `reloadPreservingScroll(y)` คืนค่านั้น (desktop ปุ่มในแถวใช้ scrollY ปัจจุบัน ผ่าน `scrollTarget()`); (2.3) ประวัติรอบที่ผ่านมา = toggle กดดูใน popup (โหลด `taskApi.history` เฉพาะงานมี `ruleId`); (2.4) โชว์ "เลยกำหนด N วัน" ใน popup + แถว
- **ข้อ 3 สมุดบัญชี (LedgerView, FE):** (3.1) dropdown หมวดโชว์ไทย (`manualCategoryItems` = title ไทยจาก `categoryMeta`); (3.2) ย้ายคอลัมน์ "จัดการ" (แก้/ลบ) มาไว้**ถัดจากประเภท** (คอลัมน์ 2) เข้าถึงง่ายบนมือถือ (freeze-first ตรึงคอลัมน์แรก)
- **ข้อ 4 แดชบอร์ด (DashboardView, FE):** ข้อความประกาศขาย (`buildPostText`) ตัดปูที่ถูกจองออก (`!reservedIds.value.has(c.id)`) — เดิมรวมปูจองด้วย
- ⚠️ ยังไม่ทดสอบ browser จริง (typecheck+build ผ่าน) — รอผู้ใช้เทสปิดงานจากปฏิทิน + scroll มือถือ

### 🐛 แก้ iOS Safari popup ปูค้าง/จุดสัมผัสเพี้ยน (2026-07-17) — FE-only (CrabsView), build ผ่าน, รอผู้ใช้เทสจริงบน Safari
- **อาการ:** เปิด dialog ปูบน Safari iPhone บางครั้ง (~1/10) scroll ค้าง + แตะที่ว่างแต่ไปโดนปุ่ม (hit-test เพี้ยนแกน y) — Chrome iOS ปกติ; ชอบเกิดจังหวะสำคัญ (ถ่ายรูปไข่ปู)
- **root cause (มั่นใจสูง):** Vuetify `v-dialog` default `scroll-strategy="block"` → set `html{position:fixed; top:-scrollY}` ตอนเปิด; บน iOS Safari ถ้าชนจังหวะ toolbar ยุบ/ขยาย (หรือกลับจากกล้อง) Safari วาดจอกับคำนวณ touch คนละตำแหน่ง → เพี้ยนเท่า scrollY + scroll ค้าง; ตัวเสริม = `dialog-bottom-transition` (transform) ค้างกลางอนิเมชันได้
- **fix (CrabsView 2 dialog: ปูหลัก + รับล็อต):** `:scroll-strategy="mobile ? 'none' : 'block'"` (fullscreen อยู่แล้ว ไม่ต้องล็อก body) + `:transition="mobile ? false : ..."` (เปิดทันที ไม่มี transform) + CSS `.crab-dialog-body{overscroll-behavior:contain}` กัน scroll ทะลุ + `.crab-dialog-card{touch-action:manipulation}` ตัด delay double-tap
- ⏭️ **ถ้าผู้ใช้เทสแล้วหาย → roll out ชุดเดียวกันให้ dialog fullscreen หน้าอื่น** (Commerce sell/contact, Water, Dosing, Inventory, Ledger, Reminders, Substances, CrabLog, Dashboard) — ตอนนี้แก้เฉพาะจุดที่เจ็บก่อนเพื่อพิสูจน์สาเหตุ

### 🎨 รอบปรับ UI: dashboard sections + ตาราง listing มีสีสัน + navbar (2026-07-17) — FE-only, build ผ่าน, ไม่ต้อง migrate
- **ข้อ 1 (DashboardView รื้อ layout):** แบ่งเป็น **4 section ใหญ่** (`<section class="dash-section">` + หัวข้อไอคอน+เส้นใต้สีธีม `.dash-section__head`): ① ภาพรวม (KPI+อากาศ) ② การเงิน (area+donut+ตารางแยกหมวด) ③ สต็อกปู (สต็อก+bar+ข้อความโพสต์) ④ สรุปการขุน (การ์ดสถิติ 4 ใบ + ตารางกำไร/วัน)
  - **KPI แก้ "การ์ดยักษ์ตลกๆ" (ข้อ 1.3):** เลิก `.kpi-card` ที่ยืดเต็มความสูง → `.kpi-tile` สูงคงที่ (min-height 82px) + แถบสีซ้าย `--kpi`, จัด 2x2 (`cols=6`) + `align-content:space-between` ให้กระจายเต็มความสูงเท่าการ์ดอากาศโดยการ์ดไม่บวม; เลิก `lg=3` ที่ทำเลขยาว (฿770.89) ถูกตัด
  - คู่การ์ดในแถวใช้ `d-flex`+`flex-grow-1` สูงเท่ากัน (แก้ desktop ไม่สมดุล ข้อ 1.2)
  - **ตารางกำไร/วัน (ข้อ 1.3):** เพิ่ม pagination client-side (`profitPage`/`profitPageSize` 5/10/20/50 + `v-pagination`) + ป้ายชนิด chip สี/ไอคอน (`typeChip`) + กำไรสี เขียว/แดง
- **ข้อ 2 (navbar):** ซ่อน brand "🦀 ฟาร์มปูคอนโด" บนมือถือ (`d-none d-sm-block`)
- **ข้อ 3:** ไอคอนถุงเงิน `mdi-sack` เปลี่ยนเป็นสีทอง `#ffc107`
- **ข้อ 4 (ตาราง listing ทุกหน้า — global.css `.freeze-first`):** หัวตารางไล่สีจากธีม (`color-mix` primary) + ตัวอักษรสีธีม, สลับสีแถวคู่ (zebra), hover ไฮไลต์, **เซลล์ `white-space:nowrap` → มือถือไม่บีบคอลัมน์ เลื่อนแนวนอนแทน (ข้อ 4.2)**, มุมโค้ง; sticky คอลัมน์แรกพื้นทึบตามสีแถว (odd/even/hover). ครอบทุกหน้าที่ใช้ `freeze-first` (Commerce/Ledger/Inventory/Substances/Dosing/Water/Reminders/CrabLog/Dashboard). LedgerView หมวดเปลี่ยนจาก enum ดิบ → ชื่อไทย+ไอคอน (`categoryMeta`)
- ⚠️ ใช้ CSS `color-mix()` (เบราว์เซอร์ใหม่รองรับ); ยังไม่ทดสอบ browser จริง (build+typecheck ผ่าน)

### 🧹 รอบปรับ UI 12 หมวด + soft delete ปู + ปิดงานย้อนหลัง (2026-07-17) — BE+FE typecheck + FE build ผ่าน, ✅ migration apply แล้ว
- ✅ **migration `phase18_crab_soft_delete` apply ลง DB จริงแล้ว** (2026-07-17): `ALTER TABLE Crab ADD deletedAt DATETIME(3) NULL` + index `(systemId, deletedAt)`; client regenerate แล้ว
- **ข้อ 4.3 soft delete ปู:** `Crab.deletedAt`; `deleteCrab` เปลี่ยนเป็น set `deletedAt=now` (ไม่ลบจริง) + `freeBoxIfEmpty`; ทุก query ปูปกติกรอง `deletedAt: null` (`listCrabs`/`listCrabProgress`/`exportCrabsCsv`/`public.getPublicShop`/`dashboard` crab groupBy+sold); **ใหม่ `listCrabLog` + `GET /crabs/log`** (คืนปูทุกตัวรวมขาย/ลบ + box/buyer/history); **FE หน้าใหม่ `CrabLogView.vue` route `/crab-log` group care "ประวัติปูทั้งหมด"** (ตาราง + dialog log แยกโซน + toggle แสดงปูที่ถูกลบ)
- **ข้อ 6.5 ปิดงานย้อนหลัง + รอบถัดไปนับจากวันปิด:** `completeTaskManually(id,user,doneAt?)` — set `completedAt=doneAt` + ถ้างานมาจากกฎ recompute `rule.nextRunAt = computeNextRunAt(rule, doneAt)` (นับต่อจากวันปิดจริง); `POST /tasks/:id/complete` รับ body `{doneAt?}`; **ใหม่ `createManualTask` + `POST /tasks`** (งานเตือนครั้งเดียว type CUSTOM, ข้อ 5.4); calendar โชว์งาน DONE ตาม `completedAt`; TasksView มี date-picker "ปิดงานเมื่อวันที่"
- **ข้อ 5 Calendar:** เอาเวลาออก (`displayEventTime:false`), ชื่ออย่างเดียว (ตัด typeLabel), ปุ่ม "แจ้งเตือนตามรอบ"(→`/reminders?create=1`)+"เตือนครั้งเดียว"(dialog+`dateClick`), ไฮไลต์วันนี้ใน list, เอาปุ่ม today ออก, list ซ่อนวันที่ผ่านแล้ว (filter ตาม `currentView` จาก `datesSet`)
- **ข้อ 2 freeze คอลัมน์แรกทุกตาราง:** `.freeze-first` ใน global.css (sticky left + bg surface) ใส่ทุก v-table หลัก
- **ข้อ 8 navbar:** badge งานค้าง animate (`.badge-pulse`), ย้ายธีม/โหมดมืดเข้า popover โปรไฟล์, ถุงเงินรายได้รวม (`dashboardApi.finance().totalIncome`) ขวาบน, เมนู "คลัง & สูตร"→"การตั้งค่า" (NAV_GROUPS), route reminders title→"การแจ้งเตือนตามรอบ"
- **ข้อ 4.1/4.2 การกินปู:** เอาปุ่ม "ให้อาหารแล้ววันนี้" ออก; chip = การกิน"วันนี้" (`f.todayFeeding` เริ่มว่างเสมอ ไม่ผูก feedingNote); FEEDING_TAGS ใหม่ = ไม่กินปลา/ไม่กินหอย/กินปลาปกติ/กินหอยปกติ/กินน้อย (เอา "กินปกติ" ออก); save: `todayFeeding` ทับ feedingNote ถ้าเลือก chip
- **อื่นๆ:** 1.1 KPI การ์ด flex เต็มสูง; 3.1 หน้าร้านโชว์กรัม (`gramLabel`) + slider กรัม; 6.1-6.4 Reminders freeze+reorder(ชื่อ/จัดการ/เปิดใช้/รอบถัดไป/รอบ/ประเภท)+hint "แจ้งเตือนอีเมลทุก 12.30น"+pagination; 7.1 ใบเสร็จตัดคอลัมน์น้ำหนัก + 7.2 ลายน้ำชื่อฟาร์มเฉียง; 9.x Tasks (เอาลูกศร/แตะแถวขวาเปิด popup/ปุ่มไม่เบียด/scroll ไม่เด้ง/pagination/fix 400 ใช้ sentinel 'ALL'); 10 Ledger reorder+min-width; 11 Commerce reorder listing+contacts; 12 Substances ย้ายจัดการเป็นคอลัมน์ 2


### 🛍️ ยกเครื่องหน้าร้าน public (QR) — สวยขึ้น + กรองละเอียด + รูป/ขีด/วันเลี้ยง (2026-07-15) — BE+FE typecheck + FE build ผ่าน, ไม่ต้อง migrate
- **BE `public.service.getPublicShop`:** เพิ่ม 2 ฟิลด์ต่อปูใน response — `imageUrl` (รูปล่าสุดจากรอบ MEASURE: `include history where zone=MEASURE orderBy recordedAt desc` แล้วหยิบ `snapshot.imageUrl` ตัวแรกที่ไม่ว่าง) + `daysRaised` (นับจาก `purchaseDate` ถึงวันนี้). **ไม่ต้อง migrate** (อ่านจากข้อมูลเดิม); type FE `PublicShopCrab` เพิ่ม `imageUrl`/`daysRaised`
- **FE `PublicShopView.vue` รื้อใหม่หมด** (8 ข้อฟีดแบ็ค):
  - (1/6) ดีไซน์ใหม่ทันสมัย: header gradient + การ์ดปูมีรูป (aspect 4:3) + badge ชนิด + จุดสีเคเบิ้ลไทล์ + hover lift + overlay ติ๊กถูกตอนเลือก + cart bar โค้งมน
  - (2) **ระบบกรองละเอียด:** chip ชนิด (ทั้งหมด/ปูไข่/ปูเนื้อ + นับจำนวน), เมนู sort (ขนาด/ราคา/แน่น/วันเลี้ยง), panel ขั้นสูง (range slider ขีด, slider %ความแน่นขั้นต่ำ, range slider ราคา, toggle เฉพาะมีรูป) + badge นับตัวกรอง active + ปุ่มล้างตัวกรอง
  - (3) รูปปู: `hasImage()` + `@error` fallback → ป้าย "ไม่มีรูปภาพ" (พื้นลายทาง)
  - (4) เปลี่ยน "ตัวโล" → "ขีด" (`khitLabel`) เป็นเลขใหญ่บนการ์ด (ลบ `perKilo`)
  - (5) โชว์ "เลี้ยง N วัน" เป็น pill
  - (7) เอา "สอบถามราคา"/"รอสอบถามราคา" ออก — ไม่มีราคาก็ไม่แสดงบรรทัดราคา
  - (8) ปุ่ม "เลือกทั้งหมด (N)" / "ยกเลิกที่เลือก" ตามผลกรองปัจจุบัน (`toggleSelectAllFiltered`)
  - คงเดิม: dialog "ให้ร้านเลือกให้" (กำหนดจำนวน), ยืนยัน→ใบเสร็จรูป (html2canvas)
- ⏭️ **ค้างไว้พรุ่งนี้ (ผู้ใช้สั่ง):** ปูที่ถูกจองแล้ว ให้ขึ้น status "ถูกจองแล้ว" + สี disable ที่ box (ตอนนี้ปูจอง = ถูกตัดออกจากหน้าร้านทั้งตัว ยังไม่โชว์แบบ disabled)
- ⚠️ ยังไม่ทดสอบใน browser จริง (typecheck+build ผ่าน)

### 🎨 navbar ธีมเทศกาล + แดชบอร์ดกราฟ/อากาศ + จองปูซิงค์ + หน้าร้าน public QR (2026-07-14) — BE+FE typecheck + FE build ผ่าน, ✅ migration apply แล้ว, smoke test public route ผ่าน
แผน: `C:\Users\piyawat\.claude\plans\cryptic-gliding-cook.md`
- **migration ใหม่ `phase17_weather_public_feeding`** ✅ apply ลง DB จริงแล้ว (smoke test เห็นคอลัมน์ใหม่ใน SQL): `CrabSystem.weatherLat/Lng/weatherPlace Float?/String?` (การ์ดอากาศ), `CrabSystem.publicEnabled Boolean @default(false)` + `publicSlug String? @unique` (หน้าร้าน public), `Crab.lastFedAt DateTime?` (ให้อาหารล่าสุด); **ราคา/กก. เก็บใน `receiptSettings` JSON** (`priceEgg`/`priceMeat` — ไม่ต้อง migrate); zod ใน `routes/systems.ts` + `system.service.updateSystem` gen `publicSlug` (randomBytes) ตอนเปิดร้านครั้งแรก
- **ข้อ 2.3 (บั๊กรายจ่าย=0):** root cause = รายการ manual ใน LedgerView มี `systemId=null` แต่แดชบอร์ดกรอง `systemId` → ตัดทิ้ง; แก้ `dashboard.service.financeSummary` ให้ `OR:[{systemId},{systemId:null}]` เมื่อมี systemId + LedgerView เพิ่ม dropdown เลือกระบบ (default ระบบปัจจุบัน)
- **ข้อ 1 (navbar):** ระบบธีมใหม่ `plugins/themes.ts` (5 family × light/dark = 10 ธีม: base/cny/songkran/christmas/valentine) + `lib/theme.ts` (family+mode แยกกัน, localStorage `themeFamily`/`themeMode`); navbar ไล่เฉด `--fd-bar` ต่อธีม (global.css) + เมนู 🎨 เลือกธีม + ปุ่ม dark/light เดิม
- **ข้อ 2 (dashboard):** เพิ่ม deps `apexcharts`+`vue3-apexcharts`; รื้อ `DashboardView` = KPI การ์ด + area(รายรับจ่ายรายเดือน)+donut(รายจ่ายหมวด)+bar(สต็อก) + `WeatherCard.vue` (Open-Meteo ฟรีไม่ต้องคีย์, พิกัดตั้งใน dialog + geolocation, default กรุงเทพฯ)
- **ข้อ 3 (หน้าปู):** `lib/reservations.ts` (FE+BE) parse `#ids` จาก SELL/CONFIRMED; CrabsView โหลด txn จอง → ป้าย "จอง" ม่วง + chip "ถูกจอง" + แดชบอร์ดนับจอง; box crab-row เป็น **2 บรรทัด** (น้ำหนักไม่ถูกบีบ) ชิดซ้าย; ป้ายการกินเป็น badge สี (🐟✕/🦪✕/กินน้อย/กิน✓) แทนไอคอนช้อนส้อมโหลๆ; พร้อมขาย=pill เขียว; **ให้อาหาร log** = `POST /crabs/:id/feeding-log` (`crab.service.logFeeding` insert FEEDING history เสมอ + set `lastFedAt` ไม่แตะ diff MEASURE) + ปุ่ม "ให้อาหารแล้ววันนี้"
- **ข้อ 4.1 (tasks มือถือ):** ซ่อนปุ่ม append บนมือถือ (แตะแถวเปิด popup ที่มีปุ่มครบ) + ลด font หัวข้อ
- **ข้อ 5 (หน้าร้าน public):** refactor ใบเสร็จออกจาก CommerceView → `lib/receipt.ts` (buildDocMarkup/types) + `styles/receipt.css` (import global); BE `routes/public.ts` (mount ก่อน requireAuth) + `services/public.service.getPublicShop(slug)` คืนปู READY ที่ยังไม่จอง + ราคา (ตัดต้นทุน/กำไร); FE route `/shop/:slug` (public) + `PublicShopView.vue` (เมนูชาบู เลือกปู/กำหนดสเปก → ตะกร้า → ใบเสร็จ html2canvas ก๊อป/ดาวน์โหลด); QR + toggle เปิดร้าน + ราคา/กก. ในไดอะล็อกตั้งค่าใบเสร็จ (dep `qrcode`); **ยืนยัน = ใบเสร็จรูปเท่านั้น ยังไม่เขียน order/notify** (เผื่อ `POST /public/shop/:slug/order` อนาคต)
- **ข้อ 6 (config inline):** พิกัดอากาศ (การ์ด weather), ธีม (navbar), เปิดร้าน+QR+ราคา/กก. (Commerce), systemId ledger (LedgerView)
- ⚠️ ยังไม่ทดสอบใน browser จริง (typecheck+build+smoke test BE ผ่าน) — รอผู้ใช้เปิดร้าน+ตั้งราคา/กก.+ทดสอบแสกน QR; ต้องมี `CLOUDINARY_*` ถ้าใช้โลโก้ร้าน


### 🖼️ รอบฟีดแบ็ค: ย่อ/ขยายแกลเลอรี + แก้ก๊อปรูป Safari + รูปรวมปูที่จอง + แบ่งหน้าประวัติน้ำ (2026-07-10) — FE-only, typecheck + build ผ่าน, ไม่ต้อง migrate
- **ไฟล์ใหม่ (FE):** `lib/imageMontage.ts` — `buildMontage(items, heading)` แยกลอจิกวาดรูปรวมออกจาก ProgressView (drawCover/clipText + คำกำกับ 2 บรรทัด title+sub) คืน `{dataUrl, blob}`; ใช้ร่วม ProgressView + CommerceView
- **ข้อ 1.1 (ProgressView):** ส่วน "รูปปูล่าสุดทั้งหมด" ย่อ/ขยายได้ (`galleryOpen`, chevron + คลิกหัวข้อ, `v-expand-transition`) — **บนมือถือเริ่มแบบย่อ** (`ref(!mobile.value)`) กันต้อง scroll ยาวกว่าจะถึง section เทียบปู
- **ข้อ 1.2 (Safari ก๊อปรูปเดี่ยวไม่ได้):** root cause = `copyOne` เดิม `await urlToBlob()` (fetch) **ก่อน** `clipboard.write` → Safari หลุด user-gesture; แก้ด้วย `imageShare.copyImageFromUrl(url)` — ส่ง `Promise<Blob>` เข้า `ClipboardItem` แบบ synchronous (Safari/Chrome รองรับ) + fallback แบบเดิม; **เก็บปุ่มก๊อปไว้** (ไม่ต้องเอาออก)
- **ข้อ 2.1–2.3 (CommerceView รูปรวมปูที่จอง):** โหลดรูป+%ไข่ lazy จาก `crabApi.progress` (`ensureProgress` Map, reset ใน `loadAll`); ปุ่ม "รูปรวม" 2 จุด = (a) ในไดอะล็อกจองปู แถวสรุปที่เลือก (`makePickedMontage`, ไม่เบียด footer) (b) ไอคอนในแถว listing ของการจอง (`makeTxnMontage`); คำกำกับมี **ไซส์ + ไข่/เนื้อ %** (ข้อ 2.3); dialog แยก + ดาวน์โหลด/ก๊อป/แชร์
- **ข้อ 2.4 (เลขที่ใบเสร็จ):** เดิม `openTxnDoc` (เปิดจาก listing) ใช้ `QT-00019` (id pad5) ต่างจากตอนพรีวิว `QT-YYYYMMDD-NNN` → unify ให้ listing เป็น `QT-<YYYYMMDD ของ occurredAt>-<id pad3>` (คงที่ต่อรายการ ไม่สุ่มใหม่)
- **ข้อ 3.1 (WaterView):** ประวัติการวัดแบ่งหน้า client-side (`historyPage`/`historyPageSize` เลือก 5/10/20/50, `pagedTests` เก็บ index สัมบูรณ์ให้ "เทียบรอบก่อน" ข้ามหน้าถูก, `v-pagination`); โหลด `take: 200` (จาก 10)
- ✅ migration `phase16_receipt_settings` จากรอบก่อน **apply ลง DB จริงแล้ว** (เช็ค 2026-07-10: `prisma migrate status` = up to date, 11 migrations); รอบนี้ FE-only ไม่เพิ่ม migration

### 🖼️ กดขยายรูปทุกที่ + สรุปรูปล่าสุด + ใบเสร็จคัสตอม + จองปู + แก้ UI (2026-07-09) — BE+FE typecheck + FE build ผ่าน, ✅ migration apply แล้ว (เช็ค 2026-07-10)
แผน: `C:\Users\piyawat\.claude\plans\sleepy-humming-eagle.md`
- **migration ใหม่ `phase16_receipt_settings`** ✅ **apply ลง DB จริงแล้ว** (เช็ค 2026-07-10 `prisma migrate status` = up to date): `CrabSystem.receiptSettings Json?` เก็บ `{shopName, logoUrl, color, footerNote, blockOrder}`; `normalizeSystemData` แปลง null→`Prisma.DbNull` (เหมือน sizeBuckets); zod ใน `routes/systems.ts` +`receiptSettings`
- **ข้อ 1 (กดขยายรูปทุกที่):** `lib/imageZoom.ts` (`useImageZoom` singleton) + `components/ImageZoomOverlay.vue` (mount ใน `App.vue`); ต่อ `openZoom()` เข้า CrabsView (thumbnail ประวัติ/รูปล่าสุด/รูปแก้รอบ) + CrabCompare (เลิก dialog ในตัว)
- **ข้อ 2 (สรุปรูปล่าสุด):** `lib/imageShare.ts` (`loadImage`/`urlToBlob`/`copyImageBlob`/`downloadBlob`/`shareBlob`); ProgressView เพิ่มแกลเลอรี `after.imageUrl` + ปุ่ม "สร้างรูปรวม" (canvas montage → PNG) + ก๊อปทีละรูป
- **ข้อ 3 (ใบเสร็จคัสตอม, FE ใน CommerceView):** `buildDocMarkup` รื้อเป็น **map บล็อก** join ตาม `blockOrder`; สี=`var(--fd-accent)` set inline; โลโก้ upload ผ่าน `uploadApi.crabImage` + `html2canvas({useCORS:true})`; dialog "ตั้งค่าใบเสร็จ" (ชื่อร้าน/โลโก้/สี/หมายเหตุ/ลากสลับลำดับบล็อก native drag+ลูกศร) + พรีวิวสด (`zoom:0.5`); เก็บผ่าน `systemApi.update({receiptSettings})`
- **ข้อ 5 (จองปูแทนขายทันที, FE ล้วน):** จอง = txn **SELL/CONFIRMED** (ฝัง `#ids` ใน note, ไม่แตะสถานะปู, ไม่ลง ledger); `reservedCrabIds` (Map จาก CONFIRMED SELL) → ตัดปูจองออกจาก candidate ของคนอื่น (ยกเว้นใบที่กำลังแก้ `editingTxnId`); ปุ่มในตาราง = **ยืนยันขาย** (`finalizeSale`: ปู→SOLD แบ่งราคาตามน้ำหนัก + txn→DONE ลง ledger) / **แก้ไขการจอง** / **ยกเลิกการจอง**; ไม่ยุ่งกับ `lockedForBuyerId` (ล็อกลูกค้าประจำแยกกัน)
- **ข้อ 4:** (4.1) CalendarView override `--fc-list-event-hover-bg-color` เป็นสีธีม (dark hover ขาวทับตัวอักษรขาว); (4.2) เอา `onGridClick` (คลิกที่ว่างล้างกรอบเหลือง) ออกจาก CrabsView — ไฮไลต์ `box-recent` ยังอยู่
- ⚠️ ยังไม่ทดสอบ server จริง (รอ apply migration) — โลโก้/montage ต้อง `CLOUDINARY_*` + CORS ของ Cloudinary

### 🖼️ รูปภาพประวัติ (Cloudinary) + เปรียบเทียบพัฒนาการปู before/after + chip scroll-x (2026-07-08) — BE+FE typecheck ผ่าน, รอทดสอบ server จริง
แผน: `C:\Users\piyawat\.claude\plans\purring-zooming-nebula.md`
- **ไม่ต้อง migrate DB** — รูปเก็บใน `CrabHistory.snapshot` (Json) โซน MEASURE ที่มีอยู่ (keys ใหม่ `imageUrl`/`imagePublicId`)
- **deps ใหม่ (backend):** `cloudinary`, `multer`, `@types/multer`. **env ใหม่ (optional):** `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` (เพิ่มใน `config/env.ts`+`.env.example` แล้ว — ⚠️ **ผู้ใช้ต้องใส่ค่าจริง** ไม่งั้น `/api/uploads/crab-image` คืน 503)
- **ข้อ 1 (แนบรูป):** `lib/cloudinary.ts` (signed upload ผ่าน backend: `uploadImage`/`deleteImage`/`cloudinaryConfigured`) + `routes/uploads.ts` (`POST /uploads/crab-image` multer memory ≤8MB, image/* เท่านั้น) mount ใต้ `requireAuth`; `middleware/error.ts` จับ `MulterError` (ไฟล์ใหญ่→400); `crab.service` create/update รับฟิลด์ชั่วคราว `measureImageUrl`/`measureImagePublicId` (destructure ออกก่อน prisma) → ยัดลง MEASURE snapshot; **มีรูป → บังคับสร้างรอบ MEASURE ใหม่แม้ค่าอื่นไม่เปลี่ยน**; `deleteCrabHistory` ลบรูป Cloudinary best-effort; `crabBody` zod +2 ฟิลด์; **`PATCH /crabs/history/:id`** (`updateCrabHistory`) **แก้รอบเก่าย้อนหลัง** (ตัวเลข/วันที่/รูป โดยไม่สร้างรอบซ้ำ — ถ้าเป็นรอบล่าสุด sync ค่าปัจจุบันของปูให้ตรง); FE = dialog "แก้ไขรอบ" (ดินสอในป็อปอัปประวัติ) + ป้ายกำกับ "บันทึกในกล่อง = เพิ่มรอบวัดใหม่"
- **ข้อ 2 (before/after):** `crab.service.listCrabProgress` + `GET /crabs/progress?systemId` (วางก่อน `/:id`) คืนปูที่ยังเลี้ยง + 2 รอบวัดล่าสุด (`before`/`after`/`deltaDays`); FE: `components/CrabCompare.vue` (รูป+น้ำหนัก+%+วัน+Δ, ซูมรูป) ใช้ทั้ง 2 ที่; **หน้าเมนูใหม่ `views/ProgressView.vue` route `/progress` group `care` "พัฒนาการปู"** (ผู้ใช้เลือก dedicated view); CrabsView popup โซนข้อมูลวัดมีปุ่ม "เทียบ" + อัปรูป (`v-file-input`→`uploadApi.crabImage`) + โชว์ "รูปล่าสุด"/thumbnail ในประวัติ
- **ข้อ 3:** filter chip ปู (ไข่/เนื้อ/พร้อมขาย) เปลี่ยน `flex-wrap`→`.chip-scroll` (nowrap+overflow-x) มือถือไม่ตกบรรทัด
- **กันประวัติซ้ำ:** FE ส่ง `measureImageUrl` เฉพาะตอนอัปรูปใหม่ (ไม่ prefill รูปเก่า) → save ปกติที่ไม่แตะรูปจะไม่บังคับสร้าง MEASURE row
- ⚠️ ยังไม่ทดสอบ server จริง/อัปรูปจริง (typecheck ผ่านทั้ง BE+FE) — รอผู้ใช้ใส่ `CLOUDINARY_*` แล้วรัน `npm run dev`

### 🔐 การปรับระบบครั้งใหญ่ (Auth/Role/OAuth + Multi-crab + UI) — แบ่ง 4 เฟส
แผนเต็ม: `C:\Users\piyawat\.claude\plans\adaptive-wobbling-umbrella.md`

**Phase 1 (Auth + RBAC + read-only ข้ามเจ้าของ + โชว์ค่าน้ำ) เสร็จ + ทดสอบ server จริงผ่าน** ✅
- **migration `phase8_auth` apply ลง DB จริงแล้ว:** `User.passwordHash/role(Role ADMIN|FARM_OWNER)`, model `RefreshToken` (เก็บ sha256 hash, rotate+revoke), `CrabSystem.notifyEmail` (เตรียมไว้ Phase 4)
- **deps ใหม่:** `jsonwebtoken`, `bcryptjs` (+types). **env ใหม่ (required):** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`; optional: `ACCESS_TOKEN_TTL`(15m), `REFRESH_TOKEN_TTL`(30d), `FRONTEND_URL`, `GOOGLE_*`/`LINE_*`/`OAUTH_CALLBACK_BASE` (Phase 2) — เพิ่มใน `.env`+`.env.example` แล้ว
- ไฟล์ backend ใหม่: `services/auth.service.ts` (register/login/refresh/logout/me + issueTokens), `middleware/auth.ts` (`requireAuth`/`requireAdmin`/`assertCanEditSystem` + resolver `systemIdFrom*` + `requireSystemEdit()` + `requireDosingRuleEdit`), `routes/auth.ts`
- **`routes/index.ts`:** mount `/auth` + `/scheduler` แบบ public/secret ก่อน แล้ว `api.use(requireAuth)` ครอบที่เหลือทั้งหมด
- **ownership ติดที่ write route ของ:** systems(PATCH/DELETE/boxes/tanks), boxes/filter-tanks(:id), crabs(POST/PATCH/DELETE), water(tests/targets), dosing(calibrations/system-rules/rule:id). **substances/contacts/transactions/reminders/inventory/ledger = authed-only** (shared data — ยังไม่ผูกเจ้าของ, follow-up ถ้าต้องการเข้มกว่านี้)
- `system.service.createSystem` ตั้ง `ownerId = ผู้สร้าง`; `seed.ts` ตั้ง user เจ้าของเป็น `role ADMIN` + ตั้งรหัสผ่านเริ่มต้นผ่าน env `SEED_ADMIN_PASSWORD` (ถ้าใส่)
- **frontend:** `lib/token.ts` (localStorage), `lib/api.ts` (interceptor แนบ Bearer + refresh single-flight เมื่อ 401 → fail = เด้ง login), `stores/auth.ts` (`canEditSystem`/`isAdmin`), `views/Login|Register|OAuthCallback.vue`, router guard (`meta.public`), `App.vue` (shell เฉพาะตอน login + เมนู user/logout), `CrabsView` read-only chip + ปุ่มแก้ซ่อนเมื่อ `!canEdit` + **banner ค่าน้ำล่าสุด** (ไฮไลต์ค่าหลุดเกณฑ์ ข้อ 1.2.2)
- **ทดสอบผ่าน:** register→FARM_OWNER, สร้างระบบ→ownerId=ผู้สร้าง, B GET ระบบ A=200 / B PATCH=403 / A PATCH=200, refresh rotate + reuse เก่า=401, ไม่มี token=401
- ⚠️ **เจ้าของจริง (jame.piyawat111) ยังไม่มีรหัสผ่าน** → ต้องรัน `SEED_ADMIN_PASSWORD=xxx npm run prisma:seed` ครั้งเดียวเพื่อตั้งรหัส (ยังไม่มีหน้าเปลี่ยนรหัสผ่าน — follow-up)

**Phase 3 (1 กล่องใส่ปูหลายตัว + เคเบิ้ลไทล์สี) เสร็จ + ทดสอบผ่าน** ✅
- **migration `phase10_multicrab`:** `Crab.cableTieColor String?` (สีแยกตัว ข้อ 2.2)
- backend: `crab.service` ลบเงื่อนไขกันปูตัวที่ 2 → `assertBoxInSystem` (เช็คแค่กล่องอยู่ระบบเดียวกัน); route รับ `cableTieColor`
- **ขายยกล็อต + คำนวณน้ำหนักอัตโนมัติ ไม่กระทบ** (ทำงานระดับ crabId/น้ำหนักรายตัว — ตอบข้อ 2.1) ✅
- frontend `CrabsView`: `crabInBox`→`crabsInBox` (filter), box-cell โชว์ปูหลายตัว (จุดสี+ขีด+เนื้อ/ไข่%), คลิกกล่องหลายตัว→ chooser dialog, ฟอร์มปูเพิ่ม swatch สีเคเบิ้ลไทล์, รับล็อตเลือกกล่องที่มีปูแล้วได้ (เอา OCCUPIED guard ออก)
- ทดสอบ: ใส่ปู 3 ตัวสีต่างกันในกล่องเดียว → list คืน 3 ตัว ✅

**Phase 4 (%ไข่บนกล่อง + เมลแจ้งเตือนต่อระบบ) เสร็จ + ทดสอบผ่าน** ✅
- backend `lib/notify.ts`: `resolveRecipient` ลำดับใหม่ = **`system.notifyEmail`** → user → owner → fallback/MAIL_TO (เพิ่ม `notifyEmail` ใน select ทั้ง `notifyTask`+`notifyPendingDigest`); `routes/systems.ts` validate `notifyEmail` (email/nullable)
- frontend: box-cell โชว์ `currentFirmnessPct` เป็น "ไข่ NN%"/"เนื้อ NN%" ต่อตัว (ข้อ 3, ใช้ field เดิม), dialog สร้างระบบ + ปุ่ม ⚙️ ตั้งค่าระบบ (แก้ชื่อ+notifyEmail) → `systemApi.update`
- ทดสอบ: สร้างระบบ `notifyEmail=box-alert@...` → ค่าถูกบันทึก + resolve ชนะ owner email ✅

**Phase 2 (OAuth Google + LINE) เสร็จ + ทดสอบ authorize flow ผ่าน** ✅ (เหลือ user คลิกจริงในเบราว์เซอร์)
- **migration `phase9_oauth`:** model `OAuthAccount` (`@@unique [provider, providerAccountId]`) + enum `OAuthProvider {GOOGLE,LINE}`; `User.oauthAccounts`
- **`services/oauth.service.ts`** (ใหม่, ไม่เพิ่ม dep — ใช้ global `fetch`): `getAuthorizeUrl(provider)` + `handleCallback(provider,code,state)`; authorization-code flow เขียนเอง
  - **Google:** token `oauth2.googleapis.com/token` → profile `googleapis.com/oauth2/v2/userinfo` (มี email เสมอ)
  - **LINE:** token `api.line.me/oauth2/v2.1/token` → decode `id_token` (JWT HS256 ด้วย channel secret, verify audience=channelId/issuer) เอา `sub`/`email`/`name`; ถ้า id_token verify ไม่ได้ → fallback `api.line.me/v2/profile` (ไม่มี email)
  - **state = JWT อายุ 10 นาที** (CSRF, stateless); **callback base** = env `OAUTH_CALLBACK_BASE` ?? `http://localhost:3000/api/auth/oauth`
  - **match user:** OAuthAccount เดิม → user เดิม; ไม่งั้นหา user ด้วย email (ผูกเข้าบัญชีเดิม) ไม่งั้นสร้างใหม่ (FARM_OWNER, passwordHash=null); LINE ไม่มี email → email เทียม `line_<sub>@oauth.local`
- **route** `routes/auth.ts`: `GET /api/auth/oauth/:provider/start` (เด้งไป consent), `GET /api/auth/oauth/:provider/callback` (แลก token → redirect `FRONTEND_URL/oauth/callback#accessToken=..&refreshToken=..`; error → `#error=..`)
- **frontend:** ปุ่ม Google/LINE ใน `LoginView` เปิดใช้งานแล้ว (เด้งไป `<apiBase>/auth/oauth/<provider>/start`); `OAuthCallbackView` อ่าน token จาก hash → เก็บ → `fetchMe` → เข้าหน้าแรก
- **env ที่ใช้:** `GOOGLE_CLIENT_ID/SECRET`, `LINE_CHANNEL_ID/SECRET` (user ใส่ครบแล้ว), `FRONTEND_URL`, `OAUTH_CALLBACK_BASE`(optional)
- ⚠️ **ต้องลงทะเบียน redirect URI ให้ตรงเป๊ะ** ใน console:
  - Google Cloud Console → Credentials → Authorized redirect URIs: `http://localhost:3000/api/auth/oauth/google/callback` (+ โดเมนจริงตอน deploy) + เพิ่มบัญชีตัวเองเป็น Test user ถ้า consent screen ยัง Testing
  - LINE Login → Callback URL: `http://localhost:3000/api/auth/oauth/line/callback` + ขอสิทธิ์ Email permission ถึงจะได้ email (ไม่งั้นใช้ email เทียม)
- ทดสอบ: `/auth/oauth/{google,line}/start` คืน authorize URL ถูกต้อง (client_id จริง, redirect_uri, scope, state JWT); provider มั่ว→400; callback ไม่มี code→redirect `#error=`

**🎉 ครบทั้ง 4 เฟสของการปรับระบบครั้งใหญ่แล้ว** (Phase 1 Auth/RBAC, Phase 2 OAuth, Phase 3 multi-crab, Phase 4 egg%/notify email) — เหลือ user ทดสอบ login จริงในเบราว์เซอร์ + ตั้งรหัสผ่าน admin

---

**Phase 1–7 (เดิม) เสร็จแล้ว** — typecheck ผ่าน; **ไม่ต้อง migrate** (model F `LedgerEntry` มีตั้งแต่ schema init แล้ว เหมือน Phase 4/5)

**Backend ครบทุก phase แล้ว → งานถัดไปคือ Frontend (Vue.js, แยก repo)**
- 📄 **[API.md](./API.md) = สัญญา API ครบทุก endpoint** (สำหรับ frontend อ่านแทนการไล่อ่าน route) — อัปเดตทุกครั้งที่แก้ route
- ทุก endpoint ที่ frontend ต้องใช้ list อยู่ในบล็อก Phase ด้านล่าง (A–F) และใน API.md
- ค่าปฏิบัติการจริง (WaterTarget min/max, DosingCalibration, DosingRule, InventoryItem) **ผู้ใช้กรอกเองผ่าน API** — seed เก็บไว้แค่โครงสร้าง (ตัดสินใจ 2026-06-14: ไม่ seed ข้อมูลปลอมลง DB จริง single-user)
- **ยังไม่ได้ทดสอบ server จริงตั้งแต่ Phase 4** (typecheck ผ่านอย่างเดียว) — รอผู้ใช้รัน `npm run dev` ครั้งเดียวเทสรวบ Phase 4–6

**Phase 6 (โมดูล F — การเงิน: LedgerEntry + Dashboard) เสร็จแล้ว** ✅ — typecheck ผ่าน, ยังไม่ทดสอบ server จริง
- ไฟล์ใหม่: `services/ledger.service.ts`, `services/dashboard.service.ts`, `routes/finance.ts` (2 router: `ledgerRouter`/`dashboardRouter`) — mount `/api/ledger`, `/api/dashboard`
- **hook Transaction→DONE → LedgerEntry อัตโนมัติ** (`ledger.syncLedgerForTransaction`): เรียกท้าย `createTransaction`/`updateTransaction`; `status===DONE` → upsert entry (SELL→`INCOME`/`CRAB_SALE`, BUY→`EXPENSE`/`CRAB_PURCHASE`, `amount=totalPrice`, `systemId`อิงปูที่ลิงก์, `occurredAt`อิง txn/now); ออกจาก DONE → ลบ entry; `deleteTransaction` เรียก `removeLedgerForTransaction` ก่อนลบ (กัน orphan เพราะ FK เป็น optional→SetNull)
- **LedgerEntry CRUD** (`/api/ledger`, `?systemId&kind&category&from&to`): สำหรับรายการ manual (FOOD/SUBSTANCE/EQUIPMENT/OTHER); **PATCH/DELETE entry ที่ `transactionId!=null` ถูกบล็อก** (ให้ไปแก้ที่ Transaction); `LEDGER_CATEGORIES` = CRAB_SALE/CRAB_PURCHASE/FOOD/SUBSTANCE/EQUIPMENT/OTHER
- **dashboard (read-only)**: `GET /api/dashboard/overview?systemId` (นับ crab/box ตามสถานะ + pendingTasks + finance net), `GET /api/dashboard/finance?systemId&from&to` (totalIncome/Expense/net + `byCategory` + `byMonth` group YYYY-MM, คำนวณใน JS เลี่ยง raw SQL), `GET /api/dashboard/crabs?systemId` (pain point #3: ปู SOLD → profit/durationDays/profitPerDay/weightG/firmness + ค่าเฉลี่ย + byStatus)
- **gotcha:** dashboard คำนวณ aggregate ใน JS (reduce) ไม่ใช้ Prisma `_sum`/raw SQL — จัดการ `Prisma.Decimal` + group ตามเดือนข้ามฐานข้อมูลได้ตรงกว่า
> ทดสอบ: สร้าง Transaction `{kind:"SELL", status:"DONE", pricePerUnit, crabId}` → เช็ค `GET /api/ledger` เห็น entry `CRAB_SALE` 1 ราย + `GET /api/dashboard/finance` เห็น net; PATCH txn กลับเป็น QUOTE → entry หาย

**Phase 7 (seed ข้อมูลจริง) เสร็จแล้ว** ✅ — **ไม่มีไฟล์เปลี่ยน**: โครงสร้าง seed ครบตั้งแต่ Phase 2–5 แล้ว; ผู้ใช้เลือก (2026-06-14) ให้ **เก็บ WaterTarget min/max ว่าง + ไม่ seed ข้อมูลปลอม** (InventoryItem/DosingRule/Calibration/crab/txn) เพราะเป็น DB จริง single-user → กรอกผ่าน API เอง

---
**ของเดิม (Phase 5):**

**Phase 5 (โมดูล E — คู่ค้า & ซื้อขาย) เสร็จแล้ว** ✅ — ยังไม่ทดสอบ server จริง (รอผู้ใช้รัน)
- ไฟล์ใหม่: `services/contact.service.ts`, `services/transaction.service.ts`, `services/outreach.service.ts`, `routes/commerce.ts` (group 3 router: `contactRouter`/`transactionRouter`/`outreachRouter`) — mount ที่ `/api/contacts`, `/api/transactions`, `/api/outreach`
- **คำนวณกำไรล่วงหน้า (ข้อ 4.5)** ใน `transaction.service`: `totalPrice = pricePerUnit × qty` (คำนวณเสมอ ไม่รับจาก client); `costBasis` เฉพาะ SELL — ถ้าไม่กรอกมาดึงจาก `crab.purchasePrice × qty` ของปูที่ลิงก์; `profit = totalPrice − costBasis` (SELL ที่รู้ต้นทุนเท่านั้น, BUY=null); ทุกค่า round 2 ตำแหน่ง
- endpoints:
  - `/api/contacts` CRUD (`?type&isRegular&active`) — list เรียงลูกค้าประจำขึ้นก่อน; `/:id` GET (รวม txns+outreach 20 ล่าสุด)
  - `/api/transactions` GET (`?contactId&kind&status&crabId`) + POST + `/:id` GET/PATCH/DELETE; **`POST /api/transactions/preview`** คำนวณกำไรไม่บันทึก (ข้อ 4.5); status flow `QUOTE→CONFIRMED→DONE`
  - `/api/outreach` GET (`?round&kind&status&contactId`) + POST + `/:id` PATCH/DELETE; **`POST /api/outreach/start-round`** `{round,kind,contactIds?}` เปิดรอบ → สร้าง log `PENDING` ให้คู่ค้าที่ type ตรง (SELL→BUYER/BOTH, BUY→SELLER/BOTH), idempotent (`skipDuplicates` + unique `[contactId,round,kind]`); PATCH เปลี่ยน status ออกจาก PENDING จะ set `contactedAt` ให้อัตโนมัติ
- **gotcha:** query boolean ใช้ `boolQuery = z.enum(['true','false']).transform(...)` แทน `z.coerce.boolean()` (coerce มอง `"false"` เป็น true)
- **seed เพิ่ม:** Contact 3 ราย (ลูกค้าประจำ BUYER / คนกลาง BOTH / ผู้ขาย SELLER) — idempotent ด้วย findFirst(name+type)
- **ยังไม่ทำ (รอ Phase 6):** `Transaction` ตอน status→DONE ยังไม่ลง `LedgerEntry` (จะทำพร้อมโมดูล F)
> ทดสอบ: `POST /api/transactions/preview {kind:"SELL", pricePerUnit, crabId}` → เห็น profit; `POST /api/outreach/start-round {round:1, kind:"SELL"}` → ได้ log PENDING ทุกผู้ซื้อ

---
**ของเดิม (Phase 1–4):**

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
1. **Frontend (Vue.js, แยก repo)** ⭐ — Backend ครบทุก phase แล้ว
2. **โมดูล G (คลังของ) เสร็จแล้ว** ✅ — `inventory.service.ts` (CRUD + `adjustInventory` delta + `generateRestockTasks`) + `routes/inventory.ts` (mount `/api/inventory`, มี `POST /:id/adjust`); `scheduler.tick` เรียก `generateRestockTasks` → ของที่ `currentQty<=lowThreshold` สร้าง Task `RESTOCK` (กันซ้ำ, ผูก `linkType:'InventoryItem'`+owner เป็นปลายทางเมล); เติมพ้นเกณฑ์ → ปิด Task อัตโนมัติ (`closeRestockIfStocked`); `createTask` เพิ่ม `userId`/`linkType`/`linkId`; **ไม่ต้อง migrate** (model G มีอยู่แล้ว)
3. **ค้าง backend (option):**
   - `FRESHWATER_TOPUP` แบบ "นับวัน" ต่อระบบ (เช่น 12 วัน, แบ่ง 3 ครั้ง MIN→MAX `payload.splitCount`), เตือนเตรียมจุลินทรีย์ตาม `prepLeadDays`
   - `SubstancePrep` (จับเวลาเพาะจุลินทรีย์) ยังไม่มี service/route
   - ยังไม่ได้ทดสอบ server จริงตั้งแต่ Phase 4 (typecheck ผ่านอย่างเดียว)

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
- **✅ ผู้ใช้อนุญาตให้ Claude รัน migration เองได้ (2026-07-17):** หลังแก้ `schema.prisma` ให้ **รัน `npx prisma migrate deploy` + `npx prisma generate` ให้เลยอัตโนมัติ** ไม่ต้องรอผู้ใช้ apply เอง (dev เครื่องนี้ต่อ DB remote จริงได้) — สร้างไฟล์ migration ด้วยชื่อ `<timestamp>_phaseNN_<slug>` ให้เรียบร้อยก่อน deploy
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
- **H. หมู่บ้านฟาร์ม:** `FarmAccess` (สิทธิ์เยี่ยมชมคนต่อคน, อนุมัติแล้วถาวรจนกว่าจะ `revokedAt`), `FarmDecor` (ของตกแต่ง พิกัดเป็นช่องตาราง), `FarmLetter` (จดหมายปักตามจุด + คำตอบเจ้าของ) — ตำแหน่ง avatar **ไม่เก็บลง DB** (อยู่ใน memory ของ `lib/realtime.ts`)

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
- [x] **Phase 5** — โมดูล E: Contact, Transaction (QUOTE/กำไร preview), OutreachLog (ไล่ทักต่อรอบ) ✅
- [x] **Phase 6** — โมดูล F: LedgerEntry (CRUD + hook Transaction→DONE) + Dashboard/analytics endpoints ✅
- [x] **Phase 7** — seed ข้อมูลจริง: โครงสร้างครบตั้งแต่ Phase 2–5; ผู้ใช้เลือกไม่ seed ข้อมูลปลอม (กรอกผ่าน API) ✅
- [x] **Phase 21** — โมดูล B2: `FeedingPlan`/`FeedingRound`/`FeedingEntry` (วงรอบ N วันเว้น M วัน) + WebSocket realtime ✅
- [x] **Phase 22** — `User.uiPrefs` (จำสถานะโหมดสอนต่อผู้ใช้) ✅
- [x] **Phase 23** — โมดูล H หมู่บ้านฟาร์ม: `FarmAccess`/`FarmDecor`/`FarmLetter` + `CrabSystem.villageOpen` + `User.farmAvatar` + WS co-presence (เดินเยี่ยมฟาร์มคนอื่นด้วย avatar, ตกแต่งฟาร์ม, ฝากจดหมาย) ✅

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
- **2026-08-12** — **หมู่บ้านฟาร์ม (Phase 23) + ลดคลิกบันทึกการกิน + แก้ทัวร์ไม่เด้งหลัง OAuth** (แผน `1-1-1-velvety-treasure.md`) — BE tsc + FE build ผ่าน, ✅ migration apply แล้ว, ✅ สโมคเทส REST 12 ข้อ + WS 12 ข้อผ่านหมด (ลบ user/ระบบทดสอบทิ้งแล้ว):
  - **migration `phase23_farm_village`** (18 migrations): 3 ตารางใหม่ `FarmAccess`/`FarmDecor`/`FarmLetter` + enum `FarmAccessStatus` + `CrabSystem.villageOpen` + `User.farmAvatar` — **ไม่ ALTER อะไรที่ทำข้อมูลเดิมเสียหาย**
  - ไฟล์ใหม่ BE: `services/village.service.ts`, `routes/village.ts`; แก้ `lib/scope.ts` (+`canViewFarm`/`visitableSystemIds`), `middleware/auth.ts` (+`assertCanViewFarm`/`requireFarmView`), `lib/realtime.ts` (ห้อง `farmRooms` + `publishFarm`/`publishToUser`/`revokeFarmAccess`/`farmPresence`/`evictUnauthorizedVisitors`)
  - ไฟล์ใหม่ FE: `stores/village.ts`, `lib/village/{avatarParts,catalog,world,walk}.ts`, `components/village/{FarmAvatar,AvatarEditor,FarmCanvas,DPad,DecorPalette,LetterDialog,VisitRequestPopup}.vue`, `views/{FarmVillageView,FarmSpaceView,MyFarmView}.vue`
  - **gotcha ที่เจอจริง:** (1) `computed` ที่เช็ค getter ของ localStorage ก่อน ref จะ short-circuit แล้ว**ไม่มี reactive dependency เลย** → cache ค่าแรกถาวร (ต้นเหตุทัวร์ไม่เด้ง + realtime ไม่ต่อ); (2) บันทึกการกินต้อง `feedingApi.record()` **ก่อน** `crabApi.update()` ไม่งั้นโน้ตเก่าทับของใหม่/เกิดประวัติซ้ำ; (3) route ที่มี param ห้ามอยู่ใน `navRoutes` (เมนูจะขึ้นรายการพัง) → แยก `hiddenRoutes`; (4) `stopRealtime()` ล้าง handlers → component ที่อยู่ยาวต้องลงทะเบียนใน `watch(isAuthenticated)` ไม่ใช่ `onMounted`
  - ดูรายละเอียดเต็ม + ข้อควรระวังในหัวข้อ NEXT ด้านบน และตาราง endpoint ใน [API.md](./API.md) หมวด H
- **2026-08-02** — **แก้เครื่องร้อนตอนบันทึกการกิน (backdrop-filter)** — FE-only (farmland-web), `vue-tsc`+`vite build` ผ่าน, ไม่ต้อง migrate: root cause = CSS `backdrop-filter: blur()` (หนักมือถือสุด) ทำงานทุกครั้งที่บันทึก ไม่ใช่แค่จบรอบ — ตัด `backdrop-filter` ออกจาก `FeedingQuestHud.vue` (โชว์ทุกครั้งบันทึก 1 ตัว) และ `FeedingCelebration.vue` (พลุจบรอบ 70 สปาร์ค `infinite` **ไม่เคยมี auto-dismiss** → เพิ่ม timer ปิดเอง 15 วิ). ตรวจแล้ว WebSocket/polling + แอนิเมชันปูขยับ/auto-scroll ไม่ใช่ตัวปัญหา ดูรายละเอียดเต็มในหัวข้อ NEXT ด้านบน
- **2026-08-02** — **scroll อัตโนมัติไปโซนการกิน + ไอคอนขวดสารสีตามพารามิเตอร์น้ำ** — FE-only (farmland-web), `vue-tsc`+`vite build` ผ่าน, ไม่ต้อง migrate: (1) เปิด popup กล่องปูช่วงมีรอบให้อาหารเปิดอยู่ → เลื่อนลงไปโซน "การกิน" ให้อัตโนมัติ (`CrabsView.vue` `scrollToFeedZone`); (2) วาดไอคอนขวดรีเอเจนต์ SVG เอง (`plugins/waterBottleIcons.ts`, custom Vuetify icon set เรียกผ่าน `waterParamIcon(param)` → `water:<key>`) แทน mdi ทั่วไปในทุกจุดที่อ้างอิงพารามิเตอร์น้ำ (WaterView/CrabsView/DosingView) — สีตามผู้ใช้กำหนด (Mg/Ca ม่วง, แอมโมเนีย เขียว, pH น้ำเงิน, อัลคาไลน์ เทา, ไนไตรท์ แดง, โพแทสเซียม ขาว, เค็มเลือกฟ้าอมเขียวเอง). ดูรายละเอียดเต็มในหัวข้อ NEXT ด้านบน
- **2026-08-02** — **แก้บั๊กฟีดแบ็ค 2 ข้อจากฟีเจอร์ให้อาหาร (Phase 21)** — BE tsc + FE build ผ่าน, ✅ backfill DB จริงแล้ว, ไม่ต้อง migrate: (1) `scoreFromTags` (`lib/feedingCycle.ts`) เคยบังคับต้องกินทั้งปลา+หอยถึงจะได้ 100 → แก้ให้รอบที่ให้อาหารชนิดเดียวได้ 100 เต็มถ้ากินหมด (แยกแท็ก "ปฏิเสธ" ออกจาก "ไม่มีข้อมูล") + backfill รอบเก่า (98/117 entries, 3/3 rounds); (2) พลุฉลองไม่ขึ้นทุกจอ (ทั้งที่ HUD อัปเดตทุกจอ) — root cause เป็น FE ล้วน 2 จุด: guard กันฉลองซ้ำใช้ `localStorage` (ข้ามได้ทุกแท็บของเบราว์เซอร์เดียวกัน → เปลี่ยนเป็น `sessionStorage`) + จอที่ตกไปโหมด polling ไม่รู้ว่ารอบปิดแล้วเพราะ `getCurrentRound()` กรองแค่ `status:'OPEN'` (→ เพิ่ม `feedingApi.get(roundId)` ดึงรอบเดิมซ้ำก่อนเคลียร์). ดูรายละเอียดเต็มในหัวข้อ NEXT ด้านบน
- **2026-07-31** — **แผนให้อาหาร + รอบบันทึกการกิน (WebSocket) + โหมดสอน + ธีม + รายงานมือถือ** (แผน `1-theme-sharded-quiche.md`) — BE tsc + FE build ผ่าน, ✅ migration apply แล้ว, ✅ smoke test BE ผ่านหมด:
  - **migration `phase21_feeding_rounds`** (3 ตารางใหม่ ไม่ ALTER ของเดิม) + **`phase22_user_ui_prefs`** (`User.uiPrefs Json?`) — apply ลง DB จริงแล้วทั้งคู่ (17 migrations)
  - **dep ใหม่ (BE):** `ws` + `@types/ws` (⚠️ `ws` ต้องอยู่ใน `dependencies` — Plesk ติดตั้งแบบ production); **env ใหม่:** `REALTIME_ENABLED`/`WS_PATH`/`WS_HEARTBEAT_SEC`
  - ไฟล์ใหม่ BE: `lib/feedingCycle.ts`, `lib/realtime.ts`, `services/feeding.service.ts`, `routes/feeding.ts`
  - ไฟล์ใหม่ FE: `lib/realtime.ts`, `lib/tour.ts`, `components/{FeedingPlanDialog,FeedingQuestHud,FeedingCelebration,TourOverlay,ScrollHint}.vue`
  - **gotcha ที่เจอจริง:** (1) `toISOString().slice(0,10)` เป็น UTC → ตี 2 ได้วันเมื่อวาน (ต้องใช้ `ymdLocal`); (2) `v-else-if` ข้ามระดับ `<v-slide-y-transition>` ไม่ได้ (compile error); (3) Prisma `update` ในทรานแซกชันโยน P2025 ถ้าแถวถูกลบ → ใช้ `updateMany` + เช็ค `count` แทน
- **2026-07-29** — เมนู "รายงาน" + แยกบัญชีต่อระบบ + อนิเมชันปู (ดูหัวข้อ NEXT ด้านบน)
- **2026-07-09** — **กดขยายรูปทุกที่ + สรุปรูปล่าสุด + ใบเสร็จคัสตอม + จองปู + แก้ UI** (แผน `sleepy-humming-eagle.md`) — BE+FE typecheck + FE build ผ่าน, ยังไม่ apply migration/ทดสอบ server:
  - **migration `phase16_receipt_settings`** (ยังไม่ apply): `CrabSystem.receiptSettings Json?`; `normalizeSystemData` + zod รองรับ; regenerate client แล้ว — ⚠️ ต้อง `prisma migrate deploy` ก่อนรัน server
  - FE ใหม่: `lib/imageZoom.ts`, `components/ImageZoomOverlay.vue` (mount App.vue), `lib/imageShare.ts`
  - **#1** กดขยายรูปทุกจุด (CrabsView 3 จุด + CrabCompare ใช้ overlay กลาง)
  - **#2** ProgressView แกลเลอรีรูปล่าสุด + "สร้างรูปรวม" (canvas montage) + ก๊อปทีละรูป
  - **#3** ใบเสร็จ CommerceView: `buildDocMarkup` เป็น map บล็อก (สลับลำดับได้), สี `--fd-accent`, โลโก้ (`useCORS:true`), dialog ตั้งค่า (ลากสลับ native + พรีวิว `zoom:0.5`), เก็บ `receiptSettings` ต่อระบบ
  - **#4** (4.1) CalendarView `--fc-list-event-hover-bg-color` สีธีม; (4.2) เอา `onGridClick` ออก
  - **#5** จองปู = txn SELL/CONFIRMED (ฝัง `#ids`), `reservedCrabIds` ตัด candidate คนอื่น, ปุ่มยืนยันขาย/แก้ไข/ยกเลิกการจอง; `finalizeSale` ปู→SOLD + txn→DONE
- **2026-07-08** — **รูปภาพประวัติ (Cloudinary) + เปรียบเทียบพัฒนาการปู before/after + chip scroll-x** — BE+FE typecheck ผ่าน (ยังไม่ทดสอบ server จริง):
  - **ไม่ต้อง migrate** — เก็บ `imageUrl`/`imagePublicId` ใน `CrabHistory.snapshot` (Json) โซน MEASURE; deps ใหม่ `cloudinary`/`multer`/`@types/multer`; env `CLOUDINARY_*` (optional)
  - BE: `lib/cloudinary.ts` + `routes/uploads.ts` (`POST /uploads/crab-image` signed, ≤8MB) + `MulterError` ใน error handler; `crab.service` ผูกรูปเข้ารอบ MEASURE (มีรูป→บังคับรอบใหม่), `deleteCrabHistory` ลบรูป best-effort, `listCrabProgress` + `GET /crabs/progress`
  - FE: `components/CrabCompare.vue`, `views/ProgressView.vue` (เมนูใหม่ `/progress` "พัฒนาการปู"), `uploadApi`+`crabApi.progress`, CrabsView โซนข้อมูลวัด (อัปรูป+ปุ่มเทียบ+thumbnail ประวัติ), filter chip → `.chip-scroll`
  - ⚠️ ผู้ใช้ต้องใส่ `CLOUDINARY_*` จริงก่อนอัปรูปได้ (ไม่งั้น 503)
- **2026-07-05** — **รอบฟีดแบ็คที่ 4 (9 ข้อ — หน้าปู + แดชบอร์ด)** — BE+FE typecheck ผ่าน + ทดสอบ server จริง end-to-end ผ่าน:
  - **migration `phase15_crab_ux`** (apply ลง DB จริงแล้ว): `CrabSystem.eggCheckDays/meatCheckDays Int?` (เกณฑ์เตือนเช็ค ข้อ 3) + `CrabSystem.sizeBuckets Json?` (ช่วงตัวโล ข้อ 5); `Crab.feedingNote String?`(ข้อ 4) + `Crab.lastCheckedAt DateTime?`(ข้อ 3,8); model ใหม่ `CrabHistory{crabId,zone,snapshot Json,recordedAt}` (ประวัติแยกโซน ข้อ 8, zone=String ไม่ใช่ enum); enum `ReminderType` เพิ่ม `CRAB_CHECK`
  - **ข้อ 1 (scroll เด้ง):** FE `CrabsView` เพิ่ม `reload()` (โหลดใหม่ไม่ toggle loading → grid ไม่ถูกถอด) + `withScrollPreserved()` (คืน window.scrollY + gridCard.scrollLeft) ครอบ saveAll/removeTab/saveBatch
  - **ข้อ 2 (ไฮไลต์กล่องล่าสุด):** `lastBoxId` set ใน openBox → class `box-recent` (ขอบทอง) + คลิกพื้นที่ว่างในตาราง (`onGridClick`) เคลียร์
  - **ข้อ 3 (อายุ+เตือนเช็ค):** FE โชว์ "Xd" ต่อตัว + ป้าย due บนกล่อง (`checkDue` = daysSince(lastCheckedAt??purchaseDate) ≥ เกณฑ์ชนิด); ตั้งเกณฑ์ใน dialog ตั้งค่าระบบ; **BE `services/crabCheck.service.ts` `generateCrabCheckTasks()`** (mirror generateRestockTasks) เรียกใน `scheduler.tick` → สร้าง Task `CRAB_CHECK` (`linkType:'Crab'`); ปิดเมื่อบันทึกโซน MEASURE (ใน `updateCrab`) หรือกด "ทำเสร็จแล้ว" (CRAB_CHECK ไม่อยู่ใน RECORD_CLOSED_TYPES)
  - **ข้อ 4 (การกิน):** `Crab.feedingNote` + FE โซน "การกิน" (chip `ไม่กินปลา/ไม่กินหอย/กินน้อย/กินปกติ` + พิมพ์เพิ่ม) + ไอคอนบนกล่อง
  - **ข้อ 7:** filter chip โชว์จำนวน (`filterCounts`)
  - **ข้อ 8 (วันเช็ค + ประวัติแยกโซน):** ฟอร์มเพิ่มช่อง `lastCheckedAt` (default วันนี้เฉพาะปูใหม่); **BE `updateCrab` diff โซน** (`ZONE_FIELDS` MEASURE/CLASSIFY/FEEDING/SOURCE) → insert `CrabHistory` เฉพาะโซนที่ค่าเปลี่ยนจริง; `getCrab` include history; FE lazy-load `crabApi.get(id)` + ปุ่ม `mdi-history` ต่อโซน (popover); **ทดสอบ: patch แค่น้ำหนัก→ประวัติเพิ่มเฉพาะ MEASURE, patch แค่ feedingNote→เฉพาะ FEEDING** ✅
  - **ข้อ 5 (แดชบอร์ด+ข้อความโพสต์):** `DashboardView` โหลด `crabApi.list` คำนวณสต็อกสด (ไข่/เนื้อ/พร้อมขาย/อายุเฉลี่ย) + การ์ดข้อความโพสต์ (จัดกลุ่มปู READY ตาม `sizeBuckets` `perKilo=1000/weightG` → กี่โล, textarea แก้ได้ + copy) + dialog ตั้งช่วงไซส์ (persist `systemApi.update(sizeBuckets)`) + ตาราง byCategory/กำไรต่อวัน
  - **ข้อ 6 (ส่งออก CSV):** BE `crab.service.exportCrabsCsv` + route `GET /crabs/export?systemId` (ต้องมาก่อน `/:id`, มี BOM ให้ Excel อ่านไทย); FE `crabApi.exportCsv` (blob) + ปุ่มในแดชบอร์ด
  - **ข้อ 9 (ESP32):** ตอบเป็นคำแนะนำเตรียมตัวเท่านั้น (device API key + `/api/ingest/reading` + `SensorReading`/แปลงเป็น WaterTest ใช้ event chain เดิม) — ยังไม่เขียนโค้ด ดูแผน `goofy-herding-waffle.md`
  - **gotcha:** (1) nullable **Json** (`sizeBuckets`) ต้องใช้ `Prisma.DbNull` แทน null (มี `normalizeSystemData` ใน system.service); (2) enum `reminderType` ใน `routes/scheduler.ts` ต้องเพิ่ม `CRAB_CHECK` ด้วย ไม่งั้น query `/tasks?type=CRAB_CHECK` 400
  - **แก้ตามเทสรอบ 2 (3 จุด):** (1) **%ไข่ถูกตัดบนกล่อง** → แยก span `crab-size`(หด/ตัดได้) กับ `crab-pct`(ห้ามตัด, flex 0 0 auto) + ขยายกล่อง 108→122px; (2) **window scroll ยังเด้งบนสุด** เพราะ dialog fullscreen ล็อก scroll ทำ `window.scrollY`=0 ตอนจับ → เปลี่ยนไปจับ `savedWindowY` **ก่อนเปิด dialog** (openBox/openBatch) แล้วคืนหลาย tick (rAF + setTimeout 300ms) กันโดนรีเซ็ต; (3) **ประวัติซ้ำ** — `lastCheckedAt`/`purchaseDate` FE ส่ง date-only กลับ (เวลาหาย) → diff เห็น "เปลี่ยน" ทุกครั้ง เลยบันทึกโซน MEASURE/SOURCE ซ้ำแม้แก้แค่การกิน → **แก้ `norm()` ให้เทียบ Date ระดับวัน (`toISOString().slice(0,10)`)**; ทดสอบจริง: แก้แค่ feedingNote (full body, วันที่ date-only, stored lastCheckedAt มีเวลา) → MEASURE ไม่เพิ่ม, FEEDING +1 ✅
  - **แก้ตามเทสรอบ 3 (2 จุด):** (1) **ปุ่มลบประวัติ** — BE `crab.service.deleteCrabHistory` + route `DELETE /crabs/history/:id` (assertOwnership; path 2 segment ไม่ชน `/:id`) + FE `crabApi.deleteHistory` + ปุ่มถังขยะในแต่ละแถว popover (`removeHistory` อัปเดต cache); (2) **ไม่ขยายกล่อง** — คืน `box-cell` 122→108px, `khitText` เอา " ขีด" + จุดคั่นออก → หน้ากล่องเป็น "1.6 ไข่ 30% 17d" (แยก span `crab-size`/`crab-pct` เหมือนเดิม %ไข่ยังไม่ถูกตัด)
- **2026-06-30** — **รอบฟีดแบ็คที่ 3 (8 ข้อ)** — BE typecheck + FE build ผ่าน:
  - **#1 ไอคอน tab browser:** เปลี่ยน `public/favicon.svg` เป็นปู 🦀 (พื้นเขียว) + `index.html <title>` = "🦀 ฟาร์มปูคอนโด"; เอา avatar วงกลม 🦀 (พื้นจาง contrast ไม่พอ) ออกจาก `App.vue` nav bar → เหลือ title เรียบ
  - **#2 chip กรองคู่ค้า:** `CommerceView` แท็บคู่ค้าเพิ่ม chip `ทั้งหมด / คนรับซื้อปูแน่น (BUYER) / ผู้ขายปูอ่อน (SELLER)` (BOTH เข้าทั้งสอง) + relabel ชนิดในตาราง/ดรอปดาวน์
  - **#3 รูปโปรไฟล์ LINE = null:** *ไม่ใช่บั๊กโค้ด* — user id 5 (LINE) ถูกสร้างก่อนฟีเจอร์ avatar (phase14, 2026-06-28) และยังไม่ได้ล็อกอินใหม่ → DB เก็บ avatarUrl=null; `oauth.service` ดึง picture จาก id_token/`/v2/profile` อยู่แล้ว → **แก้ด้วยการ logout แล้ว login LINE ใหม่** (ต้อง deploy backend ที่มี avatar code ด้วย) — email เป็น `@oauth.local` เพราะ LINE ยังไม่เปิดสิทธิ์ Email (แยกจาก picture)
  - **#4 cron "3 วันเว้น 1":** standard cron ทำไม่ได้ (period 4 ไม่ลงตัวกับเดือน, `*/4` รีเซ็ตทุกต้นเดือน) → **แนะนำ 3 กฎ INTERVAL_DAYS=4** เริ่มเหลื่อมวันละ 1 (วันนี้/พรุ่งนี้/มะรืน) = ฟีด 3 เว้น 1 แบบ rolling จริง
  - **#5 ปฏิทินคลิก event → popup:** `CalendarView` เพิ่ม dialog รายละเอียด (Task: ประเภท/สถานะ/ครบกำหนด/เตือนแล้ว · Rule: กำหนดถัดไป) + ปุ่มไปหน้าจัดการ (แทนการ route ทันที); เก็บ object ใน `extendedProps`
  - **#6 DOSING ตามรอบกดทำเสร็จไม่ได้:** `task.service.completeTaskManually` + FE `canComplete` — DOSING ที่ `ruleId != null` (กฎเตือนเติมสารตามรอบ ไม่มี record มาปิด) อนุญาตกด "ทำเสร็จแล้ว"; DOSING จาก event chain (ruleId=null) ยังต้องปิดด้วยวัดน้ำ
  - **#7 popup มือถือคลิก input ค้าง/scroll ค้างหลัง blur:** ใส่ `:fullscreen="mobile"` (useDisplay) ให้ dialog ฟอร์มทุกหน้า (Commerce sell/contact, Dosing cal/rule, Inventory item/adjust, Ledger, Reminders, Substances, Water target, Crabs sys/settings) — แก้แบบเดียวกับ dialog ปู (ข้อ 1.1 เดิม)
  - **#8 ลดโหมดขายปู:** เอา toggle `ตามจำนวนตัว/ตามน้ำหนัก/ตามสเปกลูกค้า` ออก → เหลือ toggle `ระบุเป็นจำนวนตัว / ระบุเป็นกิโล` (เดิมซ้อนใต้สเปก) เป็นระดับบนสุด; `sellForm.mode` คงที่ = 'spec'
- **2026-06-29** — **รอบฟีดแบ็คที่ 2 (6 ข้อ หลังผู้ใช้เทสจริง)** — FE-only, build ผ่าน:
  - **#2 แท็บปูถูกบีบครึ่งบนในมือถือ:** เอา prop `scrollable` ออกจาก dialog ปู → ใช้ flex layout เอง (`.crab-dialog-body { flex:1; min-height:0; overflow-y:auto }`, header/tabs/actions `flex:0 0 auto`, `.is-mobile` height:100%) แท็บไม่ถูกบีบแล้ว
  - **#3 ขายตามสเปกเป็นกิโล:** เพิ่ม `specUnit: 'count'|'kg'` + toggle ในโหมดสเปก; `addByKg()` เลือกปูจนน้ำหนักถึงเป้าต่อชนิด; `specShortfall` คืน missing เป็น string (ตัว/กก.)
  - **#4/#5 ใบเสนอราคาเป็นรูป (ไม่ใช่ปริ้น):** `npm i html2canvas`; เปลี่ยน `buildDocHtml`(เปิดหน้าต่างปริ้น) → `buildDocMarkup`(เนื้อใน) + render ผ่าน element off-screen `.farmdoc` (style แบบ **ไม่ scoped** เพราะ v-html) → `generateDoc()` ใช้ html2canvas → รูป PNG; dialog พรีวิว + ปุ่ม **ดาวน์โหลดรูป / คัดลอกรูป (ClipboardItem) / แชร์ (navigator.share files)**; ฟอนต์ไทยใช้ IBM Plex Sans Thai ที่โหลดอยู่แล้ว
  - **#1 แจ้งเตือนเลือกวันในสัปดาห์:** RemindersView เพิ่ม pseudo-mode `'WEEKLY'` (chip เลือกวัน อา-ส + เวลา) → แปลงเป็น CRON ตอนบันทึก (`mm hh * * d,d`); `parseWeeklyCron` แปลงกลับตอน edit/แสดงผล; **backend cron matcher รองรับ dow list อยู่แล้ว ไม่ต้องแก้**
  - **#6 (คำศัพท์):** ยืนยัน "ใบเสนอราคา" (ก่อนขาย) ถูกต้อง; หลังปิดการขายใช้ "ใบเสร็จรับเงิน" (โค้ดแยก quotation/receipt ตามสถานะ txn อยู่แล้ว)
- **2026-06-28** — **เริ่มรอบปรับ UI/บั๊กตามฟีดแบ็คผู้ใช้ (5 ส่วน: หน้าปู / น้ำ / คู่ค้า-ขายปู / layout-ธีม / ปฏิทิน)** ทำเรียงตามลำดับ. **เฟส 1 (หน้าปู) เสร็จ — typecheck ผ่านทั้ง BE+FE:**
  - **`CrabsView.vue` รื้อใหญ่:** รวม dialog ปูเป็น **แท็บ (1 ตัว/แท็บ)** คลิกกล่อง→เข้ารายละเอียดทันที (ตัด chooser), ปุ่ม **บันทึกร่วม freeze ล่างสุด** (บันทึกทุกแท็บ), ปุ่มลบปูในแท็บ, **fullscreen บนมือถือ** (`useDisplay().mobile` แก้ scroll ค้าง ข้อ 1.1), จัดโซนฟอร์มใหม่ (น้ำหนัก+%ไข่ ก่อนราคา), `clearable` วันที่ (ข้อ 1.6.5), **ขุนเนื้อ→เพศผู้ / ขุนไข่→เพศเมีย อัตโนมัติ** (`applyTypeSex`), ตัดราคาขาย/วันที่ขาย/สถานะ SOLD ออกจากในกล่อง (ข้อ 3.5)
  - **confirm dialog ในแอป** แทน `window.confirm` (มือถือกดลบปูได้ ข้อ 1.9); **chip กรอง** ไข่/เนื้อ/พร้อมขาย (1.4); ย้าย legend ไปปุ่ม ⓘ (1.2); ขยายกล่อง 108px แก้ %ไข่ถูกตัด (1.3); ปุ่มรับล็อตสีเด่น (1.5)
  - **รับปูเข้าล็อต:** ระบุ**จำนวนปูต่อกล่อง** + **น้ำหนักรายตัว (บังคับกรอก)** กระจายต้นทุนตามน้ำหนัก (ข้อ 1.8, 1.10)
  - **backend `crab.service`:** auto-code ไม่ซ้ำในระบบ (`uniqueCodeInSystem` → 1A1, 1A1-2, …) ข้อ 1.6.7
  - **migration `phase13_box_color` (ข้อ 1.11):** เพิ่ม `CrabBox.color String?` (สีพื้นกล่อง) + zod `boxBody.color` + FE color picker ในหัว dialog + ทาสีกล่อง. ⚠️ **ยังไม่ apply ลง DB** — ผู้ใช้จะรัน `npx prisma migrate deploy` เอง (คอลัมน์ nullable เพิ่มอย่างเดียว ปลอดภัย); regenerate client แล้ว
  - migration `phase13_box_color` **apply ลง DB จริงแล้ว** (2026-06-28)
- **2026-06-28 (เฟส 2 — น้ำ)** เสร็จ + typecheck ผ่าน:
  - **ข้อ 2.2:** `waterTestBody.note` เปลี่ยน `z.string().optional()` → `.nullable().optional()` — เดิม FE ส่ง `note:null` ตอนเว้นว่าง แต่ zod ไม่รับ null → ดูเหมือน "required" (จริงๆ คือ validation fail)
  - **ข้อ 2.1 (ค่าที่ลืมวัดรอบนี้ห้ามถือว่าผ่าน):** `water.service.mergedLatestValues()` รวมค่าจากประวัติ (take 30) → แต่ละพารามิเตอร์ยกค่ารอบล่าสุดที่ "วัดจริง" (ไม่ null); `createWaterTest` ประเมินจากค่า merged แทนเฉพาะ test ใหม่ → Mg ที่ลืมวัดรอบ 2 แต่รอบ 1 หลุดเกณฑ์ยังถูกเตือน + **ไม่ปิด DOSING task ผิดๆ**; เพิ่ม `stale?:boolean` ใน `DosingRecommendation` (export `PARAM_FIELD` จาก dosing.service). FE: `WaterView` + banner ใน `CrabsView` ใช้ค่า merged + ป้าย "ค่าเดิม ยังไม่วัดรอบนี้" (`mdi-history`)
- **2026-06-28 (เฟส 3 — คู่ค้า & ขายปู)** เสร็จ + typecheck ผ่าน (`CommerceView.vue` รื้อ, FE-only ไม่แตะ schema):
  - **3.4:** เอาปุ่ม "รายการซื้อขายใหม่" + dialog manual txn ออก (ลบโค้ดที่ไม่ใช้); เปลี่ยน "ขายยกล็อต"→**"ขายปู"**; **4.4** เปลี่ยนชื่อเมนู `CommerceView` meta.title → "คู่ค้า & ขายปู"
  - **3.1:** ตาราง candidate ในไดอะล็อกขายปูเพิ่ม **จุดสีเคเบิ้ลไทล์** + คอลัมน์ **ชนิด** + **ความแน่น/ไข่ %** (1 กล่องมีหลายตัว)
  - **3.2:** เพิ่มโหมด **"ตามสเปกลูกค้า"** (mode='spec'): กรอกจำนวนปูไข่/ปูเนื้อ + %ไข่ขั้นต่ำ → `autoPick` เลือกให้; `specShortfall` เตือนขาดแยกชนิด เช่น "ขาดปูเนื้อ (ตัวผู้) อีก 1 ตัว"
  - **3.3:** ปุ่ม **"ใบเสนอราคา"** ข้างปุ่มยืนยันขาย → `buildDocHtml('quotation')` + `printHtml` (เปิดหน้าต่างใหม่ พิมพ์ผ่านเบราว์เซอร์ — รองรับฟอนต์ไทย, **ไม่โชว์ต้นทุน/กำไร**); เอกสารมี header/ลูกค้า/ตารางปู/สรุปไข่-เนื้อ/ยอดรวม
  - **3.6:** ขาย DONE → ฝัง id ปูใน `transaction.note` เป็น `#1,2,3` → ปุ่ม 📄 ใน listing เปิดใบเสร็จ/ใบเสนอราคาย้อนหลัง (`openTxnDoc` parse id → map จาก `crabs` ที่โหลดมา รวม SOLD)
  - **gotcha:** receipt reconstruct จาก marker `#id,...` ใน note (ไม่เพิ่ม schema); ถ้าปูถูกลบภายหลัง = ข้ามรายการนั้น
- **2026-06-28 (เฟส 4 — layout/ธีม/เมนู)** เสร็จ + typecheck ผ่าน:
  - **4.5 (รูปโปรไฟล์ไลน์/กูเกิล):** migration `phase14_user_avatar` (`User.avatarUrl String? @db.Text`) **apply ลง DB จริงแล้ว**; `oauth.service` ดึง picture (Google `userinfo.picture`, LINE id_token `picture`/profile `pictureUrl`) → เก็บ/อัปเดตตอน callback; `auth.service.publicUser` คืน `avatarUrl`; FE `AuthUser.avatarUrl` + แสดงใน `App.vue`
  - **4.1:** เมนูจัดกลุ่ม (router meta `group`: overview/care/stock/commerce) → ภาพรวม / การเลี้ยงปู / คลัง&สูตร / การเงิน&ซื้อขาย(ล่างสุด)
  - **4.3:** dark/light toggle ขวาบน (`useTheme` + localStorage 'theme'); `vuetify.ts` เพิ่ม theme dark
  - **4.8** ฟอนต์ IBM Plex Sans Thai + Inter (`styles/global.css`); **4.7** โลโก้ปู 🦀 ที่ title; **4.6** บีบ system dropdown; **4.2** polish
- **2026-06-28 (เฟส 5 — ปฏิทิน)** เสร็จ + production build ผ่าน:
  - `npm i @fullcalendar/{core,vue3,daygrid,list,interaction}` (v6); `CalendarView.vue` + route `/calendar` (group overview, ข้อ 5.1); แสดง Task (dueAt, สีตามสถานะ) + nextRunAt ของ ReminderRule ("กำหนดถัดไป"); locale ไทย; คลิก→ไป tasks/reminders
  - **🎉 ครบทั้ง 5 เฟสรอบฟีดแบ็ค** (typecheck + build เขียวหมด) — เหลือผู้ใช้ทดสอบจริง
  - **ค้าง (ออปชัน):** ปฏิทินโชว์แค่ "กำหนดถัดไป" ของกฎ (ไม่ project cron หลาย occurrence)
- **2026-06-22** — **แยกข้อมูลขาดต่อ user ทุกโมดูล (per-user isolation)** แผน `velvety-plotting-shannon.md`:
  - เปลี่ยนโมเดลสิทธิ์จาก "shared read, owned write" → **เห็น/แก้ได้เฉพาะของตัวเอง**; **ADMIN = god mode** (เห็น/แก้ทุกคน)
  - **migration `phase11_user_isolation`** (apply + backfill ลง DB จริงแล้ว): เพิ่ม `ownerId Int?` (FK User) ใน `Contact`/`Substance`/`InventoryItem`/`DosingRule`/`ReminderRule`/`LedgerEntry` + `@@index([ownerId])`; **`Substance` unique เปลี่ยน `name` → `[ownerId, name]`** (คลังสารแยกต่อ user); backfill ข้อมูลเดิมทั้งหมดยกให้ jame (id 1)
  - **helper ใหม่ `lib/scope.ts`**: `ownedSystemIds`/`systemScopeWhere` (กลุ่ม system-scoped), `ownerWhere`/`assertOwnership`/`isAdmin` (กลุ่มมี ownerId ตรงๆ)
  - ทุก service: list/get/create/update/delete รับ `user: AuthUser` แล้วกรอง/assert เจ้าของ — กลุ่ม 1 (box/tank/crab/water/calibration) กรองผ่าน `systemId∈ownedSystems`; กลุ่ม 2 กรอง `ownerId`; `Transaction`/`OutreachLog` ผ่าน `contact.ownerId`; `Task` ผ่าน `userId`; dashboard scope ครบ
  - **central rules (systemId=null)** ของ `DosingRule`/`ReminderRule` ผูก `ownerId` → `evaluateWaterValues`/`fireEvent`/`listRules` ใช้เฉพาะของเจ้าของระบบ; แก้ `requireDosingRuleEdit` ให้เช็ค ownerId ของกฎกลาง
  - **multi-user notify**: `createTaskFromRule` ส่ง `userId=rule.ownerId`; restock task ใช้ `item.ownerId`; **เลิก fallback "user active คนแรก"** ใน `notify.ts` (เหลือ `MAIL_TO`); seed ผูก ownerId=jame ให้ substance/contact/reminder
  - เพิ่ม guard `requireSystemEdit` ที่ `POST /systems/:id/fire-event`
  - ✅ typecheck ผ่าน; ทดสอบจริง: ADMIN jame เห็นทั้งหมด (7 ระบบ/80 ปู/...), LINE user (FARM_OWNER id 5) เห็น **0 ทุกอย่าง** (เริ่มสะอาด); server boot + /api/health ผ่าน
- **2026-06-21** — เริ่ม "ปรับระบบครั้งใหญ่" (แผน `adaptive-wobbling-umbrella.md`):
  - **Phase 1 (Auth+RBAC):** migration `phase8_auth` (User.passwordHash/role, RefreshToken, CrabSystem.notifyEmail); JWT access+refresh (rotate/revoke), `requireAuth`+ownership ทุก write route ของ ปู/ระบบ/น้ำ/ปรุงน้ำ; FE auth store+interceptor+guard+read-only UI+banner ค่าน้ำ; ทดสอบ server ผ่าน (403/401/refresh rotation). ⚠️ owner จริงต้องรัน `SEED_ADMIN_PASSWORD=xxx npm run prisma:seed` ตั้งรหัสครั้งเดียว
  - **Phase 3 (multi-crab):** migration `phase10_multicrab` (Crab.cableTieColor); ลบ box-occupancy guard → 1 กล่องหลายตัว; FE box-cell โชว์ปูหลายตัว (จุดสี+ขีด+%) + chooser + swatch สี; ขายยกล็อต/คำนวณน้ำหนักไม่กระทบ (crab-level)
  - **Phase 4 (UI+notify):** `resolveRecipient` ใช้ `system.notifyEmail` ก่อน; FE โชว์ "ไข่ NN%"/"เนื้อ NN%" บนกล่อง + ปุ่ม ⚙️ ตั้งค่าระบบ; typecheck ผ่านทั้ง BE+FE, ทดสอบ server ผ่าน
  - **Phase 2 (OAuth Google+LINE):** migration `phase9_oauth` (OAuthAccount); `oauth.service` authorization-code flow เขียนเอง (global fetch, ไม่เพิ่ม dep); route `/auth/oauth/:provider/start|callback`; FE เปิดปุ่ม Google/LINE; ทดสอบ authorize URL ผ่าน (เหลือคลิกจริง) → **ครบ 4 เฟส**
- **2026-06-19** — แก้บั๊กแจ้งเตือนตามฟีดแบ็ค (4 ข้อ):
  1. **(ข้อ 1) เวลาแจ้งเตือน** — กฎ INTERVAL_DAYS/MONTHS ที่ไม่ใส่ `timeOfDay` เดิม `dueAt` อิงเวลาตอนสร้างกฎ → fix `computeNextRunAt` default `'08:00'` (`DEFAULT_TIME_OF_DAY`); + ตั้ง `process.env.TZ='Asia/Bangkok'` ใน `config/env.ts` (host เป็น UTC ทำให้ cron `0 20 * * *` + setHours เพี้ยน 7 ชม.) — ผู้ใช้ยังเลือกเวลาเองได้ผ่าน `timeOfDay`
  2. **(ข้อ 2) digest เตือนแค่ 2 รายการ** — root cause: ระบบ id 2/3 (สร้างผ่านหน้าเว็บ) `ownerId=null` → Task (systemId set, userId=null) resolve ปลายทางอีเมลไม่ได้ → `notifyPendingDigest` ทำ `if(!to) continue` ข้ามเงียบ (RESTOCK รอด เพราะตั้ง userId ตรงๆ). Fix: `createTask` fallback userId→user active คนแรก; `createSystem` default ownerId→user active คนแรก; `notify.ts` เพิ่ม `fallbackRecipient()` ส่งให้ `resolveRecipient`; **backfill DB จริง**: set ownerId ให้ 2 ระบบ + userId ให้ 5 task ค้าง
  3. **(ข้อ 3) ปิดงานตามรอบ** — เพิ่ม `completeTaskManually` + `POST /api/tasks/:id/complete` (ปุ่ม "ทำเสร็จแล้ว") สำหรับงานเตือนเฉยๆ; **บล็อก** type `WATER_TEST`/`DOSING`/`RESTOCK` (ปิดจาก record จริง); `createWaterTest` ปิด Task DOSING ที่ค้างอัตโนมัติเมื่อค่าทุกตัวกลับเข้าเกณฑ์ (คืน `closedDosingTaskId`). Frontend: ปุ่ม "ทำเสร็จแล้ว" ใน TasksView
  4. **(ข้อ 4) "0 ขีด"** — ไม่ใช่บั๊ก: weightG เก็บเป็นกรัม, frontend แปลง ÷100 → 1.5 ก. = 0 ขีดจริง (data entry ผู้ใช้)
  - **ไม่ต้อง migrate** (ไม่แตะ schema); typecheck ผ่านทั้ง backend + frontend (vue-tsc)
- **2026-06-15** — แก้ตามฟีดแบ็คผู้ใช้ (backend เฉพาะ): `dashboard.overview()` นับงานค้างใหม่ = งานของระบบ + งานที่ไม่ผูกระบบ (`OR systemId=null` เช่น RESTOCK) ให้ตรงกับ badge ที่เมนู (เดิมกรอง systemId อย่างเดียว → ตัวเลขไม่ตรง). ล็อกปูให้ลูกค้าประจำ (ข้อ 1) ใช้ `Crab.lockedForBuyerId` + route เดิม — **ไม่ต้อง migrate**. Plesk error `curl (3)` = URL มีช่องว่างท้าย + `SCHEDULER_SECRET` ใน Plesk ไม่ตรง `.env` (config ไม่ใช่บั๊กโค้ด)
- **2026-06-14** — เริ่มโปรเจกต์ Phase 1: scaffold + schema 7 โมดูล + health check
- **2026-06-14** — เพิ่ม `User` (เจ้าของระบบ) → ปลายทางแจ้งเตือน dynamic; เปลี่ยน email เป็น Host Atom SMTP (`EMAIL_USER`/`EMAIL_PASS`)
- **2026-06-14** — รัน migration `init` สำเร็จบน MySQL remote (`familysi_farmland`), ทดสอบ `/api/health` + `/api/health/db` ผ่าน — Phase 1 ✅
- **2026-06-14** — Phase 2 CRUD: โมดูล A (`services/system.service.ts`, `routes/systems.ts`) + B (`services/crab.service.ts`, `routes/crabs.ts`), helper `serialize`/`validation`, mount ใน `routes/index.ts`, typecheck ผ่าน
- **2026-06-14** — `prisma/seed.ts` รันลง DB จริง (user+ระบบ+30 กล่อง+3 ถัง+7 WaterTarget+8 Substance); ทดสอบ CRUD+box-occupancy ผ่าน server — Phase 2 ✅. บันทึก insight โมเดล dosing = calibration-based (กระทบ schema Phase 3)
- **2026-06-14** — Phase 3 โมดูล C: redesign dosing เป็น calibration-based (เพิ่ม model `DosingCalibration`, `DosingRule` ทิ้ง `amountBasisL`/`amountPerDose`→`fixedDose`); migration `phase3_water_dosing_calibration` apply ลง DB จริง; เพิ่ม `water.service`/`dosing.service` + `routes/water`/`routes/dosing`; ทดสอบบน server จริง (dose `(14−9)/2.5=2` ถูก) — Phase 3 ✅
- **2026-06-14** — Phase 4 Reminder Engine: เพิ่ม `lib/cron.ts` (cron matcher เขียนเอง) + `lib/notify.ts` + `task/reminder/scheduler.service` + `routes/scheduler`; tick endpoint + ตามจิก + event chain (WaterTest ปิด Task → สร้าง Task ปรุงน้ำ); internal cron (dev) + seed 3 ReminderRule; **ไม่ต้อง migrate** (model D มีอยู่แล้ว); typecheck ผ่าน — Phase 4 ✅ (ยังไม่ทดสอบ server/เมลจริง)
- **2026-06-14** — Phase 6 โมดูล F: เพิ่ม `ledger.service` (CRUD + `syncLedgerForTransaction` hook) + `dashboard.service` (overview/finance/crabs analytics) + `routes/finance` (mount `/api/ledger`,`/api/dashboard`); Transaction status→DONE ลง LedgerEntry อัตโนมัติ (SELL→INCOME/CRAB_SALE, BUY→EXPENSE/CRAB_PURCHASE), ออกจาก DONE→ลบ entry, delete txn→ลบ entry กัน orphan; dashboard คำนวณ aggregate ใน JS (byCategory/byMonth/crab profit-per-day); **ไม่ต้อง migrate** (model F มีอยู่แล้ว); typecheck ผ่าน — Phase 6 ✅. **Phase 7** = ไม่แก้ seed (ผู้ใช้เลือกไม่ seed ข้อมูลปลอมลง DB จริง, WaterTarget เก็บว่าง) ✅ → Backend ครบทุก phase, ต่อไป Frontend
- **2026-06-14** — Phase 5 โมดูล E: เพิ่ม `contact/transaction/outreach.service` + `routes/commerce` (mount `/api/contacts`,`/api/transactions`,`/api/outreach`); Transaction คำนวณกำไรล่วงหน้า (`profit=totalPrice−costBasis`, costBasis auto จาก `crab.purchasePrice`) + `POST /transactions/preview`; OutreachLog `start-round` เปิดรอบไล่ทักคู่ค้า (idempotent); fix gotcha query boolean (`z.coerce.boolean` มอง `"false"`=true → ใช้ enum transform); seed +3 Contact; **ไม่ต้อง migrate** (model E มีอยู่แล้ว); typecheck ผ่าน — Phase 5 ✅ (ยังไม่ทดสอบ server จริง)
