-- Full name is replaced by four structured, script-specific fields, and
-- gender/phone become required for every participant created from here on.
-- Test/dev database only: existing rows are not backfilled with fabricated
-- values, so this migration assumes an empty or reset database.
ALTER TABLE "participants" DROP COLUMN "full_name";
ALTER TABLE "participants" ADD COLUMN "first_name_ar" TEXT NOT NULL;
ALTER TABLE "participants" ADD COLUMN "last_name_ar" TEXT NOT NULL;
ALTER TABLE "participants" ADD COLUMN "first_name_latin" TEXT NOT NULL;
ALTER TABLE "participants" ADD COLUMN "last_name_latin" TEXT NOT NULL;
ALTER TABLE "participants" ALTER COLUMN "gender" SET NOT NULL;
ALTER TABLE "participants" ALTER COLUMN "phone_number" SET NOT NULL;
