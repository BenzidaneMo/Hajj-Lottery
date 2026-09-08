-- CreateTable
CREATE TABLE "draw_pools" (
    "id" TEXT NOT NULL,
    "commune_draw_id" TEXT NOT NULL,
    "entry_count" INTEGER NOT NULL,
    "total_weight" INTEGER NOT NULL,
    "allocated_spots" INTEGER NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "snapshot_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draw_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draw_pool_entries" (
    "id" TEXT NOT NULL,
    "draw_pool_id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "application_reference" TEXT NOT NULL,
    "entry_type" "entry_type" NOT NULL,
    "primary_participant_id" TEXT NOT NULL,
    "secondary_participant_id" TEXT,
    "weight" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draw_pool_entries_pkey" PRIMARY KEY ("id")
);

-- One pool per commune draw, ever. This is also what makes two administrators
-- freezing the same commune simultaneously resolve to a single authoritative
-- pool rather than two competing ones.
CREATE UNIQUE INDEX "draw_pools_commune_draw_id_key" ON "draw_pools"("commune_draw_id");

-- An application appears at most once in a pool.
CREATE UNIQUE INDEX "draw_pool_entries_draw_pool_id_application_id_key" ON "draw_pool_entries"("draw_pool_id", "application_id");

CREATE INDEX "draw_pool_entries_draw_pool_id_idx" ON "draw_pool_entries"("draw_pool_id");

-- Every relationship RESTRICTs. A frozen pool is the record of what a lottery
-- was run against; deleting a participant, an application or a commune draw
-- must never make that record vanish or become partial. Nothing here cascades.
ALTER TABLE "draw_pools" ADD CONSTRAINT "draw_pools_commune_draw_id_fkey" FOREIGN KEY ("commune_draw_id") REFERENCES "commune_draws"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_pool_entries" ADD CONSTRAINT "draw_pool_entries_draw_pool_id_fkey" FOREIGN KEY ("draw_pool_id") REFERENCES "draw_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_pool_entries" ADD CONSTRAINT "draw_pool_entries_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_pool_entries" ADD CONSTRAINT "draw_pool_entries_primary_participant_id_fkey" FOREIGN KEY ("primary_participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_pool_entries" ADD CONSTRAINT "draw_pool_entries_secondary_participant_id_fkey" FOREIGN KEY ("secondary_participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An entry that can never be drawn is not an entry. The same positive bound
-- the application's own calculated_weight carries.
ALTER TABLE "draw_pool_entries" ADD CONSTRAINT "draw_pool_entries_weight_check" CHECK (
  "weight" BETWEEN 1 AND 1000
);

-- Aggregates cannot be negative, and a pool with no entries is not a pool: a
-- commune where nobody applied is cancelled, not frozen empty.
ALTER TABLE "draw_pools" ADD CONSTRAINT "draw_pools_totals_check" CHECK (
  "entry_count" > 0 AND "total_weight" >= "entry_count" AND "allocated_spots" > 0
);

-- Immutability, enforced by the database rather than only by the absence of an
-- endpoint.
--
-- A frozen pool is the evidence of what a lottery was run against, and
-- evidence that can be edited is not evidence. Once written, these rows cannot
-- be changed or removed by any application code path, including one added
-- carelessly years from now.
--
-- TRUNCATE does not fire row-level triggers, so the test suite can still reset
-- the database between runs.
CREATE OR REPLACE FUNCTION reject_draw_pool_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'draw pool records are immutable: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER draw_pools_immutable
  BEFORE UPDATE OR DELETE ON "draw_pools"
  FOR EACH ROW EXECUTE FUNCTION reject_draw_pool_mutation();

CREATE TRIGGER draw_pool_entries_immutable
  BEFORE UPDATE OR DELETE ON "draw_pool_entries"
  FOR EACH ROW EXECUTE FUNCTION reject_draw_pool_mutation();
