import { Prisma, WaterParam } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/http';

// ── โมดูล C (dosing): Substance / DosingCalibration / DosingRule + คำนวณ dose ──
//
// โมเดลการคำนวณ "ปรุงน้ำ" เป็นแบบ calibration ต่อระบบ (ไม่ใช่สูตรปริมาตร):
//   dose = (targetMax - current) / effectPerUnit
// effectPerUnit = "สาร 1 หน่วย → พารามิเตอร์เปลี่ยนเท่าไร" ของระบบนั้น
// เช่น เบกกิ้งโซดา 1 ช้อนแกง → alkalinity +2.5 หยด

/** map WaterParam → ชื่อ field ใน WaterTest (ใช้ทั้งตอน evaluate) */
const PARAM_FIELD = {
  PH: 'ph',
  ALKALINITY: 'alkalinity',
  MAGNESIUM: 'magnesium',
  CALCIUM: 'calcium',
  SALINITY: 'salinity',
  AMMONIA: 'ammonia',
  NITRITE: 'nitrite',
} as const satisfies Record<WaterParam, string>;

type FieldName = (typeof PARAM_FIELD)[WaterParam];

/** ค่าน้ำที่วัดได้ (ตัวที่ไม่ได้วัด = undefined/null) */
export type WaterValues = Partial<Record<FieldName, number | Prisma.Decimal | null>>;

type RecStatus = 'BELOW_MIN' | 'ABOVE_MAX' | 'OK' | 'NO_TARGET';

export type DosingRecommendation = {
  parameter: WaterParam;
  current: number;
  status: RecStatus;
  target: { min: number | null; max: number | null };
  action?: 'DOSE' | 'MEASURE_NEXT' | 'NOTE';
  substance?: { id: number; name: string; unit: string };
  dose?: number; // จำนวนสารที่แนะนำให้เติม
  doseUnit?: string;
  message?: string;
};

const dec = (v: Prisma.Decimal | number | null | undefined): number | null =>
  v == null ? null : Number(v);

// ── Substance (master list) ──────────────────────────────────────────

export function listSubstances(includeInactive = false) {
  return prisma.substance.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { id: 'asc' },
  });
}

export async function getSubstance(id: number) {
  const s = await prisma.substance.findUnique({ where: { id } });
  if (!s) throw notFound('ไม่พบสารนี้');
  return s;
}

export function createSubstance(data: Prisma.SubstanceUncheckedCreateInput) {
  return prisma.substance.create({ data });
}

export async function updateSubstance(id: number, data: Prisma.SubstanceUncheckedUpdateInput) {
  await getSubstance(id);
  return prisma.substance.update({ where: { id }, data });
}

export async function deleteSubstance(id: number) {
  await getSubstance(id);
  await prisma.substance.delete({ where: { id } });
}

// ── DosingCalibration (ต่อระบบ) ──────────────────────────────────────

export function listCalibrations(systemId: number) {
  return prisma.dosingCalibration.findMany({
    where: { systemId },
    orderBy: { id: 'asc' },
    include: { substance: { select: { id: true, name: true, unit: true } } },
  });
}

/** สร้าง/แก้ calibration (unique ที่ systemId+substanceId+parameter → upsert) */
export async function upsertCalibration(
  systemId: number,
  data: { substanceId: number; parameter: WaterParam; effectPerUnit: number; unit: string; note?: string | null },
) {
  return prisma.dosingCalibration.upsert({
    where: {
      systemId_substanceId_parameter: {
        systemId,
        substanceId: data.substanceId,
        parameter: data.parameter,
      },
    },
    update: { effectPerUnit: data.effectPerUnit, unit: data.unit, note: data.note ?? null },
    create: { systemId, ...data, note: data.note ?? null },
  });
}

export async function deleteCalibration(id: number) {
  const c = await prisma.dosingCalibration.findUnique({ where: { id } });
  if (!c) throw notFound('ไม่พบ calibration นี้');
  await prisma.dosingCalibration.delete({ where: { id } });
}

// ── DosingRule ───────────────────────────────────────────────────────

export function listRules(systemId?: number) {
  return prisma.dosingRule.findMany({
    where:
      systemId == null ? undefined : { OR: [{ systemId }, { systemId: null }] },
    orderBy: { id: 'asc' },
    include: { substance: { select: { id: true, name: true, unit: true } } },
  });
}

export function createRule(data: Prisma.DosingRuleUncheckedCreateInput) {
  return prisma.dosingRule.create({ data });
}

export async function updateRule(id: number, data: Prisma.DosingRuleUncheckedUpdateInput) {
  const r = await prisma.dosingRule.findUnique({ where: { id } });
  if (!r) throw notFound('ไม่พบกฎการปรุงน้ำนี้');
  return prisma.dosingRule.update({ where: { id }, data });
}

export async function deleteRule(id: number) {
  const r = await prisma.dosingRule.findUnique({ where: { id } });
  if (!r) throw notFound('ไม่พบกฎการปรุงน้ำนี้');
  await prisma.dosingRule.delete({ where: { id } });
}

// ── คำนวณคำแนะนำการปรุงน้ำจากค่าน้ำที่วัดได้ ──────────────────────────
//
// เทียบทุกพารามิเตอร์ที่วัดมากับ WaterTarget ของระบบ → หา DosingRule ที่ตรง
// → ถ้า DOSE และมี calibration ก็คำนวณปริมาณสารให้

export async function evaluateWaterValues(
  systemId: number,
  values: WaterValues,
): Promise<DosingRecommendation[]> {
  const [targets, rules, calibs] = await Promise.all([
    prisma.waterTarget.findMany({ where: { systemId } }),
    prisma.dosingRule.findMany({
      where: { active: true, OR: [{ systemId }, { systemId: null }] },
      include: { substance: { select: { id: true, name: true, unit: true } } },
    }),
    prisma.dosingCalibration.findMany({ where: { systemId } }),
  ]);

  const targetByParam = new Map(targets.map((t) => [t.parameter, t]));
  const recs: DosingRecommendation[] = [];

  for (const param of Object.keys(PARAM_FIELD) as WaterParam[]) {
    const raw = values[PARAM_FIELD[param]];
    if (raw == null) continue; // ไม่ได้วัดตัวนี้ → ข้าม

    const current = Number(raw);
    const target = targetByParam.get(param);
    const min = dec(target?.minTarget);
    const max = dec(target?.maxTarget);

    let status: RecStatus;
    if (min != null && current < min) status = 'BELOW_MIN';
    else if (max != null && current > max) status = 'ABOVE_MAX';
    else if (min == null && max == null) status = 'NO_TARGET';
    else status = 'OK';

    if (status === 'OK' || status === 'NO_TARGET') continue; // อยู่ในเกณฑ์ → ไม่ต้องทำอะไร

    const rec: DosingRecommendation = { parameter: param, current, status, target: { min, max } };

    // หา rule ที่ตรง — ให้ rule เฉพาะระบบมาก่อน rule กลาง (systemId null)
    const rule = rules
      .filter((r) => r.parameter === param && r.condition === status)
      .sort((a, b) => (a.systemId === systemId ? -1 : 1) - (b.systemId === systemId ? -1 : 1))[0];

    if (!rule) {
      recs.push(rec);
      continue;
    }

    rec.action = rule.actionType;

    if (rule.actionType === 'DOSE' && rule.substance) {
      rec.substance = rule.substance;
      const calib = calibs.find(
        (c) => c.substanceId === rule.substanceId && c.parameter === param,
      );
      const effect = calib ? Number(calib.effectPerUnit) : 0;

      if (status === 'BELOW_MIN' && max != null && calib && effect > 0) {
        // ดันค่าขึ้นไปถึง max: dose = (max - current) / effectPerUnit
        const dose = (max - current) / effect;
        rec.dose = Math.round(dose * 1000) / 1000;
        rec.doseUnit = calib.unit;
      } else if (rule.fixedDose != null) {
        rec.dose = Number(rule.fixedDose); // จำนวน fix (เช่น biodigest)
        rec.doseUnit = rule.substance.unit;
      } else {
        rec.message =
          status === 'ABOVE_MAX'
            ? 'ค่าสูงเกินเป้า — ลดด้วยการเปลี่ยน/เติมน้ำ (ไม่มีสารคำนวณให้)'
            : 'ยังไม่ได้ตั้ง calibration ของสารนี้ จึงคำนวณปริมาณไม่ได้';
      }
    } else {
      rec.message = rule.message ?? undefined;
    }

    recs.push(rec);
  }

  return recs;
}
