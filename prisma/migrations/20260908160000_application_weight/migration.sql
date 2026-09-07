-- A weight is a count of consecutive years, so it is an integer. The column
-- was DECIMAL(12,6) from the annual-applications step, when nothing computed
-- it and its shape was a placeholder; nothing has ever written to it, so the
-- cast has no rows to convert.
ALTER TABLE "applications"
  ALTER COLUMN "calculated_weight" TYPE INTEGER USING "calculated_weight"::INTEGER;

-- A frozen weight must be usable in a draw. Zero would mean an application
-- that can never be selected — ineligible by arithmetic rather than by the
-- eligibility rules, which is exactly the confusion the domain forbids.
--
-- The upper bound is an overflow guard, not a domain rule. The structural
-- maximum is the span of years the ledger can express (draw_year is
-- constrained to 2000-2200, so a streak cannot exceed ~200); 1000 leaves
-- generous headroom while still rejecting a pathological value.
ALTER TABLE "applications" ADD CONSTRAINT "applications_calculated_weight_check" CHECK (
  "calculated_weight" IS NULL OR ("calculated_weight" BETWEEN 1 AND 1000)
);
