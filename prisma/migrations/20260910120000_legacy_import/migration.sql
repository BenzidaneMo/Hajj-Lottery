-- Legacy historical import.
--
-- Paper registers from before this platform existed are the only record of who
-- has been waiting how long, and that waiting is what the priority weighting is
-- built on. An import is therefore not a bulk insert: it decides who gets
-- preference in future lotteries and who is excluded from them for life.
--
-- The structure this migration adds says so. Rows are staged in their own table
-- and checked there; nothing authoritative moves until a national administrator
-- who did not upload the file has approved it; and the record of a legacy win is
-- a table of its own rather than a nullable version of the web-era one.

-- New audit vocabulary. Four import events, because the four moments differ in
-- actor and in consequence: uploading stages nothing authoritative, approving
-- still writes nothing, and only completion changes what a lottery will see.
ALTER TYPE "audit_action" ADD VALUE 'LEGACY_IMPORT_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'LEGACY_IMPORT_APPROVED';
ALTER TYPE "audit_action" ADD VALUE 'LEGACY_IMPORT_REJECTED';
ALTER TYPE "audit_action" ADD VALUE 'LEGACY_IMPORT_COMPLETED';

ALTER TYPE "audit_target_type" ADD VALUE 'IMPORT_BATCH';

CREATE TYPE "import_source_format" AS ENUM ('CSV', 'XLSX');

CREATE TYPE "import_batch_status" AS ENUM (
  'UPLOADED',
  'VALIDATING',
  'READY_FOR_REVIEW',
  'REJECTED',
  'APPROVED',
  'IMPORTED',
  'FAILED'
);

CREATE TYPE "import_row_status" AS ENUM ('VALID', 'WARNING', 'CONFLICT', 'INVALID');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "source_filename" TEXT NOT NULL,
    "source_format" "import_source_format" NOT NULL,
    "source_checksum" TEXT NOT NULL,
    "draw_year_start" INTEGER,
    "draw_year_end" INTEGER,
    "status" "import_batch_status" NOT NULL DEFAULT 'UPLOADED',
    "uploaded_by_user_id" TEXT NOT NULL,
    "approved_by_user_id" TEXT,
    "review_reason" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "imported_at" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "import_batch_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "national_id" TEXT,
    "full_name" TEXT,
    "dob" DATE,
    "phone_number" TEXT,
    "commune_code" TEXT NOT NULL,
    "commune_id" TEXT,
    "draw_year" INTEGER,
    "participated" BOOLEAN,
    "won" BOOLEAN,
    "notes" TEXT,
    "status" "import_row_status" NOT NULL DEFAULT 'VALID',
    "issues" JSONB,
    "participant_id" TEXT,
    "participation_history_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_winners" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "draw_year" INTEGER NOT NULL,
    "commune_id" TEXT NOT NULL,
    "import_batch_id" TEXT NOT NULL,
    "import_row_id" TEXT NOT NULL,
    "participation_history_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_winners_pkey" PRIMARY KEY ("id")
);

-- Uploading the same register twice must report the batch that already holds it
-- rather than quietly duplicating thousands of historical records. The unique
-- index is what makes that true under concurrent uploads too, where a read-then-
-- write check would let both through.
CREATE UNIQUE INDEX "import_batches_source_checksum_key" ON "import_batches"("source_checksum");
CREATE INDEX "import_batches_status_created_at_idx" ON "import_batches"("status", "created_at");
CREATE INDEX "import_batches_uploaded_by_user_id_created_at_idx" ON "import_batches"("uploaded_by_user_id", "created_at");

CREATE UNIQUE INDEX "import_rows_import_batch_id_row_number_key" ON "import_rows"("import_batch_id", "row_number");
CREATE UNIQUE INDEX "import_rows_participation_history_id_key" ON "import_rows"("participation_history_id");
CREATE INDEX "import_rows_import_batch_id_status_idx" ON "import_rows"("import_batch_id", "status");
CREATE INDEX "import_rows_commune_id_idx" ON "import_rows"("commune_id");
CREATE INDEX "import_rows_national_id_draw_year_idx" ON "import_rows"("national_id", "draw_year");

-- One legacy win per person, for life — the same invariant winner_archive holds
-- for the web era, in the table that describes the other provenance.
CREATE UNIQUE INDEX "legacy_winners_participant_id_key" ON "legacy_winners"("participant_id");
CREATE UNIQUE INDEX "legacy_winners_import_row_id_key" ON "legacy_winners"("import_row_id");
CREATE UNIQUE INDEX "legacy_winners_participation_history_id_key" ON "legacy_winners"("participation_history_id");
CREATE INDEX "legacy_winners_draw_year_idx" ON "legacy_winners"("draw_year");
CREATE INDEX "legacy_winners_commune_id_draw_year_idx" ON "legacy_winners"("commune_id", "draw_year");

-- Staging rows belong to their batch and go with it; everything a batch points
-- *out* at is RESTRICT, so no import record loses the person, place or ledger row
-- it describes.
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_participation_history_id_fkey" FOREIGN KEY ("participation_history_id") REFERENCES "participation_history"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_winners" ADD CONSTRAINT "legacy_winners_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legacy_winners" ADD CONSTRAINT "legacy_winners_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legacy_winners" ADD CONSTRAINT "legacy_winners_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legacy_winners" ADD CONSTRAINT "legacy_winners_import_row_id_fkey" FOREIGN KEY ("import_row_id") REFERENCES "import_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legacy_winners" ADD CONSTRAINT "legacy_winners_participation_history_id_fkey" FOREIGN KEY ("participation_history_id") REFERENCES "participation_history"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- **Separation of duties, as a constraint rather than a rule in a service.**
-- Nobody approves the import they uploaded. A legacy import grants lifetime
-- priority and imposes lifetime exclusion; an administrator who could stage a
-- file and accept it alone would have both without anybody else ever reading it.
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_no_self_approval_check" CHECK (
  "approved_by_user_id" IS NULL OR "approved_by_user_id" <> "uploaded_by_user_id"
);

-- A decision is an approver plus a moment plus a reason. A rejection has the
-- moment and the reason but no approver — it approved nothing.
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_decision_check" CHECK (
  ("status" IN ('UPLOADED', 'VALIDATING', 'READY_FOR_REVIEW', 'FAILED')
     AND "approved_by_user_id" IS NULL AND "reviewed_at" IS NULL)
  OR ("status" = 'REJECTED'
     AND "approved_by_user_id" IS NULL AND "reviewed_at" IS NOT NULL AND length(btrim("review_reason")) > 0)
  OR ("status" IN ('APPROVED', 'IMPORTED')
     AND "approved_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL AND length(btrim("review_reason")) > 0)
);

-- Imported means imported: the moment is part of the state, not a field somebody
-- remembered to set.
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_imported_at_check" CHECK (
  ("status" = 'IMPORTED' AND "imported_at" IS NOT NULL) OR ("status" <> 'IMPORTED' AND "imported_at" IS NULL)
);

ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_draw_year_span_check" CHECK (
  ("draw_year_start" IS NULL AND "draw_year_end" IS NULL)
  OR ("draw_year_start" IS NOT NULL AND "draw_year_end" IS NOT NULL AND "draw_year_start" <= "draw_year_end")
);

-- Note what is deliberately *absent* here: the ledger's rule that you cannot win
-- a draw you did not take part in. That rule belongs on `participation_history`,
-- which holds facts, and not on staging, which holds claims. A register that says
-- somebody won a draw they did not enter has to be storable, because the row is
-- the evidence for the conflict a reviewer is being shown. Refusing it at the
-- database would mean the file could not even be staged, and the administrator
-- would be told the upload failed rather than which line is wrong.
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_draw_year_check" CHECK (
  "draw_year" IS NULL OR ("draw_year" >= 2000 AND "draw_year" <= 2200)
);

ALTER TABLE "legacy_winners" ADD CONSTRAINT "legacy_winners_draw_year_check" CHECK (
  "draw_year" >= 2000 AND "draw_year" <= 2200
);

-- A batch that has finished is finished.
--
-- IMPORTED, REJECTED and FAILED are terminal, and the trigger says so rather
-- than the service alone: a batch that could be re-opened could be re-imported,
-- and re-importing is how one person acquires two accounts of the same year. The
-- staged rows stay readable — they are the evidence for what was written, and
-- deleting a conflicting source row would destroy the reason it was a conflict.
CREATE OR REPLACE FUNCTION reject_terminal_import_batch_change() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an import batch is a provenance record and cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status" IN ('IMPORTED', 'REJECTED', 'FAILED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'import batch % is already %; upload a corrected register instead', OLD."id", OLD."status"
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."source_checksum" <> OLD."source_checksum"
     OR NEW."uploaded_by_user_id" <> OLD."uploaded_by_user_id"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'the source and origin of an import batch cannot be rewritten'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER import_batches_terminal
  BEFORE UPDATE OR DELETE ON "import_batches"
  FOR EACH ROW EXECUTE FUNCTION reject_terminal_import_batch_change();

-- A legacy win is as immutable as a drawn one.
--
-- Both are the permanent record that a person's lifetime entitlement was used.
-- winner_archive is protected this way already; a second winner model with weaker
-- protection would just be the easier one to edit.
CREATE OR REPLACE FUNCTION reject_legacy_winner_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'legacy winner records are immutable: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legacy_winners_immutable
  BEFORE UPDATE OR DELETE ON "legacy_winners"
  FOR EACH ROW EXECUTE FUNCTION reject_legacy_winner_mutation();
