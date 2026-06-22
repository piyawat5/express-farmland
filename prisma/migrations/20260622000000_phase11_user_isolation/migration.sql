-- DropIndex
DROP INDEX `Substance_name_key` ON `Substance`;

-- AlterTable
ALTER TABLE `Contact` ADD COLUMN `ownerId` INTEGER NULL;

-- AlterTable
ALTER TABLE `DosingRule` ADD COLUMN `ownerId` INTEGER NULL;

-- AlterTable
ALTER TABLE `InventoryItem` ADD COLUMN `ownerId` INTEGER NULL;

-- AlterTable
ALTER TABLE `LedgerEntry` ADD COLUMN `ownerId` INTEGER NULL;

-- AlterTable
ALTER TABLE `ReminderRule` ADD COLUMN `ownerId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Substance` ADD COLUMN `ownerId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Contact_ownerId_idx` ON `Contact`(`ownerId`);

-- CreateIndex
CREATE INDEX `DosingRule_ownerId_idx` ON `DosingRule`(`ownerId`);

-- CreateIndex
CREATE INDEX `InventoryItem_ownerId_idx` ON `InventoryItem`(`ownerId`);

-- CreateIndex
CREATE INDEX `LedgerEntry_ownerId_idx` ON `LedgerEntry`(`ownerId`);

-- CreateIndex
CREATE INDEX `ReminderRule_ownerId_idx` ON `ReminderRule`(`ownerId`);

-- CreateIndex
CREATE INDEX `Substance_ownerId_idx` ON `Substance`(`ownerId`);

-- CreateIndex
CREATE UNIQUE INDEX `Substance_ownerId_name_key` ON `Substance`(`ownerId`, `name`);

-- AddForeignKey
ALTER TABLE `Substance` ADD CONSTRAINT `Substance_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DosingRule` ADD CONSTRAINT `DosingRule_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReminderRule` ADD CONSTRAINT `ReminderRule_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryItem` ADD CONSTRAINT `InventoryItem_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: ยกข้อมูลเดิมทั้งหมดให้เจ้าของจริง (jame, ADMIN) — per-user isolation
-- (decision 2026-06-22: ข้อมูลเดิมเป็นของ jame; user ใหม่ที่ login LINE เริ่มต้นด้วยข้อมูลว่าง)
SET @jame := (SELECT `id` FROM `User` WHERE `email` = 'jame.piyawat111@gmail.com' LIMIT 1);
UPDATE `Contact` SET `ownerId` = @jame WHERE `ownerId` IS NULL;
UPDATE `Substance` SET `ownerId` = @jame WHERE `ownerId` IS NULL;
UPDATE `InventoryItem` SET `ownerId` = @jame WHERE `ownerId` IS NULL;
UPDATE `DosingRule` SET `ownerId` = @jame WHERE `ownerId` IS NULL;
UPDATE `ReminderRule` SET `ownerId` = @jame WHERE `ownerId` IS NULL;
UPDATE `LedgerEntry` SET `ownerId` = @jame WHERE `ownerId` IS NULL;
