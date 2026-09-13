import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';
import { assertOwnership } from '../lib/scope';
import type { AuthUser } from './auth.service';
import { addDays, dayDiff, inferFoodType, ymdLocal, type FoodType } from '../lib/feedingCycle';

// ════════════════════════════════════════════════════════════════════
//  วิเคราะห์อาหาร (Phase 24) — "ให้ปลา/หอยไปเท่าไร" + "อาหารไหนทำให้ไข่ขึ้นเร็วกว่า"
//
//  วิธีคิดการเติบโต: จับคู่ "รอบวัด" ที่ติดกันของปูแต่ละตัว (CrabHistory โซน MEASURE)
//  → ในช่วงนั้นปูตัวนั้นกินปลากี่มื้อ หอยกี่มื้อ (นับตามคะแนนการกิน: กินหมด=1, กินน้อย=0.35, ไม่กิน=0)
//  → จัดช่วงเป็น ส่วนใหญ่ปลา / ส่วนใหญ่หอย / ผสม แล้วเทียบ %ไข่ที่เพิ่มต่อสัปดาห์
//  อ่านอย่างเดียว ไม่เขียนอะไรลง DB
// ════════════════════════════════════════════════════════════════════

const MIN_INTERVAL_DAYS = 3; // วัดห่างกันน้อยกว่านี้ = แก้ตัวเลข ไม่ใช่การเติบโต (ข้อมูลจริงมีวัดซ้ำวันเดียวกัน 30→60)
const MAJORITY_SHARE = 0.7; // มื้อที่กินเป็นปลา ≥70% = ช่วง "ส่วนใหญ่ปลา" (≤30% = ส่วนใหญ่หอย)

type FoodKey = FoodType | 'UNKNOWN';
const FOOD_KEYS: FoodKey[] = ['FISH', 'SHELLFISH', 'MIXED', 'UNKNOWN'];
const GROUPS: FoodType[] = ['FISH', 'SHELLFISH', 'MIXED'];

export type AnalysisQuery = { from?: string; to?: string }; // "YYYY-MM-DD" เวลาไทย

type Meal = { feedDate: string; food: FoodKey; units: number; gramsPerCrab: number | null };

type Interval = {
  crabId: number;
  crabCode: string | null;
  boxCode: string | null;
  crabType: string;
  from: string;
  to: string;
  days: number;
  pctFrom: number | null;
  pctTo: number | null;
  pctPerWeek: number | null;
  weightFrom: number | null;
  weightTo: number | null;
  weightPerWeek: number | null;
  fishMeals: number;
  shellMeals: number;
  fishShare: number;
  group: FoodType;
  grams: number | null; // อาหารที่ให้ปูตัวนี้ในช่วงนี้ (ประมาณจากกรัมทั้งรอบ ÷ จำนวนตัวที่บันทึก) — null ถ้ามีรอบที่ไม่ได้กรอกกรัม
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const avg = (xs: number[]) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return r2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** วันจันทร์ของสัปดาห์ ("YYYY-MM-DD") — ใช้จัดกลุ่มกราฟรายสัปดาห์ */
function weekStart(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`); // ไม่มี Z = เวลาท้องถิ่น
  return ymdLocal(addDays(d, -((d.getDay() + 6) % 7)));
}

/**
 * วันที่ของรอบวัด — ใช้ "วันเช็ค" ที่ผู้ใช้กรอก ถ้าเห็นว่าตั้งใจกรอกจริง ไม่งั้นใช้เวลาที่บันทึก
 * ข้อมูลจริง: ฟอร์มปูเติมวันเช็คเดิมให้ทุกครั้ง → หลายแถวมีวันเช็คซ้ำของรอบก่อน (ไม่ได้แก้)
 */
function measureDate(snap: Record<string, unknown>, recordedAt: Date, prevChecked: string | null): Date {
  const iso = typeof snap.lastCheckedAt === 'string' ? snap.lastCheckedAt : null;
  if (!iso || iso === prevChecked) return recordedAt;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() > recordedAt.getTime() + 86_400_000) return recordedAt;
  return d;
}

function summarize(list: Interval[]) {
  const pct = list.map((i) => i.pctPerWeek).filter((v): v is number => v != null);
  const weight = list.map((i) => i.weightPerWeek).filter((v): v is number => v != null);
  // กรัมต่อ 1% ที่เพิ่ม — เฉพาะช่วงที่รู้กรัมครบ; ไข่ไม่ขึ้นเลย = คำนวณไม่ได้
  let grams = 0;
  let gain = 0;
  let gramsSamples = 0;
  for (const i of list) {
    if (i.grams == null || i.pctFrom == null || i.pctTo == null) continue;
    grams += i.grams;
    gain += i.pctTo - i.pctFrom;
    gramsSamples++;
  }
  return {
    intervals: list.length,
    crabs: new Set(list.map((i) => i.crabId)).size,
    avgDays: avg(list.map((i) => i.days)),
    pctSamples: pct.length,
    avgPctPerWeek: avg(pct),
    medianPctPerWeek: median(pct),
    weightSamples: weight.length,
    avgWeightPerWeek: avg(weight),
    gramsSamples,
    gramsPerPct: gramsSamples && gain > 0 ? r2(grams / gain) : null,
  };
}

export async function feedingAnalysis(systemId: number, user: AuthUser, q: AnalysisQuery) {
  const sys = await prisma.crabSystem.findUnique({ where: { id: systemId }, select: { ownerId: true } });
  if (!sys) throw notFound('ไม่พบระบบปูนี้');
  assertOwnership(user, sys.ownerId);

  const inRange = (ymd: string) => (!q.from || ymd >= q.from) && (!q.to || ymd <= q.to);

  const [rounds, crabs, measures] = await Promise.all([
    prisma.feedingRound.findMany({
      where: {
        systemId,
        status: { not: 'SKIPPED' },
        feedDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) },
      },
      orderBy: { dueAt: 'asc' },
      select: {
        id: true,
        feedDate: true,
        status: true,
        foodType: true,
        foodGrams: true,
        entries: { select: { crabId: true, score: true, tags: true } },
      },
    }),
    // รวมปูที่ขาย/ตาย/ลบไปแล้ว — ประวัติการโตของมันยังเป็นข้อมูลที่ใช้ได้
    prisma.crab.findMany({
      where: { systemId },
      select: { id: true, code: true, type: true, box: { select: { code: true, label: true } } },
    }),
    prisma.crabHistory.findMany({
      where: { zone: 'MEASURE', crab: { systemId } },
      orderBy: [{ crabId: 'asc' }, { recordedAt: 'asc' }],
      select: { crabId: true, recordedAt: true, snapshot: true },
    }),
  ]);

  // ── รอบให้อาหาร: อาหารที่ใช้จริง + สรุปการกิน ──
  const totals = Object.fromEntries(
    FOOD_KEYS.map((k) => [k, { rounds: 0, roundsWithGrams: 0, grams: 0, entries: 0, ate: 0, little: 0, none: 0, scoreSum: 0 }]),
  ) as Record<FoodKey, { rounds: number; roundsWithGrams: number; grams: number; entries: number; ate: number; little: number; none: number; scoreSum: number }>;
  const weeks = new Map<string, Record<FoodKey, { rounds: number; grams: number }>>();
  const mealsByCrab = new Map<number, Meal[]>();

  const roundRows = rounds.map((r) => {
    const stored = r.foodType as FoodType | null;
    const inferred = stored ? null : inferFoodType(r.entries.map((e) => (e.tags as string[] | null) ?? []));
    const food: FoodKey = stored ?? inferred ?? 'UNKNOWN';
    const scores = r.entries.map((e) => e.score);
    const ate = scores.filter((s) => s === 100).length;
    const none = scores.filter((s) => s === 0).length;
    const gramsPerCrab = r.foodGrams != null && r.entries.length ? r.foodGrams / r.entries.length : null;

    if (r.entries.length || stored) {
      const t = totals[food];
      t.rounds++;
      t.entries += r.entries.length;
      t.ate += ate;
      t.none += none;
      t.little += scores.length - ate - none;
      t.scoreSum += scores.reduce((a, b) => a + b, 0);
      if (r.foodGrams != null) {
        t.roundsWithGrams++;
        t.grams += r.foodGrams;
      }
      const wk = weekStart(r.feedDate);
      const bucket =
        weeks.get(wk) ??
        (Object.fromEntries(FOOD_KEYS.map((k) => [k, { rounds: 0, grams: 0 }])) as Record<FoodKey, { rounds: number; grams: number }>);
      bucket[food].rounds++;
      bucket[food].grams += r.foodGrams ?? 0;
      weeks.set(wk, bucket);
    }

    for (const e of r.entries) {
      const list = mealsByCrab.get(e.crabId) ?? [];
      list.push({ feedDate: r.feedDate, food, units: e.score / 100, gramsPerCrab });
      mealsByCrab.set(e.crabId, list);
    }

    return {
      id: r.id,
      feedDate: r.feedDate,
      status: r.status,
      foodType: stored,
      effectiveFood: food,
      inferred: !stored && inferred != null,
      foodGrams: r.foodGrams,
      recorded: r.entries.length,
      ate,
      little: scores.length - ate - none,
      none,
      avgScore: avg(scores),
    };
  });

  const firstFeedDate = rounds[0]?.feedDate ?? null;

  // ── การเติบโตระหว่างรอบวัด ──
  const crabById = new Map(crabs.map((c) => [c.id, c]));
  const pointsByCrab = new Map<number, { date: Date; ymd: string; pct: number | null; weight: number | null }[]>();
  let prevCrab = -1;
  let prevChecked: string | null = null;
  for (const m of measures) {
    if (m.crabId !== prevCrab) {
      prevCrab = m.crabId;
      prevChecked = null;
    }
    const snap = (m.snapshot ?? {}) as Record<string, unknown>;
    const date = measureDate(snap, m.recordedAt, prevChecked);
    prevChecked = typeof snap.lastCheckedAt === 'string' ? snap.lastCheckedAt : prevChecked;
    const pct = num(snap.currentFirmnessPct);
    const weight = num(snap.weightG);
    if (pct == null && weight == null) continue; // แถวรูปอย่างเดียว
    const list = pointsByCrab.get(m.crabId) ?? [];
    list.push({ date, ymd: ymdLocal(date), pct, weight });
    pointsByCrab.set(m.crabId, list);
  }

  const intervals: Interval[] = [];
  for (const [crabId, raw] of pointsByCrab) {
    const crab = crabById.get(crabId);
    const meals = mealsByCrab.get(crabId);
    if (!crab || !meals || !firstFeedDate) continue;

    // เรียงตามวันวัด + วันเดียวกันเก็บค่าสุดท้าย (แก้ตัวเลขซ้ำในวันเดียว)
    const byDay = new Map<string, (typeof raw)[number]>();
    for (const p of [...raw].sort((a, b) => a.date.getTime() - b.date.getTime())) byDay.set(p.ymd, p);
    // ช่วงก่อนมีรอบให้อาหารไม่รู้ว่ากินอะไร → ตัดทิ้ง
    const points = [...byDay.values()].filter((p) => inRange(p.ymd) && p.ymd >= firstFeedDate);

    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      const days = dayDiff(b.date, a.date);
      if (days < MIN_INTERVAL_DAYS) continue;

      // มื้อที่มีผลต่อช่วงนี้ = ให้อาหารตั้งแต่วันวัดครั้งแรก ถึงก่อนวันวัดครั้งถัดไป
      let fish = 0;
      let shell = 0;
      let unknown = 0;
      let grams = 0;
      let gramsKnown = true;
      for (const meal of meals) {
        if (meal.feedDate < a.ymd || meal.feedDate >= b.ymd) continue;
        if (meal.food === 'FISH') fish += meal.units;
        else if (meal.food === 'SHELLFISH') shell += meal.units;
        else if (meal.food === 'MIXED') {
          fish += meal.units / 2;
          shell += meal.units / 2;
        } else unknown += meal.units;
        if (meal.gramsPerCrab == null) gramsKnown = false;
        else grams += meal.gramsPerCrab;
      }
      const known = fish + shell;
      if (known === 0 || unknown > known) continue; // ไม่รู้ว่ากินอะไรเป็นส่วนใหญ่

      const fishShare = fish / known;
      const pctPerWeek = a.pct != null && b.pct != null ? r2(((b.pct - a.pct) / days) * 7) : null;
      const weightPerWeek = a.weight != null && b.weight != null ? r2(((b.weight - a.weight) / days) * 7) : null;
      if (pctPerWeek == null && weightPerWeek == null) continue;

      intervals.push({
        crabId,
        crabCode: crab.code,
        boxCode: crab.box?.label || crab.box?.code || null,
        crabType: crab.type,
        from: a.ymd,
        to: b.ymd,
        days,
        pctFrom: a.pct,
        pctTo: b.pct,
        pctPerWeek,
        weightFrom: a.weight,
        weightTo: b.weight,
        weightPerWeek,
        fishMeals: r2(fish),
        shellMeals: r2(shell),
        fishShare: r2(fishShare),
        group: fishShare >= MAJORITY_SHARE ? 'FISH' : fishShare <= 1 - MAJORITY_SHARE ? 'SHELLFISH' : 'MIXED',
        grams: gramsKnown ? Math.round(grams) : null,
      });
    }
  }

  const growth: Record<string, Record<FoodType, ReturnType<typeof summarize>>> = {};
  for (const type of ['EGG', 'MEAT', 'UNKNOWN']) {
    const ofType = intervals.filter((i) => i.crabType === type);
    if (!ofType.length) continue;
    growth[type] = Object.fromEntries(
      GROUPS.map((g) => [g, summarize(ofType.filter((i) => i.group === g))]),
    ) as Record<FoodType, ReturnType<typeof summarize>>;
  }

  return {
    range: { from: q.from ?? null, to: q.to ?? null, firstFeedDate, lastFeedDate: rounds.at(-1)?.feedDate ?? null },
    settings: { minIntervalDays: MIN_INTERVAL_DAYS, majorityShare: MAJORITY_SHARE },
    totals: Object.fromEntries(
      FOOD_KEYS.map((k) => {
        const { scoreSum, ...t } = totals[k];
        return [k, { ...t, avgScore: t.entries ? r2(scoreSum / t.entries) : null }];
      }),
    ),
    byWeek: [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([week, v]) => ({ week, ...v })),
    growth,
    rounds: roundRows.reverse(), // ใหม่ → เก่า (ตารางกรอกย้อนหลัง)
    intervals: intervals.sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : a.crabId - b.crabId)),
  };
}
