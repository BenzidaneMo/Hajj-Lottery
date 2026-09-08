-- Winner processing: the executed draw, its winners, and lifetime exclusion.
--
-- Everything a completed lottery leaves behind, written in one transaction with
-- the commune draw's own transition to COMPLETED. The constraints below are what
-- make the core invariants impossible to violate rather than merely unlikely:
-- one result per commune draw, one win per person for life, one winner per
-- selection position, and no commune draw claiming to be complete without a
-- result to show.

-- A draw that has been run. Terminal, and reachable only through execution: the
-- deferred constraint trigger at the bottom of this file refuses to commit it
-- without a matching draw result.
ALTER TYPE "commune_draw_status" ADD VALUE 'COMPLETED' BEFORE 'CANCELLED';

-- The outcomes of a concluded draw, for applications that were actually in the
-- frozen pool. Distinct from INELIGIBLE, which is a refusal: NOT_SELECTED took
-- full part in the lottery and was not drawn.
ALTER TYPE "application_status" ADD VALUE 'SELECTED';
ALTER TYPE "application_status" ADD VALUE 'NOT_SELECTED';

-- CreateTable
CREATE TABLE "draw_results" (
    "id" TEXT NOT NULL,
    "commune_draw_id" TEXT NOT NULL,
    "draw_pool_id" TEXT NOT NULL,
    "winner_count" INTEGER NOT NULL,
    "total_weight_at_draw" INTEGER NOT NULL,
    "pool_hash" TEXT NOT NULL,
    "algorithm_version" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draw_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draw_winners" (
    "id" TEXT NOT NULL,
    "draw_result_id" TEXT NOT NULL,
    "draw_pool_entry_id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "primary_participant_id" TEXT NOT NULL,
    "secondary_participant_id" TEXT,
    "selection_order" INTEGER NOT NULL,
    "selected_weight" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draw_winners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draw_selection_events" (
    "id" TEXT NOT NULL,
    "draw_result_id" TEXT NOT NULL,
    "selection_order" INTEGER NOT NULL,
    "active_total_weight" INTEGER NOT NULL,
    "random_value" INTEGER NOT NULL,
    "selected_pool_entry_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draw_selection_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winner_archive" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "draw_year" INTEGER NOT NULL,
    "commune_id" TEXT NOT NULL,
    "draw_result_id" TEXT NOT NULL,
    "draw_pool_entry_id" TEXT NOT NULL,
    "drawn_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "winner_archive_pkey" PRIMARY KEY ("id")
);

-- One result per commune draw, ever. This is what makes a second independent
-- execution impossible: "who won this commune's draw?" has exactly one answer,
-- with no competing result set to disagree with it.
CREATE UNIQUE INDEX "draw_results_commune_draw_id_key" ON "draw_results"("commune_draw_id");

-- A frozen pool produces at most one result.
CREATE UNIQUE INDEX "draw_results_draw_pool_id_key" ON "draw_results"("draw_pool_id");

-- An entry can win once, ever, in any result.
CREATE UNIQUE INDEX "draw_winners_draw_pool_entry_id_key" ON "draw_winners"("draw_pool_entry_id");
CREATE UNIQUE INDEX "draw_winners_draw_result_id_draw_pool_entry_id_key" ON "draw_winners"("draw_result_id", "draw_pool_entry_id");

-- No two winners share a position in the selection order.
CREATE UNIQUE INDEX "draw_winners_draw_result_id_selection_order_key" ON "draw_winners"("draw_result_id", "selection_order");
CREATE INDEX "draw_winners_draw_result_id_idx" ON "draw_winners"("draw_result_id");

CREATE UNIQUE INDEX "draw_selection_events_draw_result_id_selection_order_key" ON "draw_selection_events"("draw_result_id", "selection_order");
CREATE INDEX "draw_selection_events_draw_result_id_idx" ON "draw_selection_events"("draw_result_id");

-- The strongest invariant in the model: a person can be archived as a winner
-- exactly once, in one draw, for life. A malformed pool naming the same
-- participant twice cannot be half-processed — this aborts the whole
-- transaction rather than allowing a silent deduplication.
CREATE UNIQUE INDEX "winner_archive_participant_id_key" ON "winner_archive"("participant_id");
CREATE UNIQUE INDEX "winner_archive_draw_result_id_participant_id_key" ON "winner_archive"("draw_result_id", "participant_id");
CREATE INDEX "winner_archive_draw_year_idx" ON "winner_archive"("draw_year");
CREATE INDEX "winner_archive_commune_id_draw_year_idx" ON "winner_archive"("commune_id", "draw_year");

-- Every relationship RESTRICTs, and nothing cascades. A completed lottery is
-- historically durable: deleting a participant, an application, a pool or a
-- commune draw must never make a result vanish or go partial.
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_commune_draw_id_fkey" FOREIGN KEY ("commune_draw_id") REFERENCES "commune_draws"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_draw_pool_id_fkey" FOREIGN KEY ("draw_pool_id") REFERENCES "draw_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "draw_winners" ADD CONSTRAINT "draw_winners_draw_result_id_fkey" FOREIGN KEY ("draw_result_id") REFERENCES "draw_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_winners" ADD CONSTRAINT "draw_winners_draw_pool_entry_id_fkey" FOREIGN KEY ("draw_pool_entry_id") REFERENCES "draw_pool_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_winners" ADD CONSTRAINT "draw_winners_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_winners" ADD CONSTRAINT "draw_winners_primary_participant_id_fkey" FOREIGN KEY ("primary_participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_winners" ADD CONSTRAINT "draw_winners_secondary_participant_id_fkey" FOREIGN KEY ("secondary_participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "draw_selection_events" ADD CONSTRAINT "draw_selection_events_draw_result_id_fkey" FOREIGN KEY ("draw_result_id") REFERENCES "draw_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_selection_events" ADD CONSTRAINT "draw_selection_events_selected_pool_entry_id_fkey" FOREIGN KEY ("selected_pool_entry_id") REFERENCES "draw_pool_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "winner_archive" ADD CONSTRAINT "winner_archive_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "winner_archive" ADD CONSTRAINT "winner_archive_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "winner_archive" ADD CONSTRAINT "winner_archive_draw_result_id_fkey" FOREIGN KEY ("draw_result_id") REFERENCES "draw_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "winner_archive" ADD CONSTRAINT "winner_archive_draw_pool_entry_id_fkey" FOREIGN KEY ("draw_pool_entry_id") REFERENCES "draw_pool_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A draw selects at least one entry and cannot weigh less than it counts.
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_totals_check" CHECK (
  "winner_count" > 0 AND "total_weight_at_draw" >= "winner_count"
);

-- The selection order is 1-based, and a drawn entry carried a real weight.
ALTER TABLE "draw_winners" ADD CONSTRAINT "draw_winners_order_check" CHECK (
  "selection_order" > 0 AND "selected_weight" BETWEEN 1 AND 1000
);

-- The half-open range the engine draws in, as a database constraint:
-- random_value comes from [0, active_total_weight). A stored event outside it
-- would describe a draw that could not have happened.
ALTER TABLE "draw_selection_events" ADD CONSTRAINT "draw_selection_events_range_check" CHECK (
  "active_total_weight" > 0 AND "random_value" >= 0 AND "random_value" < "active_total_weight"
);

-- Immutability, enforced by the database rather than only by the absence of an
-- endpoint — the same approach the draw pool takes.
--
-- A completed lottery result is evidence: which entries were drawn, in what
-- order, from which input, by which random values. Evidence that can be edited
-- is not evidence, and a result that could be quietly rewritten afterwards
-- would make every published winner unverifiable.
--
-- TRUNCATE does not fire row-level triggers, so the test suite can still reset.
CREATE OR REPLACE FUNCTION reject_draw_record_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'completed draw records are immutable: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER draw_results_immutable
  BEFORE UPDATE OR DELETE ON "draw_results"
  FOR EACH ROW EXECUTE FUNCTION reject_draw_record_mutation();

CREATE TRIGGER draw_winners_immutable
  BEFORE UPDATE OR DELETE ON "draw_winners"
  FOR EACH ROW EXECUTE FUNCTION reject_draw_record_mutation();

CREATE TRIGGER draw_selection_events_immutable
  BEFORE UPDATE OR DELETE ON "draw_selection_events"
  FOR EACH ROW EXECUTE FUNCTION reject_draw_record_mutation();

CREATE TRIGGER winner_archive_immutable
  BEFORE UPDATE OR DELETE ON "winner_archive"
  FOR EACH ROW EXECUTE FUNCTION reject_draw_record_mutation();

-- "A draw marked completed but its winners are missing" is the worst state this
-- system could reach, so PostgreSQL refuses it outright: a commune draw cannot
-- commit as COMPLETED unless a draw result exists for it.
--
-- DEFERRABLE INITIALLY DEFERRED, checked at COMMIT, because execution claims the
-- status first — that conditional update is what serializes two concurrent
-- executions — and writes the result afterwards, inside the same transaction.
-- Checking immediately would forbid the only safe ordering.
--
-- It also closes the administrative path: a PATCH that sets COMPLETED by hand
-- fails at commit, whatever the service layer allows.
CREATE OR REPLACE FUNCTION assert_completed_commune_draw_has_result() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM "draw_results" WHERE "commune_draw_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'a completed commune draw must have a draw result'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER commune_draws_completed_requires_result
  AFTER UPDATE ON "commune_draws"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_completed_commune_draw_has_result();
