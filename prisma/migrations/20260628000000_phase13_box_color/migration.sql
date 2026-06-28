-- AlterTable: เพิ่มสีพื้นกล่องปู (ข้อ 1.11) — nullable เพิ่มอย่างเดียว ไม่กระทบข้อมูลเดิม
ALTER TABLE `CrabBox` ADD COLUMN `color` VARCHAR(191) NULL;
