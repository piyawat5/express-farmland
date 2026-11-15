-- AlterTable
ALTER TABLE `Crab` ADD COLUMN `saleId` INTEGER NULL,
    ADD COLUMN `soldAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `Sale` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `systemId` INTEGER NOT NULL,
    `no` INTEGER NOT NULL,
    `status` ENUM('RESERVED', 'DONE', 'CANCELLED') NOT NULL,
    `customerId` INTEGER NULL,
    `total` DECIMAL(12, 2) NOT NULL,
    `reservedAt` DATETIME(3) NULL,
    `soldAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Sale_ownerId_status_soldAt_idx`(`ownerId`, `status`, `soldAt`),
    UNIQUE INDEX `Sale_ownerId_no_key`(`ownerId`, `no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SaleItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `crabId` INTEGER NOT NULL,
    `price` DECIMAL(12, 2) NOT NULL,
    `pricePerKg` DECIMAL(10, 2) NULL,
    `name` VARCHAR(191) NOT NULL,
    `place` VARCHAR(191) NOT NULL DEFAULT '',
    `type` ENUM('EGG', 'MEAT', 'SOFT') NOT NULL,
    `weightG` DECIMAL(8, 1) NULL,
    `pct` INTEGER NULL,
    `photoUrl` TEXT NULL,

    INDEX `SaleItem_crabId_idx`(`crabId`),
    UNIQUE INDEX `SaleItem_saleId_crabId_key`(`saleId`, `crabId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `category` ENUM('FEED', 'SUBSTANCE', 'ELECTRIC', 'WATER', 'EQUIPMENT', 'LABOR', 'OTHER', 'INCOME') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `at` DATETIME(3) NOT NULL,
    `note` VARCHAR(200) NULL,
    `autoMonth` CHAR(7) NULL,
    `edited` BOOLEAN NOT NULL DEFAULT false,
    `hidden` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerEntry_ownerId_at_idx`(`ownerId`, `at`),
    UNIQUE INDEX `LedgerEntry_ownerId_autoMonth_key`(`ownerId`, `autoMonth`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ElectricSetup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `devices` JSON NOT NULL,
    `rate` DECIMAL(6, 2) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `startMonth` CHAR(7) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ElectricSetup_ownerId_key`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Crab_saleId_idx` ON `Crab`(`saleId`);

-- AddForeignKey
ALTER TABLE `Crab` ADD CONSTRAINT `Crab_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleItem` ADD CONSTRAINT `SaleItem_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleItem` ADD CONSTRAINT `SaleItem_crabId_fkey` FOREIGN KEY (`crabId`) REFERENCES `Crab`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ElectricSetup` ADD CONSTRAINT `ElectricSetup_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
