-- AlterTable: เพิ่มรูปโปรไฟล์จาก OAuth (ข้อ 4.5) — nullable เพิ่มอย่างเดียว ไม่กระทบข้อมูลเดิม
ALTER TABLE `User` ADD COLUMN `avatarUrl` TEXT NULL;
