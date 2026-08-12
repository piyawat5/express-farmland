-- Phase 23: หมู่บ้านฟาร์ม (Farm Village)
-- เยี่ยมชมฟาร์มคนอื่นด้วยตัวละคร avatar + ตกแต่งฟาร์ม + ฝากจดหมาย
--
-- หมายเหตุ: เพิ่มคอลัมน์ nullable / มี default เท่านั้น + สร้างตารางใหม่ 3 ตาราง
--           ไม่มีการ ALTER ที่ทำให้ข้อมูลเดิมเสียหาย

-- ── 1. คอลัมน์ใหม่บนตารางเดิม ───────────────────────────────────────────
-- เปิดฟาร์มให้ผู้ใช้ที่ล็อกอินทุกคนเข้าชมได้ (คนละเรื่องกับ publicEnabled = หน้าร้าน QR)
ALTER TABLE `CrabSystem` ADD COLUMN `villageOpen` BOOLEAN NOT NULL DEFAULT false;

-- หน้าตาตัวละครในหมู่บ้าน (แยกจาก uiPrefs เพราะต้องส่งให้คนอื่นเห็น)
ALTER TABLE `User` ADD COLUMN `farmAvatar` JSON NULL;

-- ── 2. สิทธิ์เยี่ยมชมฟาร์ม (คนต่อคน, อนุมัติแล้วอยู่ถาวรจนกว่าจะถอน) ──────
CREATE TABLE `FarmAccess` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `visitorId` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'DENIED') NOT NULL DEFAULT 'PENDING',
    `message` VARCHAR(200) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FarmAccess_visitorId_status_idx`(`visitorId`, `status`),
    INDEX `FarmAccess_ownerId_status_idx`(`ownerId`, `status`),
    UNIQUE INDEX `FarmAccess_ownerId_visitorId_key`(`ownerId`, `visitorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 3. ของตกแต่งที่วางในฟาร์ม (พิกัดเป็นช่องตาราง) ─────────────────────
CREATE TABLE `FarmDecor` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NOT NULL,
    `kind` VARCHAR(40) NOT NULL,
    `x` INTEGER NOT NULL,
    `y` INTEGER NOT NULL,
    `z` INTEGER NOT NULL DEFAULT 0,
    `rot` INTEGER NOT NULL DEFAULT 0,
    `scale` INTEGER NOT NULL DEFAULT 100,
    `flip` BOOLEAN NOT NULL DEFAULT false,
    `variant` VARCHAR(24) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FarmDecor_systemId_idx`(`systemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 4. จดหมายที่ผู้มาเยือนปักไว้ + คำตอบของเจ้าของ ──────────────────────
CREATE TABLE `FarmLetter` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NOT NULL,
    `authorId` INTEGER NOT NULL,
    `x` INTEGER NOT NULL,
    `y` INTEGER NOT NULL,
    `body` VARCHAR(500) NOT NULL,
    `mood` VARCHAR(16) NULL,
    `reply` VARCHAR(500) NULL,
    `repliedAt` DATETIME(3) NULL,
    `readAt` DATETIME(3) NULL,
    `authorReadReplyAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FarmLetter_systemId_deletedAt_idx`(`systemId`, `deletedAt`),
    INDEX `FarmLetter_authorId_deletedAt_idx`(`authorId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 5. foreign keys ────────────────────────────────────────────────────
ALTER TABLE `FarmAccess` ADD CONSTRAINT `FarmAccess_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `FarmAccess` ADD CONSTRAINT `FarmAccess_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `FarmDecor` ADD CONSTRAINT `FarmDecor_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `FarmLetter` ADD CONSTRAINT `FarmLetter_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `FarmLetter` ADD CONSTRAINT `FarmLetter_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
