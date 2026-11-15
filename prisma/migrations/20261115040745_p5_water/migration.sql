-- CreateTable
CREATE TABLE `WaterParam` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `systemId` INTEGER NOT NULL,
    `key` VARCHAR(8) NULL,
    `name` VARCHAR(40) NOT NULL,
    `unit` VARCHAR(16) NOT NULL DEFAULT '',
    `color` VARCHAR(9) NOT NULL,
    `min` DECIMAL(10, 3) NULL,
    `max` DECIMAL(10, 3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WaterParam_ownerId_idx`(`ownerId`),
    UNIQUE INDEX `WaterParam_systemId_key_key`(`systemId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaterSubstance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WaterSubstance_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaterRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paramId` INTEGER NOT NULL,
    `when` ENUM('LOW', 'HIGH') NOT NULL,
    `action` ENUM('DOSE', 'WARN', 'RETEST') NOT NULL,
    `substanceId` INTEGER NULL,
    `amount` DECIMAL(10, 3) NULL,
    `doseUnit` VARCHAR(16) NULL,
    `effect` DECIMAL(10, 3) NULL,
    `note` VARCHAR(200) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WaterRule_paramId_when_key`(`paramId`, `when`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaterTest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `systemId` INTEGER NOT NULL,
    `testedAt` DATETIME(3) NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WaterTest_systemId_testedAt_idx`(`systemId`, `testedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaterReading` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `testId` INTEGER NOT NULL,
    `paramId` INTEGER NOT NULL,
    `value` DECIMAL(10, 3) NOT NULL,

    INDEX `WaterReading_paramId_idx`(`paramId`),
    UNIQUE INDEX `WaterReading_testId_paramId_key`(`testId`, `paramId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaterAction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `systemId` INTEGER NOT NULL,
    `testId` INTEGER NOT NULL,
    `paramId` INTEGER NOT NULL,
    `substanceId` INTEGER NULL,
    `amount` DECIMAL(10, 3) NULL,
    `unit` VARCHAR(16) NULL,
    `label` VARCHAR(200) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WaterAction_systemId_at_idx`(`systemId`, `at`),
    UNIQUE INDEX `WaterAction_testId_paramId_key`(`testId`, `paramId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WaterParam` ADD CONSTRAINT `WaterParam_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterParam` ADD CONSTRAINT `WaterParam_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterSubstance` ADD CONSTRAINT `WaterSubstance_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterRule` ADD CONSTRAINT `WaterRule_paramId_fkey` FOREIGN KEY (`paramId`) REFERENCES `WaterParam`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterRule` ADD CONSTRAINT `WaterRule_substanceId_fkey` FOREIGN KEY (`substanceId`) REFERENCES `WaterSubstance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterTest` ADD CONSTRAINT `WaterTest_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterTest` ADD CONSTRAINT `WaterTest_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterReading` ADD CONSTRAINT `WaterReading_testId_fkey` FOREIGN KEY (`testId`) REFERENCES `WaterTest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterReading` ADD CONSTRAINT `WaterReading_paramId_fkey` FOREIGN KEY (`paramId`) REFERENCES `WaterParam`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterAction` ADD CONSTRAINT `WaterAction_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterAction` ADD CONSTRAINT `WaterAction_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterAction` ADD CONSTRAINT `WaterAction_testId_fkey` FOREIGN KEY (`testId`) REFERENCES `WaterTest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterAction` ADD CONSTRAINT `WaterAction_paramId_fkey` FOREIGN KEY (`paramId`) REFERENCES `WaterParam`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaterAction` ADD CONSTRAINT `WaterAction_substanceId_fkey` FOREIGN KEY (`substanceId`) REFERENCES `WaterSubstance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
