-- Eligibility verdicts join the intake state on the application lifecycle.
--
-- Added rather than replaced: PENDING remains the state of a row that has not
-- been evaluated, and is still the column default, so nothing already stored
-- has to be rewritten.
--
-- PostgreSQL 12+ allows ALTER TYPE ... ADD VALUE inside a transaction as long
-- as the new value is not used in that same transaction. This migration only
-- declares them; the first write of ELIGIBLE happens later, from application
-- code.
ALTER TYPE "application_status" ADD VALUE IF NOT EXISTS 'ELIGIBLE';
ALTER TYPE "application_status" ADD VALUE IF NOT EXISTS 'INELIGIBLE';
