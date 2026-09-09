-- Reserves and replacement, part two: the reserve list, abandonment, and the
-- constraints that keep the original draw immutable while its outcomes move.
--
-- The domain rule this implements: a commune with N places draws 2N entries in
-- one continuous weighted sample. The first N are winners; the next N are
-- reserves, in that order, forever. Nothing here regenerates a reserve list,
-- reorders one, or re-runs a lottery — a replacement reads an ordering that was
-- fixed the moment the draw concluded.
--
-- The split between immutable and mutable is the design. `draw_reserves` holds
-- both, and a trigger draws the line down the middle of the row: the selection
-- columns cannot be changed by anybody, and the lifecycle columns can only move
-- along the transitions the workflow defines.

CREATE TYPE "reserve_status" AS ENUM ('WAITING', 'CALLED', 'ACCEPTED', 'DECLINED');
CREATE TYPE "abandonment_reason" AS ENUM ('VOLUNTARY_WITHDRAWAL', 'DEATH', 'MEDICAL', 'OTHER');
CREATE TYPE "winner_source" AS ENUM ('ORIGINAL_DRAW', 'RESERVE_REPLACEMENT');

-- How a person came to be a winner. Existing rows are all original winners, and
-- the default records that rather than leaving a nullable column somebody would
-- later have to interpret.
ALTER TABLE "winner_archive"
  ADD COLUMN "source" "winner_source" NOT NULL DEFAULT 'ORIGINAL_DRAW';

-- CreateTable
CREATE TABLE "draw_reserves" (
    "id" TEXT NOT NULL,
    "draw_result_id" TEXT NOT NULL,
    "draw_pool_entry_id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "primary_participant_id" TEXT NOT NULL,
    "secondary_participant_id" TEXT,
    "selection_order" INTEGER NOT NULL,
    "reserve_position" INTEGER NOT NULL,
    "selected_weight" INTEGER NOT NULL,
    "status" "reserve_status" NOT NULL DEFAULT 'WAITING',
    "replaces_draw_winner_id" TEXT,
    "called_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "draw_reserves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winner_abandonments" (
    "id" TEXT NOT NULL,
    "draw_winner_id" TEXT NOT NULL,
    "reason" "abandonment_reason" NOT NULL,
    "explanation" TEXT NOT NULL,
    "recorded_by_user_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "winner_abandonments_pkey" PRIMARY KEY ("id")
);

-- An entry is drawn once, into one half of one draw. The cross-table half of
-- that ("not a winner as well") is a trigger further down.
CREATE UNIQUE INDEX "draw_reserves_draw_pool_entry_id_key" ON "draw_reserves"("draw_pool_entry_id");

-- No two reserves share a position in the call order, and none shares a place in
-- the draw that produced them.
CREATE UNIQUE INDEX "draw_reserves_draw_result_id_reserve_position_key" ON "draw_reserves"("draw_result_id", "reserve_position");
CREATE UNIQUE INDEX "draw_reserves_draw_result_id_selection_order_key" ON "draw_reserves"("draw_result_id", "selection_order");
CREATE INDEX "draw_reserves_draw_result_id_status_idx" ON "draw_reserves"("draw_result_id", "status");

-- One abandonment per winning entry, ever. A paired winning application is one
-- entry and is given up as a whole — there is no half-abandonment to record.
CREATE UNIQUE INDEX "winner_abandonments_draw_winner_id_key" ON "winner_abandonments"("draw_winner_id");

-- **One replacement per vacated place.** A partial unique index rather than a
-- plain one, because a declined reserve must not block the next: exactly one
-- undeclined reserve may point at a given abandoned winner at a time, so two
-- administrators calling for the same place serialize here, and a place that has
-- been filled cannot be filled again.
CREATE UNIQUE INDEX "draw_reserves_active_replacement_key"
  ON "draw_reserves"("replaces_draw_winner_id")
  WHERE "replaces_draw_winner_id" IS NOT NULL AND "status" <> 'DECLINED';

-- Every relationship RESTRICTs, like the rest of a concluded draw. A reserve
-- list is part of the historical record of a lottery; nothing may make it vanish
-- or go partial.
ALTER TABLE "draw_reserves" ADD CONSTRAINT "draw_reserves_draw_result_id_fkey" FOREIGN KEY ("draw_result_id") REFERENCES "draw_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_reserves" ADD CONSTRAINT "draw_reserves_draw_pool_entry_id_fkey" FOREIGN KEY ("draw_pool_entry_id") REFERENCES "draw_pool_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_reserves" ADD CONSTRAINT "draw_reserves_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_reserves" ADD CONSTRAINT "draw_reserves_primary_participant_id_fkey" FOREIGN KEY ("primary_participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_reserves" ADD CONSTRAINT "draw_reserves_secondary_participant_id_fkey" FOREIGN KEY ("secondary_participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_reserves" ADD CONSTRAINT "draw_reserves_replaces_draw_winner_id_fkey" FOREIGN KEY ("replaces_draw_winner_id") REFERENCES "draw_winners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "winner_abandonments" ADD CONSTRAINT "winner_abandonments_draw_winner_id_fkey" FOREIGN KEY ("draw_winner_id") REFERENCES "draw_winners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "winner_abandonments" ADD CONSTRAINT "winner_abandonments_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Positions are 1-based, and a drawn entry carried a real weight — the same
-- bounds `draw_winners` is held to.
ALTER TABLE "draw_reserves" ADD CONSTRAINT "draw_reserves_order_check" CHECK (
  "selection_order" > 0 AND "reserve_position" > 0 AND "selected_weight" BETWEEN 1 AND 1000
);

-- **The lifecycle's shape, as a constraint.** Each state says exactly which of
-- the mutable columns must be set, so a half-written transition — called with
-- nobody to replace, decided with no record of being asked — cannot be stored at
-- all, whatever a service does.
ALTER TABLE "draw_reserves" ADD CONSTRAINT "draw_reserves_lifecycle_check" CHECK (
  (
    "status" = 'WAITING'
    AND "replaces_draw_winner_id" IS NULL
    AND "called_at" IS NULL
    AND "decided_at" IS NULL
  ) OR (
    "status" = 'CALLED'
    AND "replaces_draw_winner_id" IS NOT NULL
    AND "called_at" IS NOT NULL
    AND "decided_at" IS NULL
  ) OR (
    "status" IN ('ACCEPTED', 'DECLINED')
    AND "replaces_draw_winner_id" IS NOT NULL
    AND "called_at" IS NOT NULL
    AND "decided_at" IS NOT NULL
  )
);

-- Whitespace is not an explanation. Somebody has been removed from a pilgrimage
-- they were told they had won; the record has to say what happened.
ALTER TABLE "winner_abandonments" ADD CONSTRAINT "winner_abandonments_explanation_check" CHECK (
  length(btrim("explanation")) > 0
);

-- An abandonment is a record of a decision, like an audit row: append-only for
-- everyone. Retracting one would mean deciding, invisibly, that somebody had
-- never given up their place — and a reserve may already have taken it.
CREATE TRIGGER winner_abandonments_immutable
  BEFORE UPDATE OR DELETE ON "winner_abandonments"
  FOR EACH ROW EXECUTE FUNCTION reject_draw_record_mutation();

-- **Where a reserve sits in the draw that produced it.**
--
-- Checked against the result's own winner count rather than trusted from the
-- caller, so the two orderings that make a reserve list checkable are database
-- facts: reserve positions occupy 1..N, and every reserve's place in the draw
-- comes after every winner's. A row claiming reserve #1 was selection #3 would
-- describe a lottery that did not happen.
--
-- The cross-table exclusion belongs here too: an entry drawn as a winner cannot
-- also be a reserve. Sampling is without replacement, so the engine cannot
-- produce that — which is exactly why it is worth refusing at the door.
CREATE OR REPLACE FUNCTION assert_reserve_selection_shape() RETURNS TRIGGER AS $$
DECLARE
  allocated INTEGER;
BEGIN
  SELECT "winner_count" INTO allocated FROM "draw_results" WHERE "id" = NEW."draw_result_id";

  IF allocated IS NULL THEN
    RAISE EXCEPTION 'a reserve must belong to a draw result'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."reserve_position" > allocated THEN
    RAISE EXCEPTION 'reserve position % exceeds the % places this draw allocated', NEW."reserve_position", allocated
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."selection_order" <= allocated OR NEW."selection_order" > allocated * 2 THEN
    RAISE EXCEPTION 'reserve selection order % is not in the reserve half of a % place draw', NEW."selection_order", allocated
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM "draw_winners" WHERE "draw_pool_entry_id" = NEW."draw_pool_entry_id") THEN
    RAISE EXCEPTION 'a pool entry cannot be both a winner and a reserve'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER draw_reserves_selection_shape
  BEFORE INSERT ON "draw_reserves"
  FOR EACH ROW EXECUTE FUNCTION assert_reserve_selection_shape();

-- The same exclusion from the other side, so neither table can be populated
-- first and then contradicted.
CREATE OR REPLACE FUNCTION assert_winner_is_not_a_reserve() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "draw_reserves" WHERE "draw_pool_entry_id" = NEW."draw_pool_entry_id") THEN
    RAISE EXCEPTION 'a pool entry cannot be both a winner and a reserve'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER draw_winners_not_reserves
  BEFORE INSERT ON "draw_winners"
  FOR EACH ROW EXECUTE FUNCTION assert_winner_is_not_a_reserve();

-- **The line down the middle of the row.**
--
-- `draw_reserves` is the one table in a concluded draw that may be updated at
-- all, and this is what keeps that from meaning the draw is editable. The
-- selection facts — which entry, which application, which people, what weight,
-- what position, what place in the order — are refused exactly as `draw_winners`
-- refuses every change. Only the lifecycle columns move, and only along the
-- transitions the workflow defines: a reserve is called once, answers once, and
-- there is no route back from either answer.
--
-- Deletion is refused outright. A reserve list with a gap in it is not a reserve
-- list, and "who was next?" must always have the answer the lottery gave.
CREATE OR REPLACE FUNCTION guard_reserve_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a drawn reserve cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."draw_result_id" IS DISTINCT FROM OLD."draw_result_id"
     OR NEW."draw_pool_entry_id" IS DISTINCT FROM OLD."draw_pool_entry_id"
     OR NEW."application_id" IS DISTINCT FROM OLD."application_id"
     OR NEW."primary_participant_id" IS DISTINCT FROM OLD."primary_participant_id"
     OR NEW."secondary_participant_id" IS DISTINCT FROM OLD."secondary_participant_id"
     OR NEW."selection_order" IS DISTINCT FROM OLD."selection_order"
     OR NEW."reserve_position" IS DISTINCT FROM OLD."reserve_position"
     OR NEW."selected_weight" IS DISTINCT FROM OLD."selected_weight"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'the original lottery selection behind a reserve is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NOT (
    (OLD."status" = 'WAITING' AND NEW."status" IN ('WAITING', 'CALLED'))
    OR (OLD."status" = 'CALLED' AND NEW."status" IN ('CALLED', 'ACCEPTED', 'DECLINED'))
    OR (OLD."status" = NEW."status")
  ) THEN
    RAISE EXCEPTION 'a reserve cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Being called is a fact about one vacated place. Re-pointing it at another
  -- afterwards would rewrite who was asked for what.
  IF OLD."replaces_draw_winner_id" IS NOT NULL
     AND NEW."replaces_draw_winner_id" IS DISTINCT FROM OLD."replaces_draw_winner_id" THEN
    RAISE EXCEPTION 'a called reserve cannot be reassigned to a different winner'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER draw_reserves_guarded
  BEFORE UPDATE OR DELETE ON "draw_reserves"
  FOR EACH ROW EXECUTE FUNCTION guard_reserve_mutation();
