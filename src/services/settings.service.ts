import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

// ════════════════════════════════════════════════════════════════════
//  ตั้งค่าร้าน (ของคุณ = เจ้าของระบบ) — เก็บใน AppSetting key "shop"
//  ใช้บนหน้า "รอเปิดใช้งาน" (QR พร้อมเพย์ + ช่องทางติดต่อ) และกติกาสิทธิ์ใช้งาน
// ════════════════════════════════════════════════════════════════════

export type ShopSettings = {
  shopName: string;
  /** เบอร์โทร / เลขบัตรประชาชน ที่ผูกพร้อมเพย์ — ใช้สร้าง QR ฝั่งหน้าเว็บ */
  promptPayId: string | null;
  /** ชื่อบัญชีที่ลูกค้าจะเห็นตอนโอน (ให้ลูกค้าเช็คว่าโอนถูกคน) */
  promptPayName: string | null;
  phone: string | null;
  facebookName: string | null;
  facebookUrl: string | null;
  lineOaUrl: string | null;
  /** หมดอายุแล้วยังใช้ต่อได้อีกกี่วัน (ช่วงผ่อนผันให้โอนต่ออายุ) */
  graceDays: number;
};

export const DEFAULT_SHOP: ShopSettings = {
  shopName: 'ระบบจัดการปู',
  promptPayId: null,
  promptPayName: null,
  phone: null,
  facebookName: null,
  facebookUrl: null,
  lineOaUrl: null,
  graceDays: 3,
};

const SHOP_KEY = 'shop';

// อ่านบ่อยมาก (ทุก request ที่เช็คสิทธิ์ใช้ graceDays) → cache สั้นๆ
let cache: { at: number; value: ShopSettings } | null = null;
const CACHE_MS = 60_000;

export async function getShopSettings(): Promise<ShopSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await prisma.appSetting.findUnique({ where: { key: SHOP_KEY } });
  const value = { ...DEFAULT_SHOP, ...((row?.value as Partial<ShopSettings> | null) ?? {}) };
  cache = { at: Date.now(), value };
  return value;
}

export async function updateShopSettings(patch: Partial<ShopSettings>): Promise<ShopSettings> {
  const current = await getShopSettings();
  const next = { ...current, ...patch };
  await prisma.appSetting.upsert({
    where: { key: SHOP_KEY },
    create: { key: SHOP_KEY, value: next as unknown as Prisma.InputJsonValue },
    update: { value: next as unknown as Prisma.InputJsonValue },
  });
  cache = { at: Date.now(), value: next };
  return next;
}
