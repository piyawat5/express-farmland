-- DropForeignKey
ALTER TABLE `Crab` DROP FOREIGN KEY `Crab_lotId_fkey`;

-- AddForeignKey
ALTER TABLE `Crab` ADD CONSTRAINT `Crab_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `CrabLot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
