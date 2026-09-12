-- Gender is deliberately nullable for records that predate the authoritative
-- identity intake.  The application eligibility rules refuse an unknown value
-- where the Mahram policy needs it; this migration never fabricates it.
CREATE TYPE "gender" AS ENUM ('MALE', 'FEMALE');

ALTER TABLE "participants" ADD COLUMN "gender" "gender";
