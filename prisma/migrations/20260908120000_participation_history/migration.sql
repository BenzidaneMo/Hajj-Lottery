-- CreateEnum
CREATE TYPE "participation_source" AS ENUM ('LEGACY_IMPORT', 'APPLICATION', 'ADMIN_CORRECTION');

-- CreateTable
CREATE TABLE "participation_history" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "commune_id" TEXT NOT NULL,
    "draw_year" INTEGER NOT NULL,
    "participated" BOOLEAN NOT NULL,
    "won" BOOLEAN NOT NULL DEFAULT false,
    "source" "participation_source" NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "participation_history_pkey" PRIMARY KEY ("id")
);

-- One person, one story per year. Enforced here rather than by a
-- check-then-insert, so two administrators saving the same year at the same
-- moment resolve to one row instead of two contradictory ones.
CREATE UNIQUE INDEX "participation_history_participant_id_draw_year_key" ON "participation_history"("participant_id", "draw_year");

-- The streak walk: one participant's years, newest first.
CREATE INDEX "participation_history_participant_id_draw_year_idx" ON "participation_history"("participant_id", "draw_year");

-- The administrative view: one commune's year.
CREATE INDEX "participation_history_commune_id_draw_year_idx" ON "participation_history"("commune_id", "draw_year");

-- AddForeignKey
ALTER TABLE "participation_history" ADD CONSTRAINT "participation_history_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participation_history" ADD CONSTRAINT "participation_history_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- You cannot win a draw you did not take part in. The only contradiction the
-- data model can express on its own, so it is the only one ruled out here —
-- everything else about a historical fact is a question of evidence, not of
-- logic, and belongs to `verified` rather than to a constraint.
ALTER TABLE "participation_history" ADD CONSTRAINT "participation_history_won_requires_participation_check" CHECK (
  participated = true OR won = false
);

-- A draw year is a calendar year, matching the same bound on applications.
ALTER TABLE "participation_history" ADD CONSTRAINT "participation_history_draw_year_check" CHECK (
  draw_year BETWEEN 2000 AND 2200
);
