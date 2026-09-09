-- Public access: the release gate that turns a concluded draw into an official,
-- publicly readable result.
--
-- A draw result exists from the moment the lottery concludes. That is not the
-- same thing as an announcement, and conflating the two would mean every result
-- became public the instant it was computed — before anybody had checked it,
-- and with no accountable person having decided to release it. So publication is
-- its own record, written by its own act, by a national administrator.
--
-- There is no UNPUBLISHED row and no status column: the existence of a row here
-- *is* the publication state, which is what stops two sources of truth
-- disagreeing about whether something is public.

-- Publishing is a distinct accountable act from running the draw, so it is a
-- distinct audit action.
ALTER TYPE "audit_action" ADD VALUE 'DRAW_RESULT_PUBLISHED' AFTER 'COMMUNE_DRAW_EXECUTED';

-- CreateTable
CREATE TABLE "result_publications" (
    "id" TEXT NOT NULL,
    "draw_result_id" TEXT NOT NULL,
    "draw_year" INTEGER NOT NULL,
    "commune_id" TEXT NOT NULL,
    "winner_count" INTEGER NOT NULL,
    "winning_participant_count" INTEGER NOT NULL,
    "entry_count" INTEGER NOT NULL,
    "allocated_spots" INTEGER NOT NULL,
    "published_by_user_id" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_publications_pkey" PRIMARY KEY ("id")
);

-- One publication per result, ever.
--
-- This is what makes publishing idempotent rather than merely guarded: a second
-- request cannot insert a second row, so "publish twice" resolves to "find the
-- existing publication and change nothing" even under concurrent calls, and no
-- duplicate audit event can be produced.
CREATE UNIQUE INDEX "result_publications_draw_result_id_key" ON "result_publications"("draw_result_id");

-- The public listing's only access path: a year, optionally narrowed to a
-- commune. Wilaya filtering nests through communes(wilaya_id), which is already
-- indexed, so no wilaya column is copied here.
CREATE INDEX "result_publications_draw_year_commune_id_idx" ON "result_publications"("draw_year", "commune_id");

-- RESTRICT throughout, like every other record describing a concluded lottery.
-- Deleting a result, a commune or an administrator must never make a published
-- announcement silently vanish.
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_draw_result_id_fkey" FOREIGN KEY ("draw_result_id") REFERENCES "draw_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The published totals must be internally coherent. These are copies of values
-- the publication service verified against draw_results, draw_winners,
-- winner_archive and draw_pools before writing them; the CHECK is what stops a
-- future caller writing a set that could never have come from a real draw.
--
-- winning_participant_count >= winner_count because a paired application is one
-- winning entry and two winning people. entry_count >= winner_count because a
-- draw cannot select more entries than it chose from.
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_totals_check" CHECK (
  "winner_count" > 0
  AND "winning_participant_count" >= "winner_count"
  AND "winning_participant_count" <= 2 * "winner_count"
  AND "entry_count" >= "winner_count"
  AND "allocated_spots" > 0
);

-- No unpublishing, and no editing a published announcement — by trigger, not
-- merely by the absence of an endpoint.
--
-- Once citizens have been told a result is official, it must not quietly change
-- or disappear: somebody who read it yesterday and somebody who reads it today
-- have to be looking at the same thing. If a published result ever has to be
-- retracted, that is a governance workflow with its own record and its own
-- approval — not an UPDATE somebody can issue.
--
-- TRUNCATE does not fire row-level triggers, so the test suite can still reset.
CREATE OR REPLACE FUNCTION reject_result_publication_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'published results are immutable: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER result_publications_immutable
  BEFORE UPDATE OR DELETE ON "result_publications"
  FOR EACH ROW EXECUTE FUNCTION reject_result_publication_mutation();
