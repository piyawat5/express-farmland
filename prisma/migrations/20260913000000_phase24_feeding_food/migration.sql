-- Phase 24: อาหารของรอบให้อาหาร (ปลา/หอย + ปริมาณกรัม) — ใช้ติ๊กการกินทีเดียว + วิเคราะห์ว่าอาหารไหนสร้างไข่ได้ดีกว่า
ALTER TABLE `FeedingRound` ADD COLUMN `foodType` VARCHAR(16) NULL,
    ADD COLUMN `foodGrams` INTEGER NULL;
