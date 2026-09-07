-- CreateEnum
CREATE TYPE "entry_type" AS ENUM ('SINGLE', 'PAIRED');

-- CreateEnum
CREATE TYPE "application_status" AS ENUM ('PENDING');

-- CreateEnum
CREATE TYPE "application_role" AS ENUM ('PRIMARY', 'SECONDARY');

-- AlterTable
ALTER TABLE "participants" ADD COLUMN     "phone_number" TEXT,
ADD COLUMN     "phone_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "application_reference" TEXT NOT NULL,
    "draw_year" INTEGER NOT NULL,
    "commune_id" TEXT NOT NULL,
    "primary_participant_id" TEXT NOT NULL,
    "secondary_participant_id" TEXT,
    "entry_type" "entry_type" NOT NULL,
    "status" "application_status" NOT NULL DEFAULT 'PENDING',
    "calculated_weight" DECIMAL(12,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_participants" (
    "application_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "draw_year" INTEGER NOT NULL,
    "role" "application_role" NOT NULL,

    CONSTRAINT "application_participants_pkey" PRIMARY KEY ("draw_year","participant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "applications_application_reference_key" ON "applications"("application_reference");

-- CreateIndex
CREATE INDEX "applications_draw_year_commune_id_idx" ON "applications"("draw_year", "commune_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_draw_year_primary_participant_id_key" ON "applications"("draw_year", "primary_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_draw_year_secondary_participant_id_key" ON "applications"("draw_year", "secondary_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_id_draw_year_key" ON "applications"("id", "draw_year");

-- CreateIndex
CREATE INDEX "application_participants_participant_id_idx" ON "application_participants"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_participants_application_id_role_key" ON "application_participants"("application_id", "role");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_primary_participant_id_fkey" FOREIGN KEY ("primary_participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_secondary_participant_id_fkey" FOREIGN KEY ("secondary_participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_participants" ADD CONSTRAINT "application_participants_application_id_draw_year_fkey" FOREIGN KEY ("application_id", "draw_year") REFERENCES "applications"("id", "draw_year") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_participants" ADD CONSTRAINT "application_participants_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- entry_type and the secondary applicant must agree. A SINGLE application
-- with a partner, or a PAIRED one without, cannot be stored at all.
ALTER TABLE "applications" ADD CONSTRAINT "applications_entry_type_check" CHECK (
  (entry_type = 'SINGLE' AND secondary_participant_id IS NULL)
  OR (entry_type = 'PAIRED' AND secondary_participant_id IS NOT NULL)
);

-- Nobody may be paired with themselves. Without this, the same participant
-- could occupy both slots and consume two of the commune's places.
ALTER TABLE "applications" ADD CONSTRAINT "applications_distinct_participants_check" CHECK (
  secondary_participant_id IS NULL OR secondary_participant_id <> primary_participant_id
);

-- A draw year is a calendar year, not an arbitrary integer.
ALTER TABLE "applications" ADD CONSTRAINT "applications_draw_year_check" CHECK (
  draw_year BETWEEN 2000 AND 2200
);
