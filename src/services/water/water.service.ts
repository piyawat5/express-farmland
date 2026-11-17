import type { Prisma, WaterDo, WaterWhen } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/http';
import { assertOwned } from '../../lib/scope';
import { adviceLabel, doseFor, statusOf, type WaterStatus } from '../../lib/water';
import type { AuthUser } from '../auth.service';
import { waterTested } from '../reminders/task.service';
import { ensureSubstances, ensureWaterParams } from './defaults';

// ════════════════════════════════════════════════════════════════════
//  น้ำ (ข้อ 4.10 / 5.7) — ค่าที่วัด · เกณฑ์ · กฎปรุงน้ำ · ผลวัด → คำแนะนำทันที · "ทำแล้ว"
//  คำแนะนำคิดจาก "ค่าล่าสุดที่รู้" ของแต่ละค่า (รอบนี้ไม่ได้วัด = ใช้ค่าเดิม + บอกว่าเป็นค่าเดิม)
// ════════════════════════════════════════════════════════════════════

const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : d.toNumber());

type ParamFull = Prisma.WaterParamGetPayload<{ include: { rules: true } }>;
type RuleRow = ParamFull['rules'][number];
type TestRow = { id: number; testedAt: Date; readings: { paramId: number; value: Prisma.Decimal }[] };
type ActionRow = { id: number; testId: number; paramId: number; label: string; at: Date };

async function ownedSystem(user: AuthUser, systemId: number) {
  return assertOwned(await prisma.crabSystem.findUnique({ where: { id: systemId }, select: { id: true, ownerId: true } }), user, 'ระบบปูนี้');
}

const shapeRule = (r: RuleRow) => ({
  when: r.when,
  action: r.action,
  substanceId: r.substanceId,
  amount: num(r.amount),
  doseUnit: r.doseUnit,
  effect: num(r.effect),
  note: r.note,
});

const shapeParam = (p: ParamFull) => ({
  id: p.id,
  key: p.key,
  name: p.name,
  unit: p.unit,
  color: p.color,
  min: num(p.min),
  max: num(p.max),
  active: p.active,
  sortOrder: p.sortOrder,
  rules: p.rules.map(shapeRule).sort((a, b) => (a.when === b.when ? 0 : a.when === 'LOW' ? -1 : 1)),
});

/** ทุกอย่างที่ต้องใช้ประเมินน้ำของระบบ 1 ระบบ (ผลวัด 30 ครั้งล่าสุดพอสำหรับ "ค่าล่าสุดที่รู้") */
async function loadSystem(systemId: number) {
  const [params, tests] = await Promise.all([
    prisma.waterParam.findMany({ where: { systemId }, include: { rules: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    prisma.waterTest.findMany({
      where: { systemId },
      orderBy: [{ testedAt: 'desc' }, { id: 'desc' }],
      take: 30,
      select: { id: true, testedAt: true, readings: { select: { paramId: true, value: true } } },
    }),
  ]);
  const actions: ActionRow[] = tests.length
    ? await prisma.waterAction.findMany({ where: { testId: { in: tests.map((t) => t.id) } }, select: { id: true, testId: true, paramId: true, label: true, at: true } })
    : [];
  return { params, tests, actions };
}

export type Advice = {
  paramId: number;
  testId: number;
  when: 'LOW' | 'HIGH';
  /** null = ยังไม่ได้ตั้งว่าต้องทำอะไร */
  action: WaterDo | null;
  substanceId: number | null;
  substanceName: string | null;
  amount: number | null;
  unit: string | null;
  note: string | null;
  label: string;
  done: { id: number; label: string; at: Date } | null;
};

/** ค่าล่าสุดที่รู้ + คำแนะนำของค่าที่หลุดเกณฑ์ */
function evaluate(params: ParamFull[], tests: TestRow[], actions: ActionRow[], substances: Map<number, string>) {
  const last = tests[0] ?? null;
  const latest: { paramId: number; value: number; testedAt: Date; testId: number; stale: boolean; status: WaterStatus }[] = [];
  const advice: Advice[] = [];
  for (const p of params) {
    if (!p.active) continue;
    let test: TestRow | null = null;
    let value = 0;
    for (const t of tests) {
      const r = t.readings.find((x) => x.paramId === p.id);
      if (r) {
        test = t;
        value = r.value.toNumber();
        break;
      }
    }
    if (!test) continue;
    const min = num(p.min);
    const max = num(p.max);
    const status = statusOf(value, min, max);
    latest.push({ paramId: p.id, value, testedAt: test.testedAt, testId: test.id, stale: test.id !== last?.id, status });
    if (status !== 'LOW' && status !== 'HIGH') continue;
    const rule = p.rules.find((r) => r.when === status);
    const rl = rule ? shapeRule(rule) : null;
    const dose = rl?.action === 'DOSE';
    const a = {
      action: rl?.action ?? null,
      substanceName: dose && rl?.substanceId ? (substances.get(rl.substanceId) ?? null) : null,
      amount: dose && rl ? doseFor(value, min, max, rl) : null,
      unit: dose ? (rl?.doseUnit ?? null) : null,
      note: rl?.note ?? null,
    };
    const done = actions.find((x) => x.testId === test.id && x.paramId === p.id);
    advice.push({
      paramId: p.id,
      testId: test.id,
      when: status,
      substanceId: dose ? (rl?.substanceId ?? null) : null,
      ...a,
      label: adviceLabel(a),
      done: done ? { id: done.id, label: done.label, at: done.at } : null,
    });
  }
  return { lastTest: last ? { id: last.id, testedAt: last.testedAt } : null, latest, advice };
}

/** ข้อที่ยังต้องทำ — "วัดซ้ำพรุ่งนี้" ไม่นับ (ไปอยู่ที่แจ้งเตือนวัดค่าน้ำแล้ว) */
export const isPending = (a: Advice) => !a.done && a.action !== 'RETEST';

async function substanceMap(ownerId: number) {
  const rows = await prisma.waterSubstance.findMany({ where: { ownerId }, select: { id: true, name: true, active: true }, orderBy: { id: 'asc' } });
  return { rows, map: new Map(rows.map((s) => [s.id, s.name])) };
}

// ── หน้าน้ำ ──────────────────────────────────────────────────────────

export async function getState(user: AuthUser, systemId: number) {
  await ownedSystem(user, systemId);
  await Promise.all([ensureWaterParams(user.id, systemId), ensureSubstances(user.id)]);
  const [{ params, tests, actions }, subs] = await Promise.all([loadSystem(systemId), substanceMap(user.id)]);
  return {
    params: params.map(shapeParam),
    substances: subs.rows.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name })),
    ...evaluate(params, tests, actions, subs.map),
  };
}

/** แถบสถานะน้ำบนหน้ากล่องปู — โชว์เฉพาะตัวที่หลุด */
export async function getSummary(user: AuthUser, systemId: number) {
  await ownedSystem(user, systemId);
  await ensureWaterParams(user.id, systemId);
  const { params, tests, actions } = await loadSystem(systemId);
  const ev = evaluate(params, tests, actions, new Map());
  const active = params.filter((p) => p.active);
  const byId = new Map(params.map((p) => [p.id, p]));
  return {
    params: active.length,
    missingTargets: active.filter((p) => p.min == null && p.max == null).length,
    testedAt: ev.lastTest?.testedAt ?? null,
    off: ev.latest
      .filter((l) => l.status === 'LOW' || l.status === 'HIGH')
      .map((l) => ({ paramId: l.paramId, key: byId.get(l.paramId)!.key, name: byId.get(l.paramId)!.name, status: l.status })),
    pending: ev.advice.filter(isPending).length,
  };
}

/** ⚠ ของเมนูน้ำ (ทุกระบบรวมกัน) */
/**
 * ป้าย ⚠ ของน้ำ แยกตามระบบ (หน้าเว็บโชว์ ⚠ บนปุ่มเฉพาะระบบที่เลือกอยู่)
 * ลำดับนำทาง: ตั้งเกณฑ์ → วัดครั้งแรก → (หลุดเกณฑ์) ทำตามคำแนะนำ
 */
export async function waterAttention(ownerId: number) {
  const systems = await prisma.crabSystem.findMany({ where: { ownerId }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  const missing: { systemId: number; name: string; count: number }[] = [];
  const noTest: { systemId: number; name: string }[] = [];
  const pending: { systemId: number; name: string; count: number }[] = [];
  for (const s of systems) {
    await ensureWaterParams(ownerId, s.id);
    const { params, tests, actions } = await loadSystem(s.id);
    const miss = params.filter((p) => p.active && p.min == null && p.max == null).length;
    if (miss) missing.push({ systemId: s.id, name: s.name, count: miss });
    else if (!tests.length) noTest.push({ systemId: s.id, name: s.name });
    const pend = evaluate(params, tests, actions, new Map()).advice.filter(isPending).length;
    if (pend) pending.push({ systemId: s.id, name: s.name, count: pend });
  }
  return { missing, noTest, pending, systems: systems.length };
}

// ── ผลวัด ─────────────────────────────────────────────────────────────

type ValueIn = { paramId: number; value: number | null };

async function assertParamsOf(systemId: number, ids: number[]) {
  const n = await prisma.waterParam.count({ where: { systemId, id: { in: ids } } });
  if (n !== new Set(ids).size) throw badRequest('มีค่าที่ไม่ใช่ของระบบนี้');
}

function checkTestedAt(at: Date, now = new Date()) {
  if (at.getTime() > now.getTime() + 5 * 60_000) throw badRequest('วันเวลาที่วัดเป็นอนาคตไม่ได้');
  if (now.getTime() - at.getTime() > 400 * 86_400_000) throw badRequest('ย้อนหลังได้ไม่เกิน 1 ปี');
}

export async function recordTest(user: AuthUser, input: { systemId: number; testedAt?: Date; note?: string | null; values: { paramId: number; value: number }[] }) {
  await ownedSystem(user, input.systemId);
  if (!input.values.length) throw badRequest('ใส่ค่าที่วัดได้อย่างน้อย 1 ค่า');
  const ids = input.values.map((v) => v.paramId);
  if (new Set(ids).size !== ids.length) throw badRequest('ค่าซ้ำกัน');
  await assertParamsOf(input.systemId, ids);
  const testedAt = input.testedAt ?? new Date();
  checkTestedAt(testedAt);
  const test = await prisma.waterTest.create({
    data: {
      ownerId: user.id,
      systemId: input.systemId,
      testedAt,
      note: input.note?.trim() || null,
      readings: { createMany: { data: input.values.map((v) => ({ paramId: v.paramId, value: v.value })) } },
    },
    select: { id: true },
  });
  const state = await getState(user, input.systemId);
  // งาน "วัดค่าน้ำ" ปิดเอง · มีค่าที่ให้ "วัดซ้ำพรุ่งนี้" → แจ้งเตือนรอบถัดไปเป็นพรุ่งนี้
  const retest = state.advice.some((a) => a.testId === test.id && a.action === 'RETEST');
  await waterTested(user.id, input.systemId, testedAt, retest);
  return { testId: test.id, ...state };
}

export async function listTests(user: AuthUser, systemId: number, take: number, before?: Date) {
  await ownedSystem(user, systemId);
  const rows = await prisma.waterTest.findMany({
    where: { systemId, ...(before ? { testedAt: { lt: before } } : {}) },
    orderBy: [{ testedAt: 'desc' }, { id: 'desc' }],
    take,
    select: {
      id: true,
      testedAt: true,
      note: true,
      readings: { select: { paramId: true, value: true } },
      actions: { select: { id: true, paramId: true, label: true, at: true }, orderBy: { at: 'asc' } },
    },
  });
  return rows.map((t) => ({ ...t, readings: t.readings.map((r) => ({ paramId: r.paramId, value: r.value.toNumber() })) }));
}

async function ownedTest(user: AuthUser, id: number) {
  return assertOwned(await prisma.waterTest.findUnique({ where: { id }, select: { id: true, ownerId: true, systemId: true } }), user, 'ผลวัดนี้');
}

/** แก้ผลวัด: values ที่ส่งมา = แทนค่าเดิม (null = ลบค่านั้น) — ต้องเหลืออย่างน้อย 1 ค่า */
export async function updateTest(user: AuthUser, id: number, input: { testedAt?: Date; note?: string | null; values?: ValueIn[] }) {
  const test = await ownedTest(user, id);
  if (input.testedAt) checkTestedAt(input.testedAt);
  if (input.values?.length) await assertParamsOf(test.systemId, input.values.map((v) => v.paramId));
  await prisma.$transaction(async (tx) => {
    for (const v of input.values ?? []) {
      if (v.value == null) await tx.waterReading.deleteMany({ where: { testId: id, paramId: v.paramId } });
      else await tx.waterReading.upsert({ where: { testId_paramId: { testId: id, paramId: v.paramId } }, update: { value: v.value }, create: { testId: id, paramId: v.paramId, value: v.value } });
    }
    if ((await tx.waterReading.count({ where: { testId: id } })) === 0) throw badRequest('ต้องเหลืออย่างน้อย 1 ค่า (ถ้าวัดผิดทั้งหมดให้ลบผลวัดนี้)');
    const data: Prisma.WaterTestUpdateInput = {};
    if (input.testedAt) data.testedAt = input.testedAt;
    if (input.note !== undefined) data.note = input.note?.trim() || null;
    if (Object.keys(data).length) await tx.waterTest.update({ where: { id }, data });
  });
}

export async function deleteTest(user: AuthUser, id: number) {
  await ownedTest(user, id);
  await prisma.waterTest.delete({ where: { id } });
}

// ── ค่าที่วัด + เกณฑ์ ─────────────────────────────────────────────────

function checkRange(min: number | null | undefined, max: number | null | undefined) {
  if (min != null && max != null && min > max) throw badRequest('ต่ำสุดต้องไม่มากกว่าสูงสุด');
}

async function nameTaken(systemId: number, name: string, exceptId?: number) {
  const rows = await prisma.waterParam.findMany({ where: { systemId }, select: { id: true, name: true, active: true } });
  const k = name.trim().toLowerCase();
  return rows.find((r) => r.id !== exceptId && r.name.trim().toLowerCase() === k) ?? null;
}

export async function addParam(user: AuthUser, input: { systemId: number; name: string; unit?: string; color: string; min?: number | null; max?: number | null }) {
  await ownedSystem(user, input.systemId);
  checkRange(input.min, input.max);
  const same = await nameTaken(input.systemId, input.name);
  const data = { name: input.name.trim(), unit: input.unit?.trim() ?? '', color: input.color, min: input.min ?? null, max: input.max ?? null, active: true };
  if (same) {
    if (same.active) throw badRequest('มีค่านี้อยู่แล้ว');
    await prisma.waterParam.update({ where: { id: same.id }, data }); // เคยซ่อนไว้ = เอากลับมา
    return same.id;
  }
  const last = await prisma.waterParam.aggregate({ where: { systemId: input.systemId }, _max: { sortOrder: true } });
  const row = await prisma.waterParam.create({ data: { ...data, ownerId: user.id, systemId: input.systemId, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
  return row.id;
}

export async function updateParam(user: AuthUser, id: number, input: { name?: string; unit?: string; color?: string; min?: number | null; max?: number | null; active?: boolean }) {
  const p = assertOwned(await prisma.waterParam.findUnique({ where: { id } }), user, 'ค่านี้');
  checkRange(input.min !== undefined ? input.min : num(p.min), input.max !== undefined ? input.max : num(p.max));
  if (input.name && (await nameTaken(p.systemId, input.name, id))) throw badRequest('มีค่าชื่อนี้อยู่แล้ว');
  await prisma.waterParam.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.unit !== undefined ? { unit: input.unit.trim() } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.min !== undefined ? { min: input.min } : {}),
      ...(input.max !== undefined ? { max: input.max } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

/** ตั้งเกณฑ์ทีเดียวทุกค่า (ครั้งแรก) — ค่าที่ไม่ได้วัด = active:false */
export async function saveTargets(user: AuthUser, input: { systemId: number; items: { id: number; min: number | null; max: number | null; unit?: string; active: boolean }[] }) {
  await ownedSystem(user, input.systemId);
  await assertParamsOf(input.systemId, input.items.map((i) => i.id));
  for (const i of input.items) checkRange(i.min, i.max);
  await prisma.$transaction(
    input.items.map((i) =>
      prisma.waterParam.update({
        where: { id: i.id },
        data: { min: i.min, max: i.max, active: i.active, ...(i.unit !== undefined ? { unit: i.unit.trim() } : {}) },
      }),
    ),
  );
  return getState(user, input.systemId);
}

// ── กฎปรุงน้ำ + สาร ────────────────────────────────────────────────────

async function substanceIdFor(ownerId: number, input: { substanceId?: number | null; substanceName?: string | null }) {
  if (input.substanceId) {
    const s = await prisma.waterSubstance.findUnique({ where: { id: input.substanceId }, select: { ownerId: true } });
    if (!s || s.ownerId !== ownerId) throw badRequest('ไม่พบสารนี้');
    return input.substanceId;
  }
  const name = input.substanceName?.trim();
  if (!name) return null;
  return addSubstanceFor(ownerId, name);
}

async function addSubstanceFor(ownerId: number, name: string) {
  const s = await prisma.waterSubstance.upsert({
    where: { ownerId_name: { ownerId, name } },
    update: { active: true },
    create: { ownerId, name },
    select: { id: true },
  });
  return s.id;
}

export async function saveRule(
  user: AuthUser,
  paramId: number,
  when: WaterWhen,
  input: { action: WaterDo; substanceId?: number | null; substanceName?: string | null; amount?: number | null; doseUnit?: string | null; effect?: number | null; note?: string | null },
) {
  assertOwned(await prisma.waterParam.findUnique({ where: { id: paramId }, select: { ownerId: true } }), user, 'ค่านี้');
  let data: Omit<Prisma.WaterRuleUncheckedCreateInput, 'paramId' | 'when'>;
  if (input.action === 'DOSE') {
    const substanceId = await substanceIdFor(user.id, input);
    if (!substanceId) throw badRequest('เลือกสารที่จะใส่');
    if (!input.amount || input.amount <= 0) throw badRequest('ใส่จำนวนที่ใส่ต่อครั้ง');
    if (!input.doseUnit?.trim()) throw badRequest('เลือกหน่วย');
    data = { action: 'DOSE', substanceId, amount: input.amount, doseUnit: input.doseUnit.trim(), effect: input.effect && input.effect > 0 ? input.effect : null, note: input.note?.trim() || null };
  } else {
    data = { action: input.action, substanceId: null, amount: null, doseUnit: null, effect: null, note: input.note?.trim() || null };
  }
  await prisma.waterRule.upsert({ where: { paramId_when: { paramId, when } }, update: data, create: { ...data, paramId, when } });
}

export async function deleteRule(user: AuthUser, paramId: number, when: WaterWhen) {
  assertOwned(await prisma.waterParam.findUnique({ where: { id: paramId }, select: { ownerId: true } }), user, 'ค่านี้');
  await prisma.waterRule.deleteMany({ where: { paramId, when } });
}

export async function addSubstance(user: AuthUser, name: string) {
  return addSubstanceFor(user.id, name.trim());
}

export async function updateSubstance(user: AuthUser, id: number, input: { name?: string; active?: boolean }) {
  assertOwned(await prisma.waterSubstance.findUnique({ where: { id }, select: { ownerId: true } }), user, 'สารนี้');
  if (input.name) {
    const dup = await prisma.waterSubstance.findFirst({ where: { ownerId: user.id, name: input.name.trim(), NOT: { id } }, select: { id: true } });
    if (dup) throw badRequest('มีสารชื่อนี้อยู่แล้ว');
  }
  await prisma.waterSubstance.update({ where: { id }, data: { ...(input.name ? { name: input.name.trim() } : {}), ...(input.active !== undefined ? { active: input.active } : {}) } });
}

// ── "ทำแล้ว ✓" ────────────────────────────────────────────────────────

/** กดทำแล้วที่คำแนะนำ — amount = ใส่จริงเท่าไร (ไม่ส่ง = ตามที่แนะนำ) */
export async function act(user: AuthUser, input: { testId: number; paramId: number; amount?: number | null }) {
  const test = await ownedTest(user, input.testId);
  const st = await getState(user, test.systemId);
  const a = st.advice.find((x) => x.testId === input.testId && x.paramId === input.paramId);
  if (!a) throw badRequest('ค่านี้ไม่ได้หลุดเกณฑ์แล้ว (อาจมีผลวัดใหม่กว่า)');
  if (a.done) throw badRequest('บันทึกไว้แล้ว');
  const amount = a.action === 'DOSE' && input.amount && input.amount > 0 ? input.amount : a.amount;
  const label = a.action ? adviceLabel({ ...a, amount }) : 'รับทราบแล้ว';
  await prisma.waterAction.create({
    data: {
      ownerId: user.id,
      systemId: test.systemId,
      testId: input.testId,
      paramId: input.paramId,
      substanceId: a.substanceId,
      amount: a.action === 'DOSE' ? amount : null,
      unit: a.unit,
      label,
    },
  });
}

export async function undoAct(user: AuthUser, id: number) {
  assertOwned(await prisma.waterAction.findUnique({ where: { id }, select: { ownerId: true } }), user, 'รายการนี้');
  await prisma.waterAction.delete({ where: { id } });
}
