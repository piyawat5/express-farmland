-- AlterTable
ALTER TABLE `CrabSystem` ADD COLUMN `villageOpen` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `farmAvatar` JSON NULL,
    ADD COLUMN `villageJoinedAt` DATETIME(3) NULL;

-- CreateTable
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

-- CreateTable
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

    INDEX `FarmDecor_systemId_idx`(`systemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `FarmLetter_systemId_deletedAt_idx`(`systemId`, `deletedAt`),
    INDEX `FarmLetter_authorId_deletedAt_idx`(`authorId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FarmAccess` ADD CONSTRAINT `FarmAccess_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FarmAccess` ADD CONSTRAINT `FarmAccess_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FarmDecor` ADD CONSTRAINT `FarmDecor_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FarmLetter` ADD CONSTRAINT `FarmLetter_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FarmLetter` ADD CONSTRAINT `FarmLetter_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
