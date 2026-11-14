import { prisma } from '../../lib/prisma';

// อาหารเริ่มต้นของลูกค้าทุกคน (ข้อ 5.5) — สร้างตอนเปิดหน้าอาหาร/ตั้งแผนครั้งแรก
// ⚠️ ต้องตรงกับ src/api/mock/feed.ts ของหน้าเว็บ
export const DEFAULT_FEED_ITEMS = [
  { name: 'ปลา', emoji: '🐟', sortOrder: 1 },
  { name: 'หอย', emoji: '🐚', sortOrder: 2 },
];

export async function ensureFeedItems(ownerId: number) {
  const n = await prisma.feedItem.count({ where: { ownerId } });
  if (n) return;
  await prisma.feedItem.createMany({
    data: DEFAULT_FEED_ITEMS.map((d) => ({ ...d, ownerId, unit: 'ชิ้น' })),
    skipDuplicates: true,
  });
}
