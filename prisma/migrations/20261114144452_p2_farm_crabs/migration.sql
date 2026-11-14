-- CreateTable
CREATE TABLE `CrabSystem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `layout` ENUM('BASKET', 'CONDO_SINGLE', 'CONDO_DOUBLE') NOT NULL,
    `rows` INTEGER NOT NULL,
    `cols` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CrabSystem_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CrabBox` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NOT NULL,
    `side` ENUM('FRONT', 'BACK') NOT NULL DEFAULT 'FRONT',
    `row` INTEGER NOT NULL,
    `col` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CrabBox_systemId_side_row_col_key`(`systemId`, `side`, `row`, `col`),
    UNIQUE INDEX `CrabBox_systemId_side_code_key`(`systemId`, `side`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contact` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `type` ENUM('SELLER', 'CUSTOMER') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Contact_ownerId_type_idx`(`ownerId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CrabLot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `systemId` INTEGER NOT NULL,
    `sellerId` INTEGER NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `totalCost` DECIMAL(12, 2) NULL,
    `costEnteredAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CrabLot_ownerId_receivedAt_idx`(`ownerId`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Crab` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `systemId` INTEGER NOT NULL,
    `boxId` INTEGER NULL,
    `lotId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('EGG', 'MEAT', 'SOFT') NOT NULL,
    `sex` ENUM('MALE', 'FEMALE', 'INTERSEX') NULL,
    `grade` ENUM('A', 'B') NULL,
    `cableTieColor` VARCHAR(191) NULL,
    `status` ENUM('ALIVE', 'SOLD', 'DEAD') NOT NULL DEFAULT 'ALIVE',
    `allocatedCost` DECIMAL(12, 2) NULL,
    `lastWeightG` DECIMAL(8, 1) NULL,
    `lastPct` INTEGER NULL,
    `lastPhotoUrl` TEXT NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `diedAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Crab_systemId_status_deletedAt_idx`(`systemId`, `status`, `deletedAt`),
    INDEX `Crab_lotId_idx`(`lotId`),
    UNIQUE INDEX `Crab_ownerId_code_key`(`ownerId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CrabCheck` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `crabId` INTEGER NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL,
    `weightG` DECIMAL(8, 1) NULL,
    `pct` INTEGER NULL,
    `aiPct` INTEGER NULL,
    `photoUrl` TEXT NULL,
    `photoPublicId` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CrabCheck_crabId_checkedAt_idx`(`crabId`, `checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CrabSystem` ADD CONSTRAINT `CrabSystem_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CrabBox` ADD CONSTRAINT `CrabBox_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CrabLot` ADD CONSTRAINT `CrabLot_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CrabLot` ADD CONSTRAINT `CrabLot_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CrabLot` ADD CONSTRAINT `CrabLot_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Crab` ADD CONSTRAINT `Crab_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Crab` ADD CONSTRAINT `Crab_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Crab` ADD CONSTRAINT `Crab_boxId_fkey` FOREIGN KEY (`boxId`) REFERENCES `CrabBox`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Crab` ADD CONSTRAINT `Crab_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `CrabLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CrabCheck` ADD CONSTRAINT `CrabCheck_crabId_fkey` FOREIGN KEY (`crabId`) REFERENCES `Crab`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
