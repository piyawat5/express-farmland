-- เพิ่มการตั้งค่ารายงาน/คำนวณราคาปูต่อระบบ (ต้นทุนคงที่รายเดือน + เรทไซส์/ราคา)

-- AlterTable: เก็บ config รายงานเป็น JSON (fixedCosts / daysPerMonth / boxCount / sizeTiers)
ALTER TABLE `CrabSystem` ADD COLUMN `reportSettings` JSON NULL;
