-- ข้อ 4.3: soft delete ปู — เก็บ record ไว้ดูประวัติย้อนหลังได้ (เคยอยู่กล่องไหน/ขายเท่าไร/ลบเมื่อไร)
ALTER TABLE `Crab` ADD COLUMN `deletedAt` DATETIME(3) NULL;

-- ดัชนีช่วยกรองปูที่ยังไม่ถูกลบต่อระบบ
CREATE INDEX `Crab_systemId_deletedAt_idx` ON `Crab`(`systemId`, `deletedAt`);
