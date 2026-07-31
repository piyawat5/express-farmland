-- Phase 22: ค่าตั้งค่า UI ต่อผู้ใช้ (โหมดสอน/tutorial)
-- เก็บ { tourDoneAt, tourSkipped, tourVersion } — nullable column เดียว ปลอดภัย ไม่ต้อง backfill

-- AlterTable
ALTER TABLE `User` ADD COLUMN `uiPrefs` JSON NULL;
