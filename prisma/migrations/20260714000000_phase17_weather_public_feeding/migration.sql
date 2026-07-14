-- AlterTable: พิกัดอากาศ (ข้อ 2.2) + หน้าร้าน public (ข้อ 5)
ALTER TABLE `CrabSystem`
    ADD COLUMN `weatherLat` DOUBLE NULL,
    ADD COLUMN `weatherLng` DOUBLE NULL,
    ADD COLUMN `weatherPlace` VARCHAR(191) NULL,
    ADD COLUMN `publicEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `publicSlug` VARCHAR(191) NULL;

-- AlterTable: บันทึกให้อาหารล่าสุด (ข้อ 3.6)
ALTER TABLE `Crab` ADD COLUMN `lastFedAt` DATETIME(3) NULL;

-- CreateIndex: publicSlug ต้องไม่ซ้ำ (ใช้เป็นโทเคนใน URL /shop/:slug)
CREATE UNIQUE INDEX `CrabSystem_publicSlug_key` ON `CrabSystem`(`publicSlug`);
