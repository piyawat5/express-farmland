import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

// ── โมดูล F: Dashboard / analytics ─────────────────────────────────────
//
// รวมศูนย์ตอบ pain point #2 (ต้นทุน/กำไร) และ #3 (วิเคราะห์น้ำหนัก/ความแน่น
// เทียบระยะเวลาเลี้ยง ว่าคุ้มไหม) — คำนวณใน JS เพื่อเลี่ยง raw SQL ที่ผูกกับ MySQL
// และจัดการ Prisma.Decimal ได้ตรงไปตรงมา

const num = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function dateRange(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return { gte: from, lte: to };
}

// ── สรุปการเงิน (จาก LedgerEntry) ──────────────────────────────────────
export type FinanceQuery = { systemId?: number; from?: Date; to?: Date };

export async function financeSummary({ systemId, from, to }: FinanceQuery) {
  const entries = await prisma.ledgerEntry.findMany({
    where: { systemId, occurredAt: dateRange(from, to) },
    orderBy: { occurredAt: 'asc' },
  });

  let totalIncome = 0;
  let totalExpense = 0;
  const catMap = new Map<string, { category: string; income: number; expense: number }>();
  const monthMap = new Map<string, { month: string; income: number; expense: number }>();

  for (const e of entries) {
    const amt = num(e.amount);
    const isIncome = e.kind === 'INCOME';
    if (isIncome) totalIncome += amt;
    else totalExpense += amt;

    const cat = catMap.get(e.category) ?? { category: e.category, income: 0, expense: 0 };
    if (isIncome) cat.income += amt;
    else cat.expense += amt;
    catMap.set(e.category, cat);

    const monthKey = e.occurredAt.toISOString().slice(0, 7); // YYYY-MM
    const m = monthMap.get(monthKey) ?? { month: monthKey, income: 0, expense: 0 };
    if (isIncome) m.income += amt;
    else m.expense += amt;
    monthMap.set(monthKey, m);
  }

  const byCategory = [...catMap.values()].map((c) => ({
    category: c.category,
    income: round2(c.income),
    expense: round2(c.expense),
    net: round2(c.income - c.expense),
  }));
  const byMonth = [...monthMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      month: m.month,
      income: round2(m.income),
      expense: round2(m.expense),
      net: round2(m.income - m.expense),
    }));

  return {
    totalIncome: round2(totalIncome),
    totalExpense: round2(totalExpense),
    net: round2(totalIncome - totalExpense),
    entryCount: entries.length,
    byCategory,
    byMonth,
  };
}

// ── วิเคราะห์การขุนปู (pain point #3) ──────────────────────────────────
export async function crabAnalytics({ systemId }: { systemId?: number }) {
  // ปูที่ขายแล้ว — วิเคราะห์ "คุ้มไหม": กำไร เทียบ ระยะเวลาเลี้ยง / น้ำหนัก / ความแน่น
  const sold = await prisma.crab.findMany({
    where: { systemId, status: 'SOLD' },
    orderBy: { sellDate: 'desc' },
  });

  const items = sold.map((c) => {
    const purchasePrice = c.purchasePrice == null ? null : num(c.purchasePrice);
    const sellPrice = c.sellPrice == null ? null : num(c.sellPrice);
    const profit =
      purchasePrice != null && sellPrice != null ? round2(sellPrice - purchasePrice) : null;
    const durationDays =
      c.purchaseDate && c.sellDate
        ? Math.round((c.sellDate.getTime() - c.purchaseDate.getTime()) / MS_PER_DAY)
        : null;
    // กำไรต่อวันเลี้ยง — บอกความคุ้มค่าของการถือปูตัวนี้
    const profitPerDay =
      profit != null && durationDays != null && durationDays > 0
        ? round2(profit / durationDays)
        : null;
    return {
      id: c.id,
      code: c.code,
      type: c.type,
      weightG: c.weightG == null ? null : num(c.weightG),
      currentFirmnessPct: c.currentFirmnessPct,
      purchasePrice,
      sellPrice,
      profit,
      durationDays,
      profitPerDay,
    };
  });

  // ค่าเฉลี่ย — เฉพาะตัวที่มีข้อมูลครบในแต่ละมิติ
  const avg = (vals: (number | null)[]) => {
    const nums = vals.filter((v): v is number => v != null);
    return nums.length ? round2(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
  };
  const totalProfit = round2(
    items.reduce((s, i) => s + (i.profit ?? 0), 0),
  );

  // นับปูที่ยังอยู่ในระบบ แยกตามสถานะ
  const byStatusRaw = await prisma.crab.groupBy({
    by: ['status'],
    where: { systemId },
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(byStatusRaw.map((r) => [r.status, r._count._all]));

  return {
    soldCount: items.length,
    totalProfit,
    avgProfit: avg(items.map((i) => i.profit)),
    avgDurationDays: avg(items.map((i) => i.durationDays)),
    avgProfitPerDay: avg(items.map((i) => i.profitPerDay)),
    avgWeightG: avg(items.map((i) => i.weightG)),
    avgFirmnessPct: avg(items.map((i) => i.currentFirmnessPct)),
    byStatus,
    items,
  };
}

// ── ภาพรวม (overview) — การ์ดสรุปหน้าแรก ───────────────────────────────
export async function overview({ systemId }: { systemId?: number }) {
  // งานค้าง: นับงานของระบบที่เลือก + งานที่ไม่ผูกระบบ (เช่น RESTOCK ของใกล้หมด systemId=null)
  // ให้ตรงกับ badge ที่เมนู (ซึ่งนับงาน PENDING ทั้งหมด) — กันตัวเลข dashboard ไม่ตรง
  const pendingWhere = systemId
    ? { status: 'PENDING' as const, OR: [{ systemId }, { systemId: null }] }
    : { status: 'PENDING' as const };

  const [systemCount, crabByStatus, boxByStatus, pendingTasks, finance] = await Promise.all([
    systemId ? Promise.resolve(1) : prisma.crabSystem.count(),
    prisma.crab.groupBy({ by: ['status'], where: { systemId }, _count: { _all: true } }),
    prisma.crabBox.groupBy({ by: ['status'], where: { systemId }, _count: { _all: true } }),
    prisma.task.count({ where: pendingWhere }),
    financeSummary({ systemId }),
  ]);

  return {
    systemCount,
    crabs: Object.fromEntries(crabByStatus.map((r) => [r.status, r._count._all])),
    boxes: Object.fromEntries(boxByStatus.map((r) => [r.status, r._count._all])),
    pendingTasks,
    finance: {
      totalIncome: finance.totalIncome,
      totalExpense: finance.totalExpense,
      net: finance.net,
    },
  };
}
