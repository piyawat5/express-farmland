-- ปรับตามผลทดสอบรอบแรก (2026-11-17)

-- 1) ซื้ออาหารเป็นกิโล: 1 กก. ได้กี่ชิ้น (ต่ออาหาร) + จำนวนกิโลของการซื้อ/นับแต่ละครั้ง
ALTER TABLE `FeedItem` ADD COLUMN `piecesPerKg` DECIMAL(8, 1) NULL;
ALTER TABLE `FeedStockMove` ADD COLUMN `kg` DECIMAL(10, 2) NULL;

-- 2) คอนโดหน้า-หลัง: รหัสกล่องด้านหลังต่อตัวอักษรจากด้านหน้า (หน้า A-D → หลัง E-H) ไม่ซ้ำกันอีก
--    ปูที่ชื่อยังเป็นค่าเริ่มต้น ("หน้า A1" / "หลัง A1") เปลี่ยนเป็นรหัสใหม่ด้วย

-- 2.1 ปูด้านหน้า: "หน้า A1" → "A1"
UPDATE `Crab` c
  JOIN `CrabBox` b ON b.`id` = c.`boxId`
  JOIN `CrabSystem` s ON s.`id` = b.`systemId`
SET c.`name` = b.`code`
WHERE s.`layout` = 'CONDO_DOUBLE' AND b.`side` = 'FRONT' AND c.`name` = CONCAT('หน้า ', b.`code`);

-- 2.2 กล่องด้านหลัง: ใส่รหัสชั่วคราวก่อน (กันชน unique systemId+side+code ระหว่างเลื่อน)
UPDATE `CrabBox` b
  JOIN `CrabSystem` s ON s.`id` = b.`systemId`
SET b.`code` = CONCAT('~', b.`id`)
WHERE s.`layout` = 'CONDO_DOUBLE' AND b.`side` = 'BACK';

-- 2.3 รหัสใหม่ = ตัวอักษรแถวที่ (จำนวนชั้น + แถว) · 0 → A, 25 → Z, 26 → AA (เหมือน rowLetter)
UPDATE `CrabBox` b
  JOIN `CrabSystem` s ON s.`id` = b.`systemId`
SET b.`code` = CONCAT(
  IF(s.`rows` + b.`row` < 26,
     CHAR(65 + s.`rows` + b.`row` USING ascii),
     CONCAT(CHAR(64 + FLOOR((s.`rows` + b.`row`) / 26) USING ascii), CHAR(65 + MOD(s.`rows` + b.`row`, 26) USING ascii))),
  b.`col` + 1)
WHERE s.`layout` = 'CONDO_DOUBLE' AND b.`side` = 'BACK';

-- 2.4 ปูด้านหลัง: "หลัง A1" (รหัสเดิมคำนวณจากแถว) → รหัสใหม่
UPDATE `Crab` c
  JOIN `CrabBox` b ON b.`id` = c.`boxId`
  JOIN `CrabSystem` s ON s.`id` = b.`systemId`
SET c.`name` = b.`code`
WHERE s.`layout` = 'CONDO_DOUBLE' AND b.`side` = 'BACK'
  AND c.`name` = CONCAT('หลัง ',
    IF(b.`row` < 26,
       CHAR(65 + b.`row` USING ascii),
       CONCAT(CHAR(64 + FLOOR(b.`row` / 26) USING ascii), CHAR(65 + MOD(b.`row`, 26) USING ascii))),
    b.`col` + 1);
