import { Prisma } from '@prisma/client';

/**
 * แปลงค่า Prisma.Decimal → number แบบ recursive ก่อนส่ง JSON
 * (CLAUDE.md: เงินเก็บเป็น Decimal แต่ตอนส่ง/คำนวณต้องเป็น number)
 * เก็บ Date ไว้ตามเดิม (Express จะ serialize เป็น ISO string ให้เอง)
 */
export function serialize<T>(value: T): T {
  if (value == null) return value;

  if (value instanceof Prisma.Decimal) {
    return value.toNumber() as unknown as T;
  }

  if (value instanceof Date) return value;

  if (Array.isArray(value)) {
    return value.map((v) => serialize(v)) as unknown as T;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serialize(v);
    }
    return out as T;
  }

  return value;
}
