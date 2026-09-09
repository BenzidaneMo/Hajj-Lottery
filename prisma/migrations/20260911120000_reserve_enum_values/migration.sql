-- Reserves and replacement, part one: the new values on existing enums.
--
-- Split from the tables and constraints that follow because PostgreSQL will not
-- let a value added by ALTER TYPE be *used* in the transaction that added it,
-- and Prisma runs each migration file in one transaction. Everything here only
-- widens a vocabulary; nothing reads one back.

-- A pooled application can now end the draw in three ways rather than two. A
-- reserve was neither selected nor passed over: it holds an ordered contingency
-- position, which is a different fact from both and must not be collapsed onto
-- NOT_SELECTED — that would tell a reserve they had lost.
ALTER TYPE "application_status" ADD VALUE 'RESERVE' BEFORE 'NOT_SELECTED';

-- The reserve lifecycle: the four decisions somebody actually takes. There is no
-- RESERVE_ACCEPTED, because accepting *is* being promoted, in one transaction —
-- a second action would describe the same act twice.
ALTER TYPE "audit_action" ADD VALUE 'WINNER_ABANDONED';
ALTER TYPE "audit_action" ADD VALUE 'RESERVE_CALLED';
ALTER TYPE "audit_action" ADD VALUE 'RESERVE_DECLINED';
ALTER TYPE "audit_action" ADD VALUE 'RESERVE_PROMOTED';

-- What those events are filed against. A winner and a reserve are addressable
-- things in their own right now: "which place was given up?" and "which
-- contingency position was called?" are questions the trail has to be able to
-- answer without naming a person.
ALTER TYPE "audit_target_type" ADD VALUE 'DRAW_WINNER';
ALTER TYPE "audit_target_type" ADD VALUE 'DRAW_RESERVE';
