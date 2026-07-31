-- Phase 21: แผนให้อาหาร (N วันเว้น M วัน) + รอบให้อาหาร + บันทึกการกินรายตัว
-- เพิ่มตารางใหม่ 3 ตาราง — ไม่แตะตาราง/คอลัมน์เดิมเลย (ปลอดภัยกับข้อมูลจริง)
-- ไม่ backfill/seed FeedingPlan ให้ระบบเดิม (จะเปิดรอบ + ยิงเมลเตือนทันที) — ผู้ใช้สร้างเองผ่าน UI

-- CreateTable
CREATE TABLE `FeedingPlan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NOT NULL,
    `onDays` INTEGER NOT NULL DEFAULT 1,
    `offDays` INTEGER NOT NULL DEFAULT 1,
    `anchorDate` DATETIME(3) NOT NULL,
    `timeOfDay` VARCHAR(191) NOT NULL DEFAULT '20:00',
    `recordLeadHours` INTEGER NOT NULL DEFAULT 3,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `nextDueAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FeedingPlan_systemId_key`(`systemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedingRound` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NOT NULL,
    `planId` INTEGER NULL,
    `feedDate` CHAR(10) NOT NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `recordDueAt` DATETIME(3) NOT NULL,
    `status` ENUM('OPEN', 'COMPLETED', 'SKIPPED') NOT NULL DEFAULT 'OPEN',
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `expectedCount` INTEGER NOT NULL DEFAULT 0,
    `recordedCount` INTEGER NOT NULL DEFAULT 0,
    `normalCount` INTEGER NOT NULL DEFAULT 0,
    `avgScore` DOUBLE NULL,
    `elapsedSec` INTEGER NULL,
    `feedingTaskId` INTEGER NULL,
    `scrapTaskId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FeedingRound_systemId_status_idx`(`systemId`, `status`),
    INDEX `FeedingRound_systemId_dueAt_idx`(`systemId`, `dueAt`),
    UNIQUE INDEX `FeedingRound_systemId_feedDate_key`(`systemId`, `feedDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedingEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `roundId` INTEGER NOT NULL,
    `crabId` INTEGER NOT NULL,
    `boxId` INTEGER NULL,
    `tags` JSON NOT NULL,
    `note` TEXT NULL,
    `score` INTEGER NOT NULL,
    `recordedByUserId` INTEGER NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `historyId` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FeedingEntry_crabId_recordedAt_idx`(`crabId`, `recordedAt`),
    UNIQUE INDEX `FeedingEntry_roundId_crabId_key`(`roundId`, `crabId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FeedingPlan` ADD CONSTRAINT `FeedingPlan_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingRound` ADD CONSTRAINT `FeedingRound_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingRound` ADD CONSTRAINT `FeedingRound_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `FeedingPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingEntry` ADD CONSTRAINT `FeedingEntry_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `FeedingRound`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingEntry` ADD CONSTRAINT `FeedingEntry_crabId_fkey` FOREIGN KEY (`crabId`) REFERENCES `Crab`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingEntry` ADD CONSTRAINT `FeedingEntry_recordedByUserId_fkey` FOREIGN KEY (`recordedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
