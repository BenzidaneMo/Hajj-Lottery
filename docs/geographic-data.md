# Geographic reference data

Algeria's administrative structure is 69 wilayas and 1541 communes. The
`Wilaya` and `Commune` Prisma models (see [prisma/schema.prisma](../prisma/schema.prisma))
establish this hierarchy. The lottery operates at commune level: every
application will belong to exactly one commune, and a commune always belongs
to exactly one wilaya (`communes.wilaya_id`, `NOT NULL`, `ON DELETE RESTRICT`).

## Source and normalization

**Reference dataset:** https://github.com/ihahachi/Algeria-Cities — a copy is
committed at [prisma/seed-data/algeria_cities.sql](../prisma/seed-data/algeria_cities.sql).
The application does not fetch this repository, or any external source, at
runtime; normalized records live in PostgreSQL.

[prisma/seed-data/build.mjs](../prisma/seed-data/build.mjs) parses that dump
into this project's own `wilayas.json` / `communes.json` (also committed, in
the same directory) — the actual input to `prisma/seed.ts`. Re-run it with
`npm run build:geo-data` only if `algeria_cities.sql` is ever replaced.

The upstream dump has three known defects, corrected explicitly in
`build.mjs` rather than silently at seed time:

- **Wilaya 30 name conflict.** Some of its communes are tagged "Ouargla",
  others "Touggourt" — an artifact of the 2019 wilaya split (this same dump
  already carries Touggourt separately, as wilaya 55). Code 30 is canonically
  Ouargla; picked explicitly rather than by row-count majority (which would
  wrongly favor Touggourt).
- **Two communes in wilaya 6 (Béjaïa) carry another commune's code**
  ("Tizi-N'berber" tagged 647 instead of 649; "M'cisna" tagged 628 instead of
  609). Verified and corrected against the official wilaya de Béjaïa
  commune/daira list (ONIL, "Liste Communes dairas de la wilaya de BEJAIA").

`build.mjs` fails loudly (throws) if the source no longer parses to exactly
1541 communes / 69 wilayas, or if a normalized commune code collides with
another within the same wilaya — so a future upstream change can't silently
reintroduce a duplicate.

## No official English names

Algerian communes/wilayas have no official English name. `nameEn` holds the
established Latin/French transliteration (the same value as `nameFr`) rather
than an invented translation.

## Seeding

`npm run prisma:seed` upserts every wilaya (by `code`) and commune (by
`wilayaId` + `code`), so it's safe to re-run in development. It also
independently validates the seed data (no duplicate wilaya codes, no
duplicate commune codes within a wilaya, every commune references a known
wilaya) before writing anything, and throws with a specific record identified
if a check fails.
