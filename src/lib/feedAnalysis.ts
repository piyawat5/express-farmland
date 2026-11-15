// ════════════════════════════════════════════════════════════════════
//  วิเคราะห์อาหาร v2 (P7) — กติกาที่ไม่ผูกกับ DB (pure)
//  ⚠️ สำเนาอยู่ที่หน้าเว็บ src/lib/feedAnalysis.ts (demo ใช้) แก้คู่กัน
//
//  ตอบ 2 คำถาม (ข้อ 4.8):
//   1. อาหารไหนทำให้ไข่ขึ้นเร็วกว่า
//      ช่วงระหว่างการเช็ค % ไข่ 2 ครั้งติดกันของปูไข่แต่ละตัว = 1 "ช่วง"
//      → % ไข่ที่ขึ้นต่อสัปดาห์ + ปูตัวนั้นกินอะไรในช่วงนั้น (นับจากผลการกินรายตัว: กินหมด 1 · กินน้อย ½ · ไม่กิน 0)
//      → อาหารไหน ≥ 70% = "กิน…เป็นหลัก" · ไม่ถึง = "ผสม"
//      → เทียบค่าเฉลี่ยของกลุ่มที่มีข้อมูลพอ (≥ 5 ช่วง จากปู ≥ 3 ตัว) · ไม่พอ = บอกตรงๆ ว่ายังสรุปไม่ได้
//   2. ปูกินอะไรหมดมากกว่า — สัดส่วน กินหมด/กินน้อย/ไม่กิน ต่ออาหาร (≥ 20 มื้อ ถึงจะสรุป)
// ════════════════════════════════════════════════════════════════════

/** ช่วงสั้นกว่านี้ = ส่องซ้ำ ค่าแกว่งมากกว่าการขึ้นจริง */
export const MIN_GAP_DAYS = 5;
/** ช่วงยาวกว่านี้ = ลืมเช็คนาน ไม่รู้ว่าขึ้นตอนไหน */
export const MAX_GAP_DAYS = 60;
/** ช่วงที่กินน้อยกว่านี้ไม่นับ (ไม่รู้ว่ากินอะไร) */
export const MIN_MEALS = 2;
/** อาหารเดียว ≥ สัดส่วนนี้ = "กิน…เป็นหลัก" */
export const MAIN_SHARE = 0.7;
export const NEED_INTERVALS = 5;
export const NEED_CRABS = 3;
export const NEED_MEALS = 20;
/** ต่างกันน้อยกว่านี้ (%/สัปดาห์) = พอๆ กัน */
export const SAME_GROWTH = 1;
/** ต่างกันน้อยกว่านี้ (จุด %) = กินหมดพอๆ กัน */
export const SAME_EAT = 3;

export type EatResult = 'ATE' | 'LITTLE' | 'NONE';

/** ผลเช็ค % ไข่ (ปูไข่เท่านั้น) — day = "YYYY-MM-DD" วันไทย */
export type AnCheck = { crabId: number; day: string; pct: number };
/** ปู 1 ตัวใน 1 รอบที่ให้อาหารเสร็จแล้ว — day = วันที่ของรอบ */
export type AnEntry = { crabId: number; day: string; itemId: number; result: EatResult };
export type AnItem = { id: number; name: string; emoji: string | null };

export type GrowthGroup = {
  /** null = ผสม */
  itemId: number | null;
  intervals: number;
  crabs: number;
  /** % ไข่ที่ขึ้นเฉลี่ยต่อสัปดาห์ (ทศนิยม 1 ตำแหน่ง) */
  perWeek: number | null;
};

export type GrowthVerdict =
  | { kind: 'faster'; fastId: number; slowId: number; diff: number }
  | { kind: 'same'; ids: number[]; diff: number }
  /** ให้อาหารอย่างเดียวมาตลอด → ยังเทียบไม่ได้ */
  | { kind: 'single'; itemId: number | null }
  | { kind: 'not_enough'; need: { itemId: number; intervals: number; crabs: number }[] };

export type EatStat = {
  itemId: number;
  meals: number;
  ate: number;
  little: number;
  none: number;
  /** % กินหมด (กินน้อยนับครึ่ง) */
  score: number;
};

export type EatVerdict =
  | { kind: 'better'; bestId: number; worstId: number; diff: number }
  | { kind: 'same'; ids: number[]; diff: number }
  | { kind: 'single'; itemId: number | null }
  | { kind: 'not_enough'; need: { itemId: number; meals: number }[] };

export type FeedAnalysis = {
  /** "YYYY-MM-DD" — ช่วงที่ดู (รวมวัน to) */
  from: string;
  to: string;
  days: number;
  items: AnItem[];
  growth: { groups: GrowthGroup[]; verdict: GrowthVerdict };
  eating: { items: EatStat[]; verdict: EatVerdict };
  totals: { crabs: number; intervals: number; meals: number };
};

const EAT_WEIGHT: Record<EatResult, number> = { ATE: 1, LITTLE: 0.5, NONE: 0 };

/** จำนวนวันระหว่าง "YYYY-MM-DD" 2 วัน (ไม่ขึ้นกับเขตเวลา) */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function analyzeFeeding(input: {
  from: string;
  to: string;
  checks: AnCheck[];
  entries: AnEntry[];
  items: AnItem[];
}): FeedAnalysis {
  const { from, to } = input;
  const inRange = (d: string) => d >= from && d <= to;

  // ── มื้อของแต่ละตัว (เรียงวัน) ──
  const mealsOf = new Map<number, AnEntry[]>();
  for (const e of input.entries) {
    const list = mealsOf.get(e.crabId) ?? [];
    list.push(e);
    mealsOf.set(e.crabId, list);
  }

  // ── 1. ไข่ขึ้นเร็วแค่ไหน แยกตามอาหารหลัก ──
  type Interval = { crabId: number; itemId: number | null; perWeek: number };
  const intervals: Interval[] = [];
  const checksOf = new Map<number, AnCheck[]>();
  for (const c of input.checks) {
    const list = checksOf.get(c.crabId) ?? [];
    list.push(c);
    checksOf.set(c.crabId, list);
  }
  for (const [crabId, list] of checksOf) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      // นับช่วงที่จบในช่วงที่ดู
      if (!inRange(b.day)) continue;
      const gap = daysBetween(a.day, b.day);
      if (gap < MIN_GAP_DAYS || gap > MAX_GAP_DAYS) continue;
      // ไข่เต็มแล้ว ขึ้นต่อไม่ได้
      if (a.pct >= 100) continue;
      const eaten = new Map<number, number>();
      let meals = 0;
      let total = 0;
      for (const m of mealsOf.get(crabId) ?? []) {
        if (m.day < a.day || m.day >= b.day) continue;
        meals++;
        const w = EAT_WEIGHT[m.result];
        total += w;
        eaten.set(m.itemId, (eaten.get(m.itemId) ?? 0) + w);
      }
      if (meals < MIN_MEALS || total <= 0) continue;
      let main: number | null = null;
      for (const [itemId, w] of eaten) if (w / total >= MAIN_SHARE) main = itemId;
      intervals.push({ crabId, itemId: main, perWeek: ((b.pct - a.pct) / gap) * 7 });
    }
  }

  const groupMap = new Map<number | null, Interval[]>();
  for (const iv of intervals) {
    const list = groupMap.get(iv.itemId) ?? [];
    list.push(iv);
    groupMap.set(iv.itemId, list);
  }
  const groups: GrowthGroup[] = [...groupMap].map(([itemId, list]) => ({
    itemId,
    intervals: list.length,
    crabs: new Set(list.map((x) => x.crabId)).size,
    perWeek: round1(list.reduce((s, x) => s + x.perWeek, 0) / list.length),
  }));
  // อาหารก่อน (เร็วสุดก่อน) แล้ว "ผสม" ท้ายสุด
  groups.sort((a, b) => (a.itemId == null ? 1 : 0) - (b.itemId == null ? 1 : 0) || (b.perWeek ?? 0) - (a.perWeek ?? 0));

  // อาหารที่ให้จริงในช่วงที่ดู (ไว้บอกว่าให้อย่างเดียว / ยังขาดข้อมูลของอะไร)
  const fedIds = [...new Set(input.entries.filter((e) => inRange(e.day)).map((e) => e.itemId))];
  const itemOrder = (id: number) => {
    const i = input.items.findIndex((x) => x.id === id);
    return i < 0 ? 999 : i;
  };
  fedIds.sort((a, b) => itemOrder(a) - itemOrder(b));

  let growthVerdict: GrowthVerdict;
  const ready = groups.filter((g) => g.itemId != null && g.intervals >= NEED_INTERVALS && g.crabs >= NEED_CRABS);
  if (ready.length >= 2) {
    const fast = ready[0];
    const slow = ready[ready.length - 1];
    const diff = round1((fast.perWeek ?? 0) - (slow.perWeek ?? 0));
    growthVerdict =
      diff < SAME_GROWTH
        ? { kind: 'same', ids: ready.map((g) => g.itemId!), diff }
        : { kind: 'faster', fastId: fast.itemId!, slowId: slow.itemId!, diff };
  } else if (fedIds.length <= 1) {
    growthVerdict = { kind: 'single', itemId: fedIds[0] ?? null };
  } else {
    const need = fedIds
      .map((itemId) => {
        const g = groups.find((x) => x.itemId === itemId);
        return { itemId, intervals: g?.intervals ?? 0, crabs: g?.crabs ?? 0 };
      })
      .sort((a, b) => b.intervals - a.intervals)
      .slice(0, 3);
    growthVerdict = { kind: 'not_enough', need };
  }

  // ── 2. กินอะไรหมดมากกว่า ──
  const eat = new Map<number, EatStat>();
  let meals = 0;
  for (const e of input.entries) {
    if (!inRange(e.day)) continue;
    meals++;
    const s = eat.get(e.itemId) ?? { itemId: e.itemId, meals: 0, ate: 0, little: 0, none: 0, score: 0 };
    s.meals++;
    if (e.result === 'ATE') s.ate++;
    else if (e.result === 'LITTLE') s.little++;
    else s.none++;
    eat.set(e.itemId, s);
  }
  const eatItems = [...eat.values()].map((s) => ({ ...s, score: Math.round(((s.ate + s.little / 2) / s.meals) * 100) }));
  eatItems.sort((a, b) => itemOrder(a.itemId) - itemOrder(b.itemId));

  let eatVerdict: EatVerdict;
  const eatReady = eatItems.filter((s) => s.meals >= NEED_MEALS).sort((a, b) => b.score - a.score);
  if (eatReady.length >= 2) {
    const best = eatReady[0];
    const worst = eatReady[eatReady.length - 1];
    const diff = best.score - worst.score;
    eatVerdict =
      diff < SAME_EAT
        ? { kind: 'same', ids: eatReady.map((s) => s.itemId), diff }
        : { kind: 'better', bestId: best.itemId, worstId: worst.itemId, diff };
  } else if (eatItems.length <= 1) {
    eatVerdict = { kind: 'single', itemId: eatItems[0]?.itemId ?? null };
  } else {
    eatVerdict = { kind: 'not_enough', need: eatItems.map((s) => ({ itemId: s.itemId, meals: s.meals })) };
  }

  return {
    from,
    to,
    days: daysBetween(from, to) + 1,
    items: input.items,
    growth: { groups, verdict: growthVerdict },
    eating: { items: eatItems, verdict: eatVerdict },
    totals: { crabs: new Set(intervals.map((x) => x.crabId)).size, intervals: intervals.length, meals },
  };
}
