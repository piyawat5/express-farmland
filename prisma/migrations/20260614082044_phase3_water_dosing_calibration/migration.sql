/*
  Warnings:

  - You are about to drop the column `amountBasisL` on the `DosingRule` table. All the data in the column will be lost.
  - You are about to drop the column `amountPerDose` on the `DosingRule` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `DosingRule` DROP COLUMN `amountBasisL`,
    DROP COLUMN `amountPerDose`,
    ADD COLUMN `fixedDose` DECIMAL(8, 3) NULL;

-- CreateTable
CREATE TABLE `DosingCalibration` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `systemId` INTEGER NOT NULL,
    `substanceId` INTEGER NOT NULL,
    `parameter` ENUM('PH', 'ALKALINITY', 'MAGNESIUM', 'CALCIUM', 'SALINITY', 'AMMONIA', 'NITRITE') NOT NULL,
    `effectPerUnit` DECIMAL(10, 4) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DosingCalibration_systemId_substanceId_parameter_key`(`systemId`, `substanceId`, `parameter`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DosingCalibration` ADD CONSTRAINT `DosingCalibration_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `CrabSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DosingCalibration` ADD CONSTRAINT `DosingCalibration_substanceId_fkey` FOREIGN KEY (`substanceId`) REFERENCES `Substance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
