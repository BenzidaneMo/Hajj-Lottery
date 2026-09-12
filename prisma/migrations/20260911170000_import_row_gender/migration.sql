-- Optional staged gender from a source that actually named the column.
-- Absence remains null; nothing here fabricates a value.
ALTER TABLE "import_rows" ADD COLUMN "gender" "gender";
