-- Pilgrim capacity: the lottery quota is places, not application records.
--
-- `commune_draws.allocated_spots` has always meant "pilgrimage places awarded to
-- this commune", but the draw spent it one *application* at a time. A paired
-- registration is one application carrying two pilgrims, so a 12 place commune
-- whose draw selected 12 applications could award 15 places — over its own
-- allocation, decided by nobody. The engine now spends the quota in places and
-- selects only groups that fit entirely inside what is left of it, which is what
-- keeps a paired registration from ever being split.
--
-- Two units are now in play everywhere, and this migration's job is to stop them
-- being conflated at the database level:
--
--   selection unit   an application / group    draw_results.winner_count
--   capacity unit    a pilgrim place          draw_results.winner_pilgrim_count
--
-- Nothing recomputes a historical draw. Results produced by the old algorithm
-- keep their recorded winners, order, randomness and hash exactly, and stay
-- publishable: every check added below that could contradict them is conditional
-- on the recorded `algorithm_version`. See docs/pilgrim-capacity.md.

-- --------------------------------------------------------------------------
-- The frozen pool's capacity
-- --------------------------------------------------------------------------

-- Added beside `entry_count`/`total_weight`, the snapshot's other two verified
-- aggregates, and load-bearing for a reason neither of those is: a pool of 2N
-- entries covers anywhere from 2N to 4N places, and only this figure says
-- whether a draw for N places and its reserve list can both be filled.
--
-- Backfilled from the entries rather than defaulted — it is a fact about rows
-- that already exist, and a default would have invented one. Derived from
-- `entry_type`, which the snapshot hash already covers, so no pool's
-- fingerprint changes and `snapshot_version` stays at 1.
ALTER TABLE "draw_pools" ADD COLUMN "pilgrim_count" INTEGER;

UPDATE "draw_pools" AS p
SET "pilgrim_count" = COALESCE((
  SELECT SUM(CASE WHEN e."entry_type" = 'PAIRED' THEN 2 ELSE 1 END)
  FROM "draw_pool_entries" e
  WHERE e."draw_pool_id" = p."id"
), 0);

ALTER TABLE "draw_pools" ALTER COLUMN "pilgrim_count" SET NOT NULL;

-- A pool holds at least one place per entry and at most two, so anything
-- outside that range means the column and the entries disagree.
ALTER TABLE "draw_pools" ADD CONSTRAINT "draw_pools_pilgrim_count_check" CHECK (
  "pilgrim_count" >= "entry_count" AND "pilgrim_count" <= "entry_count" * 2
);

-- --------------------------------------------------------------------------
-- The result's two units
-- --------------------------------------------------------------------------

ALTER TABLE "draw_results" ADD COLUMN "winner_pilgrim_count" INTEGER;
ALTER TABLE "draw_results" ADD COLUMN "reserve_count" INTEGER;
ALTER TABLE "draw_results" ADD COLUMN "reserve_pilgrim_count" INTEGER;

-- Backfilled from the immutable winner and reserve rows, so a historical result
-- describes itself in both units without any of its records being touched. A
-- paired selection is recognised by its `secondary_participant_id`, the same
-- copy-at-write column the result's DTO has always read it from.
UPDATE "draw_results" AS r
SET
  "winner_pilgrim_count" = COALESCE((
    SELECT SUM(CASE WHEN w."secondary_participant_id" IS NOT NULL THEN 2 ELSE 1 END)
    FROM "draw_winners" w
    WHERE w."draw_result_id" = r."id"
  ), 0),
  "reserve_count" = COALESCE((
    SELECT COUNT(*) FROM "draw_reserves" s WHERE s."draw_result_id" = r."id"
  ), 0),
  "reserve_pilgrim_count" = COALESCE((
    SELECT SUM(CASE WHEN s."secondary_participant_id" IS NOT NULL THEN 2 ELSE 1 END)
    FROM "draw_reserves" s
    WHERE s."draw_result_id" = r."id"
  ), 0);

ALTER TABLE "draw_results" ALTER COLUMN "winner_pilgrim_count" SET NOT NULL;
ALTER TABLE "draw_results" ALTER COLUMN "reserve_count" SET NOT NULL;
ALTER TABLE "draw_results" ALTER COLUMN "reserve_pilgrim_count" SET NOT NULL;

-- The relationship between the two units, in both directions. Every selection
-- places at least one pilgrim and at most two, so a pilgrim count below the row
-- count or above twice it cannot describe any set of groups.
--
-- `reserve_count` is deliberately not required to be positive here. Results
-- concluded before reserves existed hold none, and the backfill above records
-- that faithfully as zero rather than inventing a contingency list for a draw
-- that never had one. That a *new* draw must produce a full reserve list is
-- enforced by the capacity trigger below, where it can be conditional on the
-- algorithm that ran.
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_pilgrim_count_check" CHECK (
  "winner_count" > 0
  AND "reserve_count" >= 0
  AND "winner_pilgrim_count" BETWEEN "winner_count" AND "winner_count" * 2
  AND "reserve_pilgrim_count" BETWEEN "reserve_count" AND "reserve_count" * 2
);

-- --------------------------------------------------------------------------
-- The quota invariant, as a database fact
-- --------------------------------------------------------------------------

-- **A draw awards exactly the places its commune was allocated.**
--
-- The single most important property of this change, so it is not left to the
-- service that computes it: checked here against the pool's own frozen
-- `allocated_spots` *and* against the winner and reserve rows as actually
-- written, rather than against the counts the result claims.
--
-- DEFERRABLE INITIALLY DEFERRED, checked at COMMIT, because execution writes
-- the result first and its winners and reserves afterwards inside the same
-- transaction — the same ordering `commune_draws_completed_requires_result`
-- exists for. Checking immediately would forbid the only safe ordering.
--
-- Conditional on `algorithm_version`, and entirely so: a result recorded by the
-- old entry-counting algorithm legitimately has more winning pilgrims than
-- places, and rewriting history to satisfy a rule that did not exist when it ran
-- would destroy the evidence of what it actually did. Nothing in this build
-- inserts such a row any more, so there is no new draw for these checks to let
-- through — the branch exists so that restoring or re-inserting a historical
-- record stays possible, not so that a lesser standard applies to a live draw.
CREATE OR REPLACE FUNCTION assert_result_pilgrim_capacity() RETURNS TRIGGER AS $$
DECLARE
  allocated INTEGER;
  winner_rows INTEGER;
  winner_pilgrims INTEGER;
  reserve_rows INTEGER;
  reserve_pilgrims INTEGER;
BEGIN
  IF NEW."algorithm_version" = 'weighted-csprng-v1' THEN
    RETURN NEW;
  END IF;

  SELECT "allocated_spots" INTO allocated FROM "draw_pools" WHERE "id" = NEW."draw_pool_id";

  IF allocated IS NULL THEN
    RAISE EXCEPTION 'a draw result must name the frozen pool it was drawn from'
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN "secondary_participant_id" IS NOT NULL THEN 2 ELSE 1 END), 0)
  INTO winner_rows, winner_pilgrims
  FROM "draw_winners" WHERE "draw_result_id" = NEW."id";

  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN "secondary_participant_id" IS NOT NULL THEN 2 ELSE 1 END), 0)
  INTO reserve_rows, reserve_pilgrims
  FROM "draw_reserves" WHERE "draw_result_id" = NEW."id";

  -- The result must describe its own rows. Checked independently of the quota
  -- below, because a stored pilgrim figure that disagreed with the winners it
  -- was computed from is the one way a result could satisfy the quota check
  -- without having satisfied the quota.
  IF winner_rows <> NEW."winner_count" OR winner_pilgrims <> NEW."winner_pilgrim_count" THEN
    RAISE EXCEPTION 'this result records % winning applications covering % places, but holds % covering %',
      NEW."winner_count", NEW."winner_pilgrim_count", winner_rows, winner_pilgrims
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF reserve_rows <> NEW."reserve_count" OR reserve_pilgrims <> NEW."reserve_pilgrim_count" THEN
    RAISE EXCEPTION 'this result records % reserve applications covering % places, but holds % covering %',
      NEW."reserve_count", NEW."reserve_pilgrim_count", reserve_rows, reserve_pilgrims
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The quota itself: the places awarded, and the places protected, are each
  -- exactly the places the commune was allocated.
  IF winner_pilgrims <> allocated THEN
    RAISE EXCEPTION 'a draw for % pilgrim place(s) awarded %', allocated, winner_pilgrims
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF reserve_pilgrims <> allocated THEN
    RAISE EXCEPTION 'a draw for % pilgrim place(s) reserved % place(s)', allocated, reserve_pilgrims
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER draw_results_pilgrim_capacity
  AFTER INSERT ON "draw_results"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_result_pilgrim_capacity();

-- --------------------------------------------------------------------------
-- Where a reserve sits in the draw that produced it
-- --------------------------------------------------------------------------

-- Replaces the version in 20260911120100_reserve_replacement, which derived
-- every bound from `winner_count` because the winners and the reserves used to
-- be the same number of rows. They are not: a 12 place draw might produce 11
-- winning applications and 7 reserve applications, both covering 12 places.
--
-- So the bounds come from the result's own recorded counts instead. The two
-- orderings that make a reserve list checkable are unchanged as *properties* —
-- reserve positions occupy 1..reserve_count, and every reserve's place in the
-- draw comes after every winner's — and for a pre-capacity result, where
-- reserve_count = winner_count, this reduces to exactly the old rule.
--
-- The cross-table exclusion stays here too: an entry drawn as a winner cannot
-- also be a reserve. Sampling is without replacement, so the engine cannot
-- produce that — which is exactly why it is worth refusing at the door.
CREATE OR REPLACE FUNCTION assert_reserve_selection_shape() RETURNS TRIGGER AS $$
DECLARE
  winner_rows INTEGER;
  reserve_rows INTEGER;
BEGIN
  SELECT "winner_count", "reserve_count" INTO winner_rows, reserve_rows
  FROM "draw_results" WHERE "id" = NEW."draw_result_id";

  IF winner_rows IS NULL THEN
    RAISE EXCEPTION 'a reserve must belong to a draw result'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."reserve_position" > reserve_rows THEN
    RAISE EXCEPTION 'reserve position % exceeds the % reserve position(s) this draw recorded', NEW."reserve_position", reserve_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."selection_order" <= winner_rows OR NEW."selection_order" > winner_rows + reserve_rows THEN
    RAISE EXCEPTION 'reserve selection order % is not in the reserve half of a draw with % winner(s) and % reserve(s)', NEW."selection_order", winner_rows, reserve_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM "draw_winners" WHERE "draw_pool_entry_id" = NEW."draw_pool_entry_id") THEN
    RAISE EXCEPTION 'a pool entry cannot be both a winner and a reserve'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
