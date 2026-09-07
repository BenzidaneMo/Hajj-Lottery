# Geographic reference data

Algeria's administrative structure is 69 wilayas and 1541 communes. The
`Wilaya` and `Commune` Prisma models (see [prisma/schema.prisma](../prisma/schema.prisma))
establish this hierarchy.

**Initial reference dataset:** https://github.com/ihahachi/Algeria-Cities

This repository is a reference for normalizing wilaya/commune names and codes
only. The production application does not depend on it, or on any GitHub URL,
at runtime — normalized records live in PostgreSQL. Importing this dataset
into the database is a separate, later step (a seed script), not part of the
project foundation.
