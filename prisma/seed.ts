/**
 * Seed v2 — ข้อมูลของ "ร้าน" เท่านั้น (ข้อมูลฟาร์มของลูกค้าสร้างใน service ตอนสมัคร/สร้างระบบปู)
 * รันซ้ำได้ (idempotent) และไม่ทับค่าที่แอดมินแก้ในหลังบ้านไปแล้ว
 *
 *   npm run prisma:seed
 *   SEED_ADMIN_PASSWORD=xxxx npm run prisma:seed   ← ตั้ง/เปลี่ยนรหัสผ่านแอดมิน
 */
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ⚠️ ราคาตั้งต้นเท่านั้น — แก้ราคาจริงได้ที่หลังบ้าน → แพ็กเกจ
const PLANS = [
  { code: 'MONTHLY', name: 'รายเดือน', priceTHB: 199, durationDays: 30, sortOrder: 1 },
  { code: 'YEARLY', name: 'รายปี', priceTHB: 1990, durationDays: 365, sortOrder: 2, description: 'คุ้มกว่ารายเดือน' },
  { code: 'LIFETIME', name: 'ซื้อขาด', priceTHB: 4990, durationDays: null, sortOrder: 3, description: 'ไม่มีค่ารายเดือน' },
];

const SHOP = {
  shopName: 'ระบบจัดการปู',
  promptPayId: '0616366635',
  promptPayName: null,
  phone: null,
  facebookName: 'pintusornsri james piyawat',
  facebookUrl: null,
  lineOaUrl: null,
  graceDays: 3,
};

async function main() {
  for (const p of PLANS) {
    await prisma.plan.upsert({ where: { code: p.code }, create: p, update: {} });
  }

  // ตั้งค่าร้าน: สร้างครั้งแรกเท่านั้น
  await prisma.appSetting.upsert({
    where: { key: 'shop' },
    create: { key: 'shop', value: SHOP as unknown as Prisma.InputJsonValue },
    update: {},
  });

  const email = (process.env.SEED_ADMIN_EMAIL ?? 'jame.piyawat111@gmail.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
  // ล็อกอินด้วย Google ที่อีเมลเดียวกันได้เลย (OAuth ผูกบัญชีจากอีเมล)
  const admin = await prisma.user.upsert({
    where: { email },
    create: { email, name: 'แอดมิน', role: 'ADMIN', notifyEmail: email, passwordHash: passwordHash ?? null },
    update: { role: 'ADMIN', ...(passwordHash ? { passwordHash } : {}) },
  });

  // eslint-disable-next-line no-console
  console.log(`✅ seed v2: แพ็กเกจ ${PLANS.length} · ตั้งค่าร้าน · แอดมิน ${admin.email}${password ? ' (ตั้งรหัสผ่านแล้ว)' : ''}`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
