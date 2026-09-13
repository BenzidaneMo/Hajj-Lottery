-- Staged rows mirror the same four name fields, kept nullable: staging must
-- still tolerate an incomplete or partially-transcribed paper register.
ALTER TABLE "import_rows" DROP COLUMN "full_name";
ALTER TABLE "import_rows" ADD COLUMN "first_name_ar" TEXT;
ALTER TABLE "import_rows" ADD COLUMN "last_name_ar" TEXT;
ALTER TABLE "import_rows" ADD COLUMN "first_name_latin" TEXT;
ALTER TABLE "import_rows" ADD COLUMN "last_name_latin" TEXT;
