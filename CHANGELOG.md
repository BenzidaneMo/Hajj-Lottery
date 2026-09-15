# Changelog

Brief, step-by-step history of this project. See each domain's section in [README.md](README.md) for
current behavior, and `docs/*.md` for full detail — this file is a timeline, not documentation.

- **Step 01** — Project foundation. Placeholder routes only.
- **Step 02** — Application shell: layouts, routing, component library, i18n/RTL. Pages still placeholders.
- **Step 03** — Geographic reference data (69 wilayas, 1541 communes), seeded and served read-only.
- **Step 04** — Participant identity registry: one `Participant` per national ID, normalized and unique.
- **Step 05** — Administrator authentication: PostgreSQL-backed sessions, argon2id, HttpOnly cookie.
- **Step 06** — Role-based access control and geographic scoping (wilaya/commune) for administrators.
- **Step 07** — Citizen registration: single/paired applications, one per person per draw year.
- **Step 08** — Eligibility engine: a pure rule function with typed reason codes.
- **Step 09** — Participation history ledger and the consecutive non-winning streak calculation.
- **Step 10** — Priority/weight engine, frozen onto each application as a snapshot.
- **Step 11** — Annual draw configuration: `DrawYear` (national cycle) and `CommuneDraw` (spot allocation).
- **Step 12** — Draw pool validation and atomic freeze into an immutable, hashed snapshot.
- **Step 13** — The weighted lottery engine (CSPRNG sampling). No route yet — nothing records a draw ran.
- **Step 14** — Winner processing: one atomic transaction executes a locked commune's draw.
- **Step 15** — Audit trail and administrative governance (approval workflow for ledger corrections).
- **Step 16** — Legacy historical import: staged CSV/XLSX registers, approved, written in one transaction.
- **Step 17** — Public application status lookup and official results.
- **Step 18** — The public citizen portal: status, results, draw-status board, live draw visualiser.
- **Step 19** — Reserve winners and the replacement lifecycle (N winners + N reserves per draw).
- **Step 20** — Public reserve and withdrawn-winner UI on the official result pages.
- **Step 21** — The administrative operations console (`/admin`, built on shadcn/ui).
- **Step 22** — Citizen portal UI/UX overhaul: shared design system, registration as a wizard.
- **Step 23** — About page and footer (project description, developer attribution).
- **Step 24** — Visual theme, landing hero, code-split Framer Motion, `GET /api/public/stats`.
- **Step 25** — Minimum age + Mahram eligibility rules; admin theme cleanup; commune-draw pagination
  and optimistic-concurrency allocation editing; SUPER_ADMIN batch draw execution.
- **Step 26** — Structured participant identity: required Arabic/Latin name fields, required
  gender/phone, preparing for a future NIN-first identity lookup.
