import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

// ════════════════════════════════════════════════════════════════════
//  เนื้อหาที่แอดมินตั้งเอง (P8) — AppSetting key "content"
//    nowBuilding  แถบบนสุดของแท็บไอเดีย "ตอนนี้กำลังพัฒนา: …" (ว่าง = ซ่อน)
//    videos       ลิงก์คลิปสอนต่อเรื่อง { [topicKey]: url } — เรื่องสอนทั้งหมดอยู่ที่หน้าเว็บ (lib/tours.ts)
//                 ยังไม่มีลิงก์ = หน้าสอนใช้งานไม่โชว์ปุ่ม "ดูคลิป"
// ════════════════════════════════════════════════════════════════════

export type SiteContent = {
  nowBuilding: string | null;
  videos: Record<string, string>;
};

const KEY = 'content';

export async function getContent(): Promise<SiteContent> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const v = (row?.value ?? {}) as Partial<SiteContent>;
  return { nowBuilding: v.nowBuilding ?? null, videos: { ...(v.videos ?? {}) } };
}

/** videos = แทนทั้งชุด (ค่าว่าง = ลบลิงก์เรื่องนั้น) */
export async function updateContent(patch: { nowBuilding?: string | null; videos?: Record<string, string> }): Promise<SiteContent> {
  const cur = await getContent();
  const next: SiteContent = {
    nowBuilding: patch.nowBuilding !== undefined ? patch.nowBuilding?.trim() || null : cur.nowBuilding,
    videos:
      patch.videos !== undefined
        ? Object.fromEntries(Object.entries(patch.videos).filter(([, url]) => url.trim()).map(([k, url]) => [k, url.trim()]))
        : cur.videos,
  };
  const value = next as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return next;
}

