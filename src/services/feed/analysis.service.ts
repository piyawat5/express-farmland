import { prisma } from '../../lib/prisma';
import { addDays, startOfLocalDay, ymdLocal } from '../../lib/feedingCycle';
import { MAX_GAP_DAYS, analyzeFeeding } from '../../lib/feedAnalysis';
import type { AuthUser } from '../auth.service';

// ════════════════════════════════════════════════════════════════════
//  วิเคราะห์อาหาร v2 (P7 · ข้อ 4.8) — ทั้งฟาร์ม (ทุกระบบ) ย้อนหลัง N วัน
//  อ่านผลเช็ค % ไข่ (CrabCheck) + ผลการกินรายตัว (FeedingEntry ของรอบที่ให้อาหารแล้ว)
//  แล้วส่งให้ lib/feedAnalysis.ts คิด (pure — หน้าเว็บ demo ใช้ตัวเดียวกัน)
// ════════════════════════════════════════════════════════════════════

export async function feedAnalysis(user: AuthUser, days = 180) {
  const today = startOfLocalDay(new Date());
  const fromDate = addDays(today, -(days - 1));
  // ช่วงที่จบในช่วงที่ดูอาจเริ่มก่อนหน้านั้นได้ (สูงสุด MAX_GAP_DAYS) → โหลดเผื่อ
  const loadFrom = addDays(fromDate, -MAX_GAP_DAYS);

  const [items, checks, entries] = await Promise.all([
    prisma.feedItem.findMany({
      where: { ownerId: user.id },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, emoji: true },
    }),
    prisma.crabCheck.findMany({
      where: { checkedAt: { gte: loadFrom }, pct: { not: null }, crab: { ownerId: user.id, type: 'EGG', deletedAt: null } },
      select: { crabId: true, checkedAt: true, pct: true },
    }),
    prisma.feedingEntry.findMany({
      where: {
        itemId: { not: null },
        round: { ownerId: user.id, status: 'DONE', feedDate: { gte: ymdLocal(loadFrom) } },
        crab: { deletedAt: null },
      },
      select: { crabId: true, itemId: true, result: true, round: { select: { feedDate: true } } },
    }),
  ]);

  return analyzeFeeding({
    from: ymdLocal(fromDate),
    to: ymdLocal(today),
    items,
    checks: checks.map((c) => ({ crabId: c.crabId, day: ymdLocal(c.checkedAt), pct: c.pct! })),
    entries: entries.map((e) => ({ crabId: e.crabId, day: e.round.feedDate, itemId: e.itemId!, result: e.result })),
  });
}
