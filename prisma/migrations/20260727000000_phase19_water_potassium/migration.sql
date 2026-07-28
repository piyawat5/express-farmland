-- เพิ่มโพแทสเซียม (K) เป็นพารามิเตอร์น้ำ + คอลัมน์ค่าที่วัดได้ในผลวัดน้ำ

-- AlterTable: เก็บค่าโพแทสเซียมที่วัดได้ (ppm)
ALTER TABLE `WaterTest` ADD COLUMN `potassium` DECIMAL(6, 2) NULL;

-- AlterEnum: เพิ่ม POTASSIUM ในทุกคอลัมน์ที่ใช้ WaterParam
ALTER TABLE `WaterTarget` MODIFY `parameter` ENUM('PH', 'ALKALINITY', 'MAGNESIUM', 'CALCIUM', 'POTASSIUM', 'SALINITY', 'AMMONIA', 'NITRITE') NOT NULL;
ALTER TABLE `DosingRule` MODIFY `parameter` ENUM('PH', 'ALKALINITY', 'MAGNESIUM', 'CALCIUM', 'POTASSIUM', 'SALINITY', 'AMMONIA', 'NITRITE') NOT NULL;
ALTER TABLE `DosingCalibration` MODIFY `parameter` ENUM('PH', 'ALKALINITY', 'MAGNESIUM', 'CALCIUM', 'POTASSIUM', 'SALINITY', 'AMMONIA', 'NITRITE') NOT NULL;
