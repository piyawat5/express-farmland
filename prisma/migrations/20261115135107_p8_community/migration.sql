-- CreateTable
CREATE TABLE `Idea` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `authorId` INTEGER NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `body` TEXT NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'DONE', 'DECLINED') NOT NULL DEFAULT 'PENDING',
    `reply` TEXT NULL,
    `repliedAt` DATETIME(3) NULL,
    `likeCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Idea_authorId_idx`(`authorId`),
    INDEX `Idea_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdeaLike` (
    `ideaId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IdeaLike_userId_idx`(`userId`),
    PRIMARY KEY (`ideaId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BugReport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `body` TEXT NOT NULL,
    `photos` JSON NULL,
    `page` VARCHAR(300) NULL,
    `pageTitle` VARCHAR(100) NULL,
    `device` JSON NULL,
    `status` ENUM('RECEIVED', 'FIXING', 'FIXED', 'NEED_INFO') NOT NULL DEFAULT 'RECEIVED',
    `userUnread` BOOLEAN NOT NULL DEFAULT false,
    `adminUnread` BOOLEAN NOT NULL DEFAULT true,
    `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BugReport_userId_lastActivityAt_idx`(`userId`, `lastActivityAt`),
    INDEX `BugReport_status_lastActivityAt_idx`(`status`, `lastActivityAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BugComment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bugId` INTEGER NOT NULL,
    `fromAdmin` BOOLEAN NOT NULL DEFAULT false,
    `body` TEXT NULL,
    `photos` JSON NULL,
    `status` ENUM('RECEIVED', 'FIXING', 'FIXED', 'NEED_INFO') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BugComment_bugId_createdAt_idx`(`bugId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Announcement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('MUST_READ', 'GENERAL') NOT NULL DEFAULT 'GENERAL',
    `title` VARCHAR(150) NOT NULL,
    `body` TEXT NOT NULL,
    `linkUrl` VARCHAR(500) NULL,
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Announcement_startsAt_idx`(`startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AnnouncementAck` (
    `announcementId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `ackedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AnnouncementAck_userId_idx`(`userId`),
    PRIMARY KEY (`announcementId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Idea` ADD CONSTRAINT `Idea_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IdeaLike` ADD CONSTRAINT `IdeaLike_ideaId_fkey` FOREIGN KEY (`ideaId`) REFERENCES `Idea`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IdeaLike` ADD CONSTRAINT `IdeaLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BugReport` ADD CONSTRAINT `BugReport_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BugComment` ADD CONSTRAINT `BugComment_bugId_fkey` FOREIGN KEY (`bugId`) REFERENCES `BugReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AnnouncementAck` ADD CONSTRAINT `AnnouncementAck_announcementId_fkey` FOREIGN KEY (`announcementId`) REFERENCES `Announcement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AnnouncementAck` ADD CONSTRAINT `AnnouncementAck_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
