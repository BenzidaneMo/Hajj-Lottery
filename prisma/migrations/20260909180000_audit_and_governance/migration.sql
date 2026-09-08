-- The audit trail and the approval framework.
--
-- Audit rows are not application data. Application data says what is true now
-- and changes when the truth changes; an audit row says what somebody did, which
-- never stops being what they did. So the protection here is append-only at the
-- database, not merely an absent endpoint: an audit trail an administrator can
-- edit is not an audit trail, and the administrators are exactly the people it
-- exists to hold to account.

CREATE TYPE "audit_action" AS ENUM (
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILURE',
  'AUTH_LOGOUT',
  'ADMIN_CREATED',
  'ADMIN_DISABLED',
  'ADMIN_SCOPE_CHANGED',
  'DRAW_YEAR_CREATED',
  'DRAW_YEAR_STATUS_CHANGED',
  'COMMUNE_DRAW_CREATED',
  'COMMUNE_DRAW_UPDATED',
  'DRAW_POOL_FROZEN',
  'COMMUNE_DRAW_EXECUTED',
  'HISTORICAL_RECORD_CORRECTED',
  'APPROVAL_CREATED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'APPROVAL_CANCELLED'
);

CREATE TYPE "audit_target_type" AS ENUM (
  'USER',
  'DRAW_YEAR',
  'COMMUNE_DRAW',
  'DRAW_POOL',
  'DRAW_RESULT',
  'PARTICIPATION_HISTORY',
  'APPROVAL_REQUEST'
);

CREATE TYPE "approval_type" AS ENUM ('HISTORICAL_RECORD_CORRECTION');

CREATE TYPE "approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" "audit_action" NOT NULL,
    "actor_user_id" TEXT,
    "target_type" "audit_target_type" NOT NULL,
    "target_id" TEXT,
    "wilaya_id" TEXT,
    "commune_id" TEXT,
    "reason" TEXT,
    "before_data" JSONB,
    "after_data" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "type" "approval_type" NOT NULL,
    "status" "approval_status" NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" TEXT NOT NULL,
    "reviewed_by_user_id" TEXT,
    "target_type" "audit_target_type" NOT NULL,
    "target_id" TEXT NOT NULL,
    "wilaya_id" TEXT,
    "commune_id" TEXT,
    "requested_change" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "review_reason" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- Indexed for the queries the audit API actually offers: a timeline, and that
-- timeline narrowed by actor, action or territory. No speculative indexes.
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");
CREATE INDEX "audit_logs_wilaya_id_created_at_idx" ON "audit_logs"("wilaya_id", "created_at");
CREATE INDEX "audit_logs_commune_id_created_at_idx" ON "audit_logs"("commune_id", "created_at");
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

CREATE INDEX "approval_requests_status_created_at_idx" ON "approval_requests"("status", "created_at");
CREATE INDEX "approval_requests_requested_by_user_id_created_at_idx" ON "approval_requests"("requested_by_user_id", "created_at");
CREATE INDEX "approval_requests_wilaya_id_created_at_idx" ON "approval_requests"("wilaya_id", "created_at");
CREATE INDEX "approval_requests_commune_id_created_at_idx" ON "approval_requests"("commune_id", "created_at");
CREATE INDEX "approval_requests_target_type_target_id_idx" ON "approval_requests"("target_type", "target_id");

-- RESTRICT throughout, and nothing cascades: an audit record must not disappear
-- because somebody deleted the administrator, wilaya or commune it names.
--
-- `target_id` is deliberately *not* a foreign key. An audit row has to outlive
-- whatever it describes, and eight nullable references — one per kind of target —
-- would make the trail's durability depend on nothing ever being removed. The
-- typed `target_type` keeps the untyped id interpretable.
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_wilaya_id_fkey" FOREIGN KEY ("wilaya_id") REFERENCES "wilayas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_wilaya_id_fkey" FOREIGN KEY ("wilaya_id") REFERENCES "wilayas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A reason that is present must say something. Whitespace is not a justification.
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_reason_check" CHECK (
  "reason" IS NULL OR length(btrim("reason")) > 0
);

ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reason_check" CHECK (
  length(btrim("reason")) > 0 AND ("review_reason" IS NULL OR length(btrim("review_reason")) > 0)
);

-- **Separation of duties, as a constraint rather than a rule in a service that a
-- later refactor could quietly drop.** Nobody reviews their own request.
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_no_self_review_check" CHECK (
  "reviewed_by_user_id" IS NULL OR "reviewed_by_user_id" <> "requested_by_user_id"
);

-- A decision is a reviewer plus a moment. A pending request has neither; an
-- approval or rejection has both; a cancellation has a moment but no reviewer,
-- because only the requester may withdraw their own request and recording them
-- as its reviewer would make every cancellation look like a self-approval.
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decision_check" CHECK (
  ("status" = 'PENDING' AND "reviewed_by_user_id" IS NULL AND "reviewed_at" IS NULL)
  OR ("status" = 'CANCELLED' AND "reviewed_by_user_id" IS NULL AND "reviewed_at" IS NOT NULL)
  OR ("status" IN ('APPROVED', 'REJECTED') AND "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
);

-- Append-only, enforced by the database.
--
-- There is no audit editing endpoint and no audit deletion endpoint, but their
-- absence is not the guarantee: this is. An UPDATE or DELETE raises, whoever
-- issues it and whatever code path added it, including one written years from
-- now by somebody who did not read this file.
--
-- TRUNCATE does not fire row-level triggers, so the test suite can still reset.
CREATE OR REPLACE FUNCTION reject_audit_log_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit records are append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();

-- An approval request is immutable in two halves.
--
-- The request itself — who asked, for what, why, and when — cannot be rewritten
-- from the moment it is made. The decision cannot be rewritten from the moment it
-- is taken, so there is no path from APPROVED to REJECTED or back: a changed mind
-- is a new request, which leaves the original decision legible instead of
-- replacing it. Deletion is refused outright.
CREATE OR REPLACE FUNCTION reject_approval_request_rewrite() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval requests are historical records and cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'a reviewed approval request cannot be changed; raise a new request instead'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."type" <> OLD."type"
     OR NEW."requested_by_user_id" <> OLD."requested_by_user_id"
     OR NEW."target_type" <> OLD."target_type"
     OR NEW."target_id" <> OLD."target_id"
     OR NEW."requested_change"::text <> OLD."requested_change"::text
     OR NEW."reason" <> OLD."reason"
     OR NEW."created_at" <> OLD."created_at"
     OR NEW."wilaya_id" IS DISTINCT FROM OLD."wilaya_id"
     OR NEW."commune_id" IS DISTINCT FROM OLD."commune_id" THEN
    RAISE EXCEPTION 'the request an approval was raised for cannot be rewritten'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER approval_requests_append_oriented
  BEFORE UPDATE OR DELETE ON "approval_requests"
  FOR EACH ROW EXECUTE FUNCTION reject_approval_request_rewrite();
