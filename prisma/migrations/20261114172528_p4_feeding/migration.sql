-- AlterTable
ALTER TABLE `ReminderRule` MODIFY `kind` ENUM('WATER_TEST', 'FEEDING', 'CRAB_CHECK', 'MICROBES', 'FRESHWATER', 'FILTER', 'CUSTOM', 'LOT_COST', 'FEED_LOW') NOT NULL;

-- AlterTable
ALTER TABLE `Task` MODIFY `kind` ENUM('WATER_TEST', 'FEEDING', 'CRAB_CHECK', 'MICROBES', 'FRESHWATER', 'FILTER', 'CUSTOM', 'LOT_COST', 'FEED_LOW') NOT NULL;

-- CreateTable
CREATE TABLE `FeedItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `emoji` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NOT NULL DEFAULT 'ชิ้น',
    `qty` DECIMAL(10, 1) NOT NULL DEFAULT 0,
    `stockSet` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FeedItem_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedStockMove` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `kind` ENUM('BUY', 'USE', 'ADJUST') NOT NULL,
    `qty` DECIMAL(10, 1) NOT NULL,
    `priceTHB` DECIMAL(12, 2) NULL,
    `roundId` INTEGER NULL,
    `note` TEXT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FeedStockMove_itemId_at_idx`(`itemId`, `at`),
    INDEX `FeedStockMove_roundId_idx`(`roundId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedingPlan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `systemId` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `onDays` INTEGER NOT NULL DEFAULT 1,
    `offDays` INTEGER NOT NULL DEFAULT 1,
    `anchorDate` DATETIME(3) NOT NULL,
    `timeOfDay` VARCHAR(191) NOT NULL DEFAULT '18:00',
    `pattern` ENUM('SINGLE', 'ALTERNATE') NOT NULL DEFAULT 'SINGLE',
    `itemId` INTEGER NULL,
    `altItemId` INTEGER NULL,
    `piecesPerCrab` DECIMAL(4, 1) NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FeedingPlan_systemId_key`(`systemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedingPlanDay` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `planId` INTEGER NOT NULL,
    `date` CHAR(10) NOT NULL,
    `skip` BOOLEAN NOT NULL DEFAULT false,
    `itemId` INTEGER NULL,

    UNIQUE INDEX `FeedingPlanDay_planId_date_key`(`planId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedingRound` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `systemId` INTEGER NOT NULL,
    `feedDate` CHAR(10) NOT NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `status` ENUM('OPEN', 'DONE', 'SKIPPED') NOT NULL DEFAULT 'OPEN',
    `fedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `autoClosed` BOOLEAN NOT NULL DEFAULT false,
    `reviewPending` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FeedingRound_ownerId_status_idx`(`ownerId`, `status`),
    UNIQUE INDEX `FeedingRound_systemId_feedDate_key`(`systemId`, `feedDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedingEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `roundId` INTEGER NOT NULL,
    `crabId` INTEGER NOT NULL,
    `boxId` INTEGER NULL,
    `itemId` INTEGER NULL,
    `pieces` DECIMAL(4, 1) NOT NULL DEFAULT 1,
    `result` ENUM('ATE', 'LITTLE', 'NONE') NOT NULL DEFAULT 'ATE',
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FeedingEntry_crabId_idx`(`crabId`),
    UNIQUE INDEX `FeedingEntry_roundId_crabId_key`(`roundId`, `crabId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FeedItem` ADD CONSTRAINT `FeedItem_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedStockMove` ADD CONSTRAINT `FeedStockMove_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedStockMove` ADD CONSTRAINT `FeedStockMove_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `FeedItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedStockMove` ADD CONSTRAINT `FeedStockMove_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `FeedingRound`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingPlan` ADD CONSTRAINT `FeedingPlan_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingPlan` ADD CONSTRAINT `FeedingPlan_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingPlan` ADD CONSTRAINT `FeedingPlan_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `FeedItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingPlan` ADD CONSTRAINT `FeedingPlan_altItemId_fkey` FOREIGN KEY (`altItemId`) REFERENCES `FeedItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingPlanDay` ADD CONSTRAINT `FeedingPlanDay_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `FeedingPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingPlanDay` ADD CONSTRAINT `FeedingPlanDay_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `FeedItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingRound` ADD CONSTRAINT `FeedingRound_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingRound` ADD CONSTRAINT `FeedingRound_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingEntry` ADD CONSTRAINT `FeedingEntry_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `FeedingRound`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingEntry` ADD CONSTRAINT `FeedingEntry_crabId_fkey` FOREIGN KEY (`crabId`) REFERENCES `Crab`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingEntry` ADD CONSTRAINT `FeedingEntry_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `FeedItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
