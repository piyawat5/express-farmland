-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `lineId` VARCHAR(191) NULL,
    `notifyByEmail` BOOLEAN NOT NULL DEFAULT true,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CrabSystem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `waterVolumeL` DECIMAL(10, 2) NULL,
    `minLevelNote` VARCHAR(191) NULL,
    `maxLevelNote` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `ownerId` INTEGER NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CrabBox` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `status` ENUM('EMPTY', 'OCCUPIED') NOT NULL DEFAULT 'EMPTY',
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CrabBox_systemId_code_key`(`systemId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FilterTank` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `mediaType` VARCHAR(191) NULL,
    `cleanIntervalDays` INTEGER NULL,
    `lastCleanedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Crab` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NULL,
    `systemId` INTEGER NOT NULL,
    `boxId` INTEGER NULL,
    `type` ENUM('MEAT', 'EGG', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `sourceSellerId` INTEGER NULL,
    `buyerId` INTEGER NULL,
    `lockedForBuyerId` INTEGER NULL,
    `purchasePrice` DECIMAL(12, 2) NULL,
    `purchaseDate` DATETIME(3) NULL,
    `weightG` DECIMAL(8, 2) NULL,
    `startFirmnessPct` INTEGER NULL,
    `currentFirmnessPct` INTEGER NULL,
    `readyAt` DATETIME(3) NULL,
    `sellPrice` DECIMAL(12, 2) NULL,
    `sellDate` DATETIME(3) NULL,
    `status` ENUM('FATTENING', 'READY', 'SOLD', 'DEAD') NOT NULL DEFAULT 'FATTENING',
    `round` INTEGER NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedingRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `crabId` INTEGER NOT NULL,
    `fedAt` DATETIME(3) NOT NULL,
    `eatingLevel` ENUM('LOTS', 'LITTLE', 'NONE') NOT NULL,
    `scrapCollectedAt` DATETIME(3) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FirmnessRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `crabId` INTEGER NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL,
    `firmnessPct` INTEGER NOT NULL,
    `type` ENUM('MEAT', 'EGG', 'UNKNOWN') NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaterTest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NOT NULL,
    `testedAt` DATETIME(3) NOT NULL,
    `ph` DECIMAL(4, 2) NULL,
    `alkalinity` DECIMAL(6, 2) NULL,
    `magnesium` DECIMAL(6, 2) NULL,
    `calcium` DECIMAL(6, 2) NULL,
    `salinity` DECIMAL(5, 2) NULL,
    `ammonia` DECIMAL(6, 3) NULL,
    `nitrite` DECIMAL(6, 3) NULL,
    `note` TEXT NULL,
    `taskId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WaterTest_taskId_key`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaterTarget` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NOT NULL,
    `parameter` ENUM('PH', 'ALKALINITY', 'MAGNESIUM', 'CALCIUM', 'SALINITY', 'AMMONIA', 'NITRITE') NOT NULL,
    `minTarget` DECIMAL(8, 3) NULL,
    `maxTarget` DECIMAL(8, 3) NULL,
    `unit` VARCHAR(191) NULL,

    UNIQUE INDEX `WaterTarget_systemId_parameter_key`(`systemId`, `parameter`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Substance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `category` ENUM('MINERAL', 'MICROORGANISM', 'OTHER') NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `needsPrep` BOOLEAN NOT NULL DEFAULT false,
    `prepLeadDays` INTEGER NULL,
    `needsRepurchase` BOOLEAN NOT NULL DEFAULT false,
    `note` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Substance_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DosingRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NULL,
    `parameter` ENUM('PH', 'ALKALINITY', 'MAGNESIUM', 'CALCIUM', 'SALINITY', 'AMMONIA', 'NITRITE') NOT NULL,
    `condition` ENUM('BELOW_MIN', 'ABOVE_MAX') NOT NULL,
    `actionType` ENUM('DOSE', 'MEASURE_NEXT', 'NOTE') NOT NULL,
    `substanceId` INTEGER NULL,
    `amountPerDose` DECIMAL(8, 3) NULL,
    `amountBasisL` DECIMAL(8, 2) NULL,
    `message` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DosingRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NOT NULL,
    `substanceId` INTEGER NOT NULL,
    `amount` DECIMAL(8, 3) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `dosedAt` DATETIME(3) NOT NULL,
    `waterTestId` INTEGER NULL,
    `taskId` INTEGER NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DosingRecord_taskId_key`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubstancePrep` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `substanceId` INTEGER NOT NULL,
    `status` ENUM('PREPARING', 'READY', 'USED', 'DISCARDED') NOT NULL DEFAULT 'PREPARING',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readyAt` DATETIME(3) NULL,
    `amount` DECIMAL(8, 2) NULL,
    `unit` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReminderRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NULL,
    `type` ENUM('WATER_TEST', 'DOSING', 'FRESHWATER_TOPUP', 'FEEDING', 'SCRAP_COLLECT', 'FILTER_CLEAN', 'SUBSTANCE_PREP', 'RESTOCK', 'CUSTOM') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `scheduleKind` ENUM('INTERVAL_DAYS', 'INTERVAL_MONTHS', 'CRON', 'EVENT') NOT NULL,
    `intervalValue` INTEGER NULL,
    `cronExpr` VARCHAR(191) NULL,
    `triggerEvent` ENUM('AFTER_FRESHWATER', 'AFTER_WATER_TEST', 'AFTER_FEEDING') NULL,
    `timeOfDay` VARCHAR(191) NULL,
    `leadDays` INTEGER NULL,
    `reNotifyEveryMin` INTEGER NOT NULL DEFAULT 15,
    `payload` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastRunAt` DATETIME(3) NULL,
    `nextRunAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ruleId` INTEGER NULL,
    `systemId` INTEGER NULL,
    `userId` INTEGER NULL,
    `type` ENUM('WATER_TEST', 'DOSING', 'FRESHWATER_TOPUP', 'FEEDING', 'SCRAP_COLLECT', 'FILTER_CLEAN', 'SUBSTANCE_PREP', 'RESTOCK', 'CUSTOM') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `detail` TEXT NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'DONE', 'SKIPPED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `completedAt` DATETIME(3) NULL,
    `lastNotifiedAt` DATETIME(3) NULL,
    `notifyCount` INTEGER NOT NULL DEFAULT 0,
    `reNotifyEveryMin` INTEGER NOT NULL DEFAULT 15,
    `linkType` VARCHAR(191) NULL,
    `linkId` INTEGER NULL,
    `payload` JSON NULL,
    `parentTaskId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Task_status_dueAt_idx`(`status`, `dueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `taskId` INTEGER NULL,
    `channel` ENUM('EMAIL', 'LINE') NOT NULL DEFAULT 'EMAIL',
    `toAddress` VARCHAR(191) NULL,
    `subject` VARCHAR(191) NULL,
    `body` TEXT NULL,
    `status` ENUM('SENT', 'FAILED') NOT NULL DEFAULT 'SENT',
    `error` TEXT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contact` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('BUYER', 'SELLER', 'BOTH') NOT NULL,
    `phone` VARCHAR(191) NULL,
    `lineId` VARCHAR(191) NULL,
    `isRegular` BOOLEAN NOT NULL DEFAULT false,
    `note` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transaction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contactId` INTEGER NOT NULL,
    `kind` ENUM('BUY', 'SELL') NOT NULL,
    `status` ENUM('QUOTE', 'CONFIRMED', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'QUOTE',
    `crabId` INTEGER NULL,
    `qty` INTEGER NOT NULL DEFAULT 1,
    `pricePerUnit` DECIMAL(12, 2) NOT NULL,
    `totalPrice` DECIMAL(12, 2) NOT NULL,
    `costBasis` DECIMAL(12, 2) NULL,
    `profit` DECIMAL(12, 2) NULL,
    `round` INTEGER NULL,
    `occurredAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OutreachLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contactId` INTEGER NOT NULL,
    `round` INTEGER NOT NULL,
    `kind` ENUM('BUY', 'SELL') NOT NULL,
    `status` ENUM('PENDING', 'CONTACTED', 'HAS_STOCK', 'NO_STOCK', 'DEALT') NOT NULL DEFAULT 'PENDING',
    `contactedAt` DATETIME(3) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OutreachLog_contactId_round_kind_key`(`contactId`, `round`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NULL,
    `kind` ENUM('INCOME', 'EXPENSE') NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `transactionId` INTEGER NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LedgerEntry_transactionId_key`(`transactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `category` ENUM('FOOD', 'SUBSTANCE', 'EQUIPMENT', 'OTHER') NOT NULL,
    `substanceId` INTEGER NULL,
    `currentQty` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `unit` VARCHAR(191) NOT NULL,
    `lowThreshold` DECIMAL(10, 2) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventoryItem_substanceId_key`(`substanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CrabSystem` ADD CONSTRAINT `CrabSystem_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CrabBox` ADD CONSTRAINT `CrabBox_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FilterTank` ADD CONSTRAINT `FilterTank_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Crab` ADD CONSTRAINT `Crab_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Crab` ADD CONSTRAINT `Crab_boxId_fkey` FOREIGN KEY (`boxId`) REFERENCES `CrabBox`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Crab` ADD CONSTRAINT `Crab_sourceSellerId_fkey` FOREIGN KEY (`sourceSellerId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Crab` ADD CONSTRAINT `Crab_buyerId_fkey` FOREIGN KEY (`buyerId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Crab` ADD CONSTRAINT `Crab_lockedForBuyerId_fkey` FOREIGN KEY (`lockedForBuyerId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedingRecord` ADD CONSTRAINT `FeedingRecord_crabId_fkey` FOREIGN KEY (`crabId`) REFERENCES `Crab`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FirmnessRecord` ADD CONSTRAINT `FirmnessRecord_crabId_fkey` FOREIGN KEY (`crabId`) REFERENCES `Crab`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterTest` ADD CONSTRAINT `WaterTest_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterTest` ADD CONSTRAINT `WaterTest_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterTarget` ADD CONSTRAINT `WaterTarget_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DosingRule` ADD CONSTRAINT `DosingRule_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DosingRule` ADD CONSTRAINT `DosingRule_substanceId_fkey` FOREIGN KEY (`substanceId`) REFERENCES `Substance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DosingRecord` ADD CONSTRAINT `DosingRecord_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DosingRecord` ADD CONSTRAINT `DosingRecord_substanceId_fkey` FOREIGN KEY (`substanceId`) REFERENCES `Substance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DosingRecord` ADD CONSTRAINT `DosingRecord_waterTestId_fkey` FOREIGN KEY (`waterTestId`) REFERENCES `WaterTest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DosingRecord` ADD CONSTRAINT `DosingRecord_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubstancePrep` ADD CONSTRAINT `SubstancePrep_substanceId_fkey` FOREIGN KEY (`substanceId`) REFERENCES `Substance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReminderRule` ADD CONSTRAINT `ReminderRule_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `ReminderRule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_parentTaskId_fkey` FOREIGN KEY (`parentTaskId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_crabId_fkey` FOREIGN KEY (`crabId`) REFERENCES `Crab`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OutreachLog` ADD CONSTRAINT `OutreachLog_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `Transaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryItem` ADD CONSTRAINT `InventoryItem_substanceId_fkey` FOREIGN KEY (`substanceId`) REFERENCES `Substance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
