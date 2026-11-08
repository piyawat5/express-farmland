/* eslint-disable no-console */
// ════════════════════════════════════════════════════════════════════
//  ทดสอบความแม่นของ AI ประเมิน % ไข่ กับรูปเก่าที่ผู้ใช้เคยกรอก % เอง
//
//  npx tsx scripts/egg-eval.ts                    → ดูแผน + ประมาณค่าใช้จ่าย (ยังไม่เรียก AI ไม่เสียเงิน)
//  npx tsx scripts/egg-eval.ts --n 40 --yes       → รันจริง 40 รูป (เสียเงินจริงตามที่ประมาณไว้)
//  ตัวเลือก: --owner <userId> (ดีฟอลต์ = เจ้าของที่มีรูปมากสุด)  --csv <ไฟล์ผลลัพธ์>  --concurrency 3
//
//  กันเฉลยรั่ว: ตอนทดสอบรูปของปูตัวไหน จะตัดรูปทุกรูปของปูตัวนั้นออกจากชุดตัวอย่าง
//  และ "รอบก่อนของปูตัวเดียวกัน" ใช้เฉพาะรอบที่เกิดก่อนรูปที่ทดสอบจริง
//  ⚠️ % ที่ผู้ใช้กรอกเองก็กะด้วยตาและไม่นิ่ง (ปูตัวเดียวกันขึ้นลง 20→40→30) — error ที่ได้จึงรวม noise ของเฉลยด้วย
// ════════════════════════════════════════════════════════════════════
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import { env } from '../src/config/env';
import { estimateEgg, previewReferences, type EggEstimate } from '../src/services/eggEstimate.service';

// ราคา Claude Opus 5.5 ($/ล้าน token) — ถ้าเปลี่ยนรุ่นใน EGG_AI_MODEL ตัวเลขเงินจะไม่ตรง
const PRICE = { input: 4, cacheWrite1h: 8, cacheRead: 0.2, output: 20 };
const USD_THB = 35;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function defaultOwner(): Promise<number> {
  const systems = await prisma.crabSystem.findMany({ select: { ownerId: true, _count: { select: { crabs: true } } } });
  const byOwner = new Map<number, number>();
  for (const s of systems) if (s.ownerId != null) byOwner.set(s.ownerId, (byOwner.get(s.ownerId) ?? 0) + s._count.crabs);
  const best = [...byOwner.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) throw new Error('ไม่พบเจ้าของฟาร์มที่มีปู');
  return best[0];
}

type Row = {
  historyId: number;
  crabId: number;
  recordedAt: Date;
  label: number;
  url: string;
  est?: EggEstimate;
  error?: string;
  costUsd?: number;
};

async function main() {
  const ownerId = Number(arg('owner') ?? (await defaultOwner()));
  const n = Number(arg('n') ?? 40);
  const concurrency = Math.max(1, Number(arg('concurrency') ?? 3));
  const csvPath = arg('csv');

  // ชุดทดสอบ: ทุกแถวที่มีรูป + % จากคน (ถึงวันนี้) → เลือกกระจายทุกช่วง 10% สลับกันจนครบ n
  const { candidates } = await previewReferences(ownerId, { before: new Date() });
  const buckets = new Map<number, typeof candidates>();
  for (const c of candidates) {
    const b = Math.min(9, Math.floor(c.pct / 10));
    buckets.set(b, [...(buckets.get(b) ?? []), c]);
  }
  const test: Row[] = [];
  for (let round = 0; test.length < n; round++) {
    let added = false;
    for (let b = 0; b <= 9 && test.length < n; b++) {
      const c = buckets.get(b)?.[round];
      if (!c) continue;
      test.push({ historyId: c.historyId, crabId: c.crabId, recordedAt: c.recordedAt, label: c.pct, url: c.url });
      added = true;
    }
    if (!added) break;
  }

  const { references } = await previewReferences(ownerId);
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } });
  console.log(`เจ้าของฟาร์ม #${ownerId} ${owner?.name ?? ''} · รูปที่มี % จากคน ${candidates.length} รูป · ชุดตัวอย่างปกติ ${references.length} รูป`);
  console.log(`ตัวอย่าง: ${references.map((r) => `${r.pct}%`).join(' ')}`);
  console.log(`ชุดทดสอบ ${test.length} รูป: ${test.map((t) => t.label).join(',')}`);
  const lo = test.length * 0.04 + 0.2;
  const hi = test.length * 0.1 + 0.6;
  console.log(
    `ประมาณค่าใช้จ่าย (${env.EGG_AI_MODEL}): $${lo.toFixed(2)}–$${hi.toFixed(2)} ≈ ${Math.round(lo * USD_THB)}–${Math.round(hi * USD_THB)} บาท`,
  );
  if (!flag('yes')) {
    console.log('\nยังไม่ได้เรียก AI — ใส่ --yes เพื่อรันจริง');
    return;
  }
  if (!env.ANTHROPIC_API_KEY) throw new Error('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY ใน .env');

  const totals = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0 };
  async function runOne(t: Row) {
    try {
      const { estimate, usage } = await estimateEgg({
        ownerId,
        imageUrl: t.url,
        crabId: t.crabId,
        excludeCrabId: t.crabId,
        previousBefore: t.recordedAt,
        now: t.recordedAt,
      });
      const write = usage.cache_creation_input_tokens ?? 0;
      const read = usage.cache_read_input_tokens ?? 0;
      t.costUsd =
        (usage.input_tokens * PRICE.input + write * PRICE.cacheWrite1h + read * PRICE.cacheRead + usage.output_tokens * PRICE.output) /
        1e6;
      totals.input += usage.input_tokens;
      totals.cacheWrite += write;
      totals.cacheRead += read;
      totals.output += usage.output_tokens;
      totals.usd += t.costUsd;
      t.est = estimate;
    } catch (e) {
      t.error = e instanceof Error ? e.message : String(e);
    }
    const shown = t.est ? (t.est.usable ? `${t.est.eggPct}% (${t.est.confidence})` : 'อ่านไม่ได้') : `ERROR ${t.error}`;
    console.log(`#${t.historyId} ปู ${t.crabId}: คน ${t.label}% · AI ${shown}${t.est ? ` — ${t.est.reason}` : ''}`);
  }

  // รูปแรกรันเดี่ยว ๆ ให้เขียน cache ก่อน แล้วค่อยรันขนาน (ถ้ายิงพร้อมกันตั้งแต่แรก ทุกคำขอจะเขียน cache ซ้ำ)
  const queue = [...test];
  const first = queue.shift();
  if (first) await runOne(first);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) await runOne(t);
    }),
  );

  // ── สรุป ──
  const scored = test.filter((t) => t.est?.usable && t.est.eggPct != null);
  const diffs = scored.map((t) => t.est!.eggPct! - t.label);
  const abs = diffs.map(Math.abs).sort((a, b) => a - b);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const within = (d: number) => (scored.length ? Math.round((100 * abs.filter((x) => x <= d).length) / scored.length) : 0);
  console.log('\n══ สรุป ══');
  console.log(`ประเมินได้ ${scored.length}/${test.length} · AI บอกอ่านไม่ได้ ${test.filter((t) => t.est && !t.est.usable).length} · error ${test.filter((t) => t.error).length}`);
  console.log(`คลาดเฉลี่ย ${mean(abs).toFixed(1)} จุด% · ค่ากลาง ${abs[Math.floor(abs.length / 2)] ?? '-'} · AI สูงกว่าคนเฉลี่ย ${mean(diffs).toFixed(1)} จุด%`);
  console.log(`ห่างไม่เกิน ±10% = ${within(10)}% ของรูป · ±20% = ${within(20)}% ของรูป`);
  for (let b = 0; b <= 9; b++) {
    const inB = scored.filter((t) => Math.min(9, Math.floor(t.label / 10)) === b);
    if (inB.length) console.log(`  ช่วง ${b * 10}–${b * 10 + 9}%: ${inB.length} รูป คลาดเฉลี่ย ${mean(inB.map((t) => Math.abs(t.est!.eggPct! - t.label))).toFixed(1)}`);
  }
  console.log(
    `ค่าใช้จ่ายจริง $${totals.usd.toFixed(2)} (≈${Math.round(totals.usd * USD_THB)} บาท, เฉลี่ย ${((totals.usd * USD_THB) / Math.max(1, test.length)).toFixed(1)} บาท/รูป)` +
      ` · token: input ${totals.input} · cache write ${totals.cacheWrite} · cache read ${totals.cacheRead} · output ${totals.output}`,
  );

  if (csvPath) {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      'historyId,crabId,recordedAt,label,ai,diff,usable,confidence,reason,costUsd,error,url',
      ...test.map((t) =>
        [
          t.historyId,
          t.crabId,
          t.recordedAt.toISOString(),
          t.label,
          t.est?.eggPct ?? '',
          t.est?.eggPct != null ? t.est.eggPct - t.label : '',
          t.est?.usable ?? '',
          t.est?.confidence ?? '',
          esc(t.est?.reason),
          t.costUsd?.toFixed(4) ?? '',
          esc(t.error),
          t.url,
        ].join(','),
      ),
    ];
    writeFileSync(csvPath, '﻿' + lines.join('\n'), 'utf8'); // BOM ให้ Excel อ่านภาษาไทยได้
    console.log(`บันทึกผลรายรูปที่ ${csvPath}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
