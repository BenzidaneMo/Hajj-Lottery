-- CreateEnum
CREATE TYPE "draw_year_status" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "commune_draw_status" AS ENUM ('DRAFT', 'READY', 'LOCKED', 'CANCELLED');

-- CreateTable
CREATE TABLE "draw_years" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "draw_year_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "draw_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commune_draws" (
    "id" TEXT NOT NULL,
    "draw_year_id" TEXT NOT NULL,
    "commune_id" TEXT NOT NULL,
    "allocated_spots" INTEGER NOT NULL,
    "status" "commune_draw_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commune_draws_pkey" PRIMARY KEY ("id")
);

-- One cycle per calendar year, ever.
CREATE UNIQUE INDEX "draw_years_year_key" ON "draw_years"("year");

-- One configuration per commune per year. This, rather than a read-then-write
-- check, is what makes two administrators configuring the same commune at the
-- same moment resolve to a single row.
CREATE UNIQUE INDEX "commune_draws_draw_year_id_commune_id_key" ON "commune_draws"("draw_year_id", "commune_id");

-- The scoped administrative view reads by commune.
CREATE INDEX "commune_draws_commune_id_idx" ON "commune_draws"("commune_id");

-- AddForeignKey
ALTER TABLE "commune_draws" ADD CONSTRAINT "commune_draws_draw_year_id_fkey" FOREIGN KEY ("draw_year_id") REFERENCES "draw_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commune_draws" ADD CONSTRAINT "commune_draws_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- "Which year is registration for?" must have exactly one answer, so at most
-- one row may be REGISTRATION_OPEN. A partial unique index says that in the
-- database rather than trusting every write path to check first — including
-- two administrators opening two different years simultaneously.
--
-- Every matching row has the same status value, so uniqueness on that column
-- under this predicate permits exactly one.
CREATE UNIQUE INDEX "draw_years_single_open_registration_idx" ON "draw_years"("status")
  WHERE "status" = 'REGISTRATION_OPEN';

-- A commune's allocation is a real number of pilgrimage places. Zero would be
-- a draw that cannot select anybody, which is a cancelled draw expressed as
-- arithmetic; negative is meaningless.
--
-- The upper bound is a guard against a mistyped configuration, not a policy
-- limit: Algeria's national Hajj quota is on the order of tens of thousands
-- across 1541 communes, so 100000 for any single commune is far beyond any
-- legitimate allocation while still catching an extra keystroke.
ALTER TABLE "commune_draws" ADD CONSTRAINT "commune_draws_allocated_spots_check" CHECK (
  "allocated_spots" BETWEEN 1 AND 100000
);

-- A draw year is a calendar year, matching the bound used on applications and
-- the participation ledger.
ALTER TABLE "draw_years" ADD CONSTRAINT "draw_years_year_check" CHECK (
  "year" BETWEEN 2000 AND 2200
);
