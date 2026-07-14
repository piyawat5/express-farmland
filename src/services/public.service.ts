import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import { parseReservedCrabIds } from '../lib/reservations';

// ── หน้าร้าน public (ข้อ 5) ──────────────────────────────────────────────
// ไม่ต้อง login — คืนเฉพาะข้อมูลปลอดภัย (ไม่มีต้นทุน/กำไร/ownerId)
// โชว์ปูพร้อมขายจริง (READY) ที่ยังไม่ถูกจอง + ราคา/กก. ต่อชนิดจาก receiptSettings

type ShopSettings = {
  shopName?: string | null;
  logoUrl?: string | null;
  color?: string | null;
  footerNote?: string | null;
  priceEgg?: number | null;
  priceMeat?: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 1000 * 60 * 60 * 24;

export async function getPublicShop(slug: string) {
  const system = await prisma.crabSystem.findUnique({ where: { publicSlug: slug } });
  if (!system || !system.publicEnabled) throw notFound('ไม่พบร้านนี้ หรือร้านปิดอยู่');

  const settings = (system.receiptSettings ?? {}) as ShopSettings;
  const priceEgg = typeof settings.priceEgg === 'number' ? settings.priceEgg : null;
  const priceMeat = typeof settings.priceMeat === 'number' ? settings.priceMeat : null;

  const crabs = await prisma.crab.findMany({
    where: { systemId: system.id, status: 'READY' },
    orderBy: [{ type: 'asc' }, { weightG: 'desc' }],
    // ดึงรอบวัด MEASURE เพื่อหยิบรูปปูล่าสุด (เก็บใน snapshot.imageUrl) มาโชว์หน้าร้าน
    include: {
      history: { where: { zone: 'MEASURE' }, orderBy: { recordedAt: 'desc' } },
    },
  });

  // ตัดปูที่ถูกจอง (SELL/CONFIRMED ของเจ้าของระบบ)
  let reserved = new Set<number>();
  if (system.ownerId != null) {
    const txns = await prisma.transaction.findMany({
      where: { kind: 'SELL', status: 'CONFIRMED', contact: { ownerId: system.ownerId } },
      select: { kind: true, status: true, note: true },
    });
    reserved = parseReservedCrabIds(txns);
  }

  const priceOf = (type: string, weightG: number | null): number | null => {
    const per = type === 'EGG' ? priceEgg : type === 'MEAT' ? priceMeat : null;
    if (per == null || weightG == null) return null;
    return round2((per * weightG) / 1000);
  };

  const items = crabs
    .filter((c) => !reserved.has(c.id))
    .map((c) => {
      const weightG = c.weightG == null ? null : Number(c.weightG);
      // รูปล่าสุด = imageUrl ตัวแรกที่ไม่ว่างจากรอบ MEASURE (เรียงใหม่→เก่าแล้ว)
      const imageUrl =
        c.history
          .map((h) => (h.snapshot as { imageUrl?: string | null } | null)?.imageUrl ?? null)
          .find((u) => u) ?? null;
      // จำนวนวันเลี้ยง = นับจากวันรับปูเข้า (purchaseDate) ถึงวันนี้
      const daysRaised =
        c.purchaseDate == null
          ? null
          : Math.max(0, Math.floor((Date.now() - c.purchaseDate.getTime()) / DAY_MS));
      return {
        id: c.id,
        code: c.code,
        type: c.type,
        weightG,
        firmnessPct: c.currentFirmnessPct,
        cableTieColor: c.cableTieColor,
        price: priceOf(c.type, weightG),
        imageUrl,
        daysRaised,
      };
    });

  return {
    shop: {
      name: settings.shopName || system.name,
      logoUrl: settings.logoUrl ?? null,
      color: settings.color ?? null,
      footerNote: settings.footerNote ?? null,
      priceEgg,
      priceMeat,
    },
    crabs: items,
  };
}
