-- AlterTable
ALTER TABLE `User` ADD COLUMN `emailHours` VARCHAR(191) NOT NULL DEFAULT '8,12,16,20',
    ADD COLUMN `lastDigestAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `ReminderRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `systemId` INTEGER NOT NULL,
    `kind` ENUM('WATER_TEST', 'FEEDING', 'CRAB_CHECK', 'MICROBES', 'FRESHWATER', 'FILTER', 'CUSTOM', 'LOT_COST') NOT NULL,
    `defaultKey` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `icon` VARCHAR(191) NULL,
    `priority` ENUM('HIGH', 'MEDIUM', 'LOW') NOT NULL,
    `repeat` ENUM('EVERY_DAYS', 'WEEKDAYS', 'ONCE', 'FEEDING_PLAN') NOT NULL,
    `everyDays` INTEGER NULL,
    `weekdays` VARCHAR(191) NULL,
    `timeOfDay` VARCHAR(191) NOT NULL DEFAULT '08:00',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `nextDueAt` DATETIME(3) NULL,
    `lastDoneAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReminderRule_ownerId_active_nextDueAt_idx`(`ownerId`, `active`, `nextDueAt`),
    UNIQUE INDEX `ReminderRule_systemId_defaultKey_key`(`systemId`, `defaultKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `systemId` INTEGER NULL,
    `ruleId` INTEGER NULL,
    `kind` ENUM('WATER_TEST', 'FEEDING', 'CRAB_CHECK', 'MICROBES', 'FRESHWATER', 'FILTER', 'CUSTOM', 'LOT_COST') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `priority` ENUM('HIGH', 'MEDIUM', 'LOW') NOT NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `status` ENUM('OPEN', 'DONE', 'SKIPPED') NOT NULL DEFAULT 'OPEN',
    `doneAt` DATETIME(3) NULL,
    `closedBy` ENUM('USER', 'AUTO') NULL,
    `openKey` VARCHAR(191) NULL,
    `refId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Task_openKey_key`(`openKey`),
    INDEX `Task_ownerId_status_dueAt_idx`(`ownerId`, `status`, `dueAt`),
    INDEX `Task_ruleId_status_idx`(`ruleId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReminderRule` ADD CONSTRAINT `ReminderRule_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReminderRule` ADD CONSTRAINT `ReminderRule_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `ReminderRule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
