# 🦀 express-farmland

Backend ของระบบจัดการเลี้ยง **ปูคอนโด (RAS)** — Express + Prisma + MySQL + TypeScript

แจ้งเตือนงานเลี้ยงปู (วัดน้ำ/ปรุงน้ำ/ให้อาหาร/ล้างกรอง) แบบ "ตามจิกจนกว่าจะทำ",
จัดการปูรายตัว, คู่ค้าซื้อ-ขาย, และ dashboard ต้นทุน/กำไร

> รายละเอียดสถาปัตยกรรม + decision อยู่ใน [CLAUDE.md](./CLAUDE.md)

## เริ่มใช้งาน (local dev)

```bash
# 1. ติดตั้ง dependencies
npm install

# 2. ตั้งค่า env
cp .env.example .env      # แล้วแก้ DATABASE_URL, SMTP_*, SCHEDULER_SECRET

# 3. สร้าง/อัปเดต schema ลง DB
npm run prisma:migrate    # ครั้งแรกจะถามชื่อ migration เช่น "init"

# 4. รัน dev (auto-reload)
npm run dev
```

ทดสอบ: เปิด `http://localhost:3000/api/health` และ `/api/health/db`

## สคริปต์
| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | รัน dev (tsx watch) |
| `npm run build` | `prisma generate` + compile TS → `dist/` |
| `npm start` | รัน production (`dist/server.js`) |
| `npm run prisma:migrate` | สร้าง migration + apply (dev) |
| `npm run prisma:deploy` | apply migration (production) |
| `npm run prisma:studio` | เปิด Prisma Studio ดู/แก้ข้อมูล |
| `npm run typecheck` | เช็ค type ไม่ build |

## Deploy ขึ้น Host Atom (Plesk + Node.js/Passenger)

1. **สร้าง MySQL database** ใน Plesk → เอา host/user/pass มาใส่ `DATABASE_URL`
2. **อัปโหลดโค้ด** (Git deploy หรือ FTP) — ยกเว้น `node_modules/`, `dist/`, `.env`
3. **Plesk → Node.js:**
   - Application Root = โฟลเดอร์โปรเจกต์
   - Application Startup File = `dist/server.js`
   - Application Mode = `production`
   - ตั้ง Environment variables ให้ตรงกับ `.env.example`
4. กด **NPM Install** (จะรัน `postinstall: prisma generate` ให้อัตโนมัติ)
5. รัน build: ใน Plesk Node.js panel → **Run Script** → `build`
   (หรือผ่าน SSH: `npm run build && npm run prisma:deploy`)
6. **apply migration:** `npm run prisma:deploy` (ผ่าน SSH หรือ Run Script)
7. **Restart App**

### ⏰ ตั้ง Scheduler (สำคัญ — ทำให้การเตือนทำงาน)
Plesk → **Scheduled Tasks** → เพิ่ม task แบบ *Fetch a URL* หรือ *Run a command* ทุก 15 นาที:

```bash
curl -s -X POST https://<your-domain>/api/scheduler/tick \
  -H "x-scheduler-secret: <SCHEDULER_SECRET>"
```

> ⚠️ ถ้า Prisma error เรื่อง binary ตอน deploy — เพิ่ม `binaryTargets` ของ OS host
> ใน `prisma/schema.prisma` (ดูคอมเมนต์ในไฟล์) แล้ว build ใหม่

## โครงสร้าง
ดู [CLAUDE.md](./CLAUDE.md) — Data model 7 โมดูล (ฮาร์ดแวร์/ปู/น้ำ/แจ้งเตือน/คู่ค้า/การเงิน/คลัง)
