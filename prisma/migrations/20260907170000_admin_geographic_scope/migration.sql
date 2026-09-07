-- AlterTable
ALTER TABLE "users" ADD COLUMN     "commune_id" TEXT,
ADD COLUMN     "wilaya_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "communes_id_wilaya_id_key" ON "communes"("id", "wilaya_id");

-- CreateIndex
CREATE INDEX "users_wilaya_id_idx" ON "users"("wilaya_id");

-- CreateIndex
CREATE INDEX "users_commune_id_idx" ON "users"("commune_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_wilaya_id_fkey" FOREIGN KEY ("wilaya_id") REFERENCES "wilayas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_commune_id_wilaya_id_fkey" FOREIGN KEY ("commune_id", "wilaya_id") REFERENCES "communes"("id", "wilaya_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Valid role/scope combinations, enforced by PostgreSQL rather than trusted
-- from application code:
--   SUPER_ADMIN    national  - no wilaya, no commune
--   WILAYA_ADMIN   one wilaya, no commune
--   COMMUNE_ADMIN  one commune inside that wilaya
-- The commune-belongs-to-wilaya half is enforced separately, by the composite
-- foreign key on (commune_id, wilaya_id) above.
ALTER TABLE "users" ADD CONSTRAINT "users_role_scope_check" CHECK (
  (role = 'SUPER_ADMIN'   AND wilaya_id IS NULL     AND commune_id IS NULL)
  OR (role = 'WILAYA_ADMIN'  AND wilaya_id IS NOT NULL AND commune_id IS NULL)
  OR (role = 'COMMUNE_ADMIN' AND wilaya_id IS NOT NULL AND commune_id IS NOT NULL)
);
