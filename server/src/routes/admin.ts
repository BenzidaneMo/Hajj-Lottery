import { AdminRole } from '@prisma/client'
import { Router } from 'express'

import {
  changeAdminScope,
  createAdmin,
  deactivateAdmin,
  listAdmins,
} from '../controllers/admin-account.controller.js'
import {
  getApplicationEligibility,
  getApplicationWeight,
} from '../controllers/admin-application.controller.js'
import { executeBatchDraw, validateBatchDraw } from '../controllers/admin-batch-draw.controller.js'
import {
  getApplication,
  getDashboard,
  listApplications,
  listParticipants,
} from '../controllers/admin-console.controller.js'
import {
  createCommuneDraw,
  createDrawYear,
  getCommuneDraw,
  getDrawYear,
  listCommuneDraws,
  listDrawYears,
  updateCommuneDraw,
  updateDrawYear,
} from '../controllers/admin-draw.controller.js'
import {
  freezePool,
  getPool,
  getPoolSummary,
  validatePool,
} from '../controllers/admin-draw-pool.controller.js'
import { executeDraw, getDrawResult, publishResult } from '../controllers/admin-draw-result.controller.js'
import { getCommune, getWilaya, listCommunes, listWilayas } from '../controllers/admin-geo.controller.js'
import {
  abandonWinner,
  acceptReserve,
  callReserve,
  declineReserve,
} from '../controllers/admin-reserve.controller.js'
import {
  approveRequest,
  cancelRequest,
  correctHistoryRecord,
  getApproval,
  listApprovals,
  listAuditLogs,
  rejectRequest,
  requestHistoricalCorrection,
} from '../controllers/admin-governance.controller.js'
import { getHistoryRecord, getParticipantHistory } from '../controllers/admin-history.controller.js'
import {
  approveImport,
  downloadImportSampleCsv,
  downloadImportSampleXlsx,
  executeImport,
  getImport,
  getImportSummary,
  listImportConflicts,
  listImportRows,
  listImports,
  rejectImport,
  uploadImport,
} from '../controllers/admin-import.controller.js'
import { asyncHandler } from '../middleware/error-handler.js'
import { requireAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { requireRole } from '../middleware/require-role.js'
import { acceptImportUpload } from '../middleware/upload.js'

export const adminRouter = Router()

// Identity for the whole admin surface. Role checks are added per route, and
// geographic scope is applied inside each query — never assumed here.
adminRouter.use(requireAuthenticatedUser)

// Any signed-in administrator may call these; what comes back is narrowed to
// their own territory, so no additional role gate is needed.
adminRouter.get('/wilayas', asyncHandler(listWilayas))
adminRouter.get('/wilayas/:id', asyncHandler(getWilaya))
adminRouter.get('/communes', asyncHandler(listCommunes))
adminRouter.get('/communes/:id', asyncHandler(getCommune))

// The console's operational summary. No role gate: the counts are computed
// inside the caller's own territory, and the national queues are withheld by
// the service rather than by hiding a link.
adminRouter.get('/dashboard', asyncHandler(getDashboard))

// The applications table. Scoped by the query, like everything else here —
// a filter in the query string can only ever narrow what the ceiling allows.
adminRouter.get('/applications', asyncHandler(listApplications))

// Same rule: no role gate, because every administrator reviews applications —
// but only the ones in their own territory, which the query enforces rather
// than this line.
adminRouter.get('/applications/:id/eligibility', asyncHandler(getApplicationEligibility))
// Inspection only: reading a weight never freezes one.
adminRouter.get('/applications/:id/weight', asyncHandler(getApplicationWeight))
adminRouter.get('/applications/:id', asyncHandler(getApplication))

// The national identity registry. SUPER_ADMIN-only, because a participant
// belongs to no commune and there is therefore no scope that could narrow it —
// a scoped administrator reaches a person through their own commune's
// applications or ledger, where their territory is part of the query.
adminRouter.get('/participants', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(listParticipants))

// The participation ledger. Both are scoped by the *record's* commune, not by
// the participant — see the controller for why a participant id is not
// something that can be authorized.
adminRouter.get('/participants/:id/history', asyncHandler(getParticipantHistory))
adminRouter.get('/history/:id', asyncHandler(getHistoryRecord))

// Draw configuration. Reading is for every administrator, narrowed to their
// own territory by the query; changing it is national work, so the mutations
// carry an explicit role gate rather than relying on scope to be restrictive
// enough — a COMMUNE_ADMIN allocating their own commune's pilgrimage places is
// precisely the conflict of interest the roles exist to prevent.
adminRouter.get('/draw-years', asyncHandler(listDrawYears))
adminRouter.get('/draw-years/:year', asyncHandler(getDrawYear))
adminRouter.post('/draw-years', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(createDrawYear))
adminRouter.patch('/draw-years/:id', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(updateDrawYear))

adminRouter.get('/commune-draws', asyncHandler(listCommuneDraws))
// Registered ahead of `/commune-draws/:id` for the same reason as the import
// template routes above: "batch" would otherwise be swallowed by `:id`.
// SUPER_ADMIN-only, like executing one commune's own draw — running every
// ready one in a year is the same authority, not a wider one.
adminRouter.post(
  '/commune-draws/batch/validate',
  requireRole(AdminRole.SUPER_ADMIN),
  asyncHandler(validateBatchDraw),
)
adminRouter.post(
  '/commune-draws/batch/execute',
  requireRole(AdminRole.SUPER_ADMIN),
  asyncHandler(executeBatchDraw),
)
adminRouter.get('/commune-draws/:id', asyncHandler(getCommuneDraw))
adminRouter.post('/commune-draws', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(createCommuneDraw))
adminRouter.patch('/commune-draws/:id', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(updateCommuneDraw))

// The draw pool. Inspecting and dry-running are scoped but unrestricted by
// role — seeing why your own commune cannot be frozen is not privileged.
// Freezing is national: it fixes the terms of a lottery permanently, and
// nobody should be able to close the input to a draw they are subject to.
adminRouter.post('/commune-draws/:id/validate-pool', asyncHandler(validatePool))
adminRouter.post(
  '/commune-draws/:id/freeze-pool',
  requireRole(AdminRole.SUPER_ADMIN),
  asyncHandler(freezePool),
)
adminRouter.get('/commune-draws/:id/pool', asyncHandler(getPool))
adminRouter.get('/commune-draws/:id/pool/summary', asyncHandler(getPoolSummary))

// Running the lottery. National, because it is irreversible and it excludes the
// people it selects from every future draw — nobody should be able to run a draw
// they are themselves subject to. Reading the result afterwards is ordinary
// scoped administrative work, so it carries no role gate.
adminRouter.post('/commune-draws/:id/execute', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(executeDraw))
adminRouter.get('/commune-draws/:id/result', asyncHandler(getDrawResult))

// Releasing a result to the public. National, and separate from executing the
// draw: a result exists the moment the lottery concludes, and turning that into
// an announcement is a decision somebody has to make and be recorded making.
// Scoped administrators read their own results and cannot publish them — nobody
// should be able to announce the draw they are themselves subject to.
adminRouter.post(
  '/commune-draws/:id/publish-result',
  requireRole(AdminRole.SUPER_ADMIN),
  asyncHandler(publishResult),
)

// The reserve lifecycle — the only part of a concluded draw that still moves.
// All four are national, for the same reason executing and publishing are: each
// either takes a place from the person holding it or gives one to somebody else,
// and nobody should be able to do either to a draw they are subject to. Scoped
// administrators see their commune's winners and reserves on the result route
// above, which is the whole of their authority here.
//
// Abandoning and calling are deliberately two requests. One person records that
// a place was given up; another offers it to the next reserve. A single endpoint
// doing both would leave a trail that could not say who decided what.
//
// The reserve position in the path is a confirmation, never a choice: the
// service refuses anything but the next waiting reserve, because the order came
// from the lottery and picking within it would be picking a winner.
adminRouter.post(
  '/commune-draws/:id/winners/:selectionOrder/abandon',
  requireRole(AdminRole.SUPER_ADMIN),
  asyncHandler(abandonWinner),
)
adminRouter.post(
  '/commune-draws/:id/reserves/:reservePosition/call',
  requireRole(AdminRole.SUPER_ADMIN),
  asyncHandler(callReserve),
)
adminRouter.post(
  '/commune-draws/:id/reserves/:reservePosition/accept',
  requireRole(AdminRole.SUPER_ADMIN),
  asyncHandler(acceptReserve),
)
adminRouter.post(
  '/commune-draws/:id/reserves/:reservePosition/decline',
  requireRole(AdminRole.SUPER_ADMIN),
  asyncHandler(declineReserve),
)

// The audit trail. No role gate: what an administrator sees is narrowed to
// their own territory by the query, and — unlike everywhere else — national
// events with no territory are withheld from scoped administrators rather than
// shown to everyone. There is no route that writes, edits or deletes a record
// here, and there must never be one.
adminRouter.get('/audit-logs', asyncHandler(listAuditLogs))

// Governance. A scoped administrator who believes a historical record is wrong
// may ask for it to be changed; deciding is somebody else's job, and the
// database refuses to let it be their own. A SUPER_ADMIN corrects directly,
// because requiring a second approver when there may be only one of them would
// mean nothing could ever be fixed — their correction still carries a reason and
// is still audited.
adminRouter.post('/history/:id/correction-requests', asyncHandler(requestHistoricalCorrection))
adminRouter.patch('/history/:id', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(correctHistoryRecord))

// The legacy import. Uploading and reviewing are ordinary scoped work — the
// people who hold a commune's paper registers are the people who can read them —
// and what a scoped administrator's file may say is limited to their own
// territory, per row, by validation rather than by this line.
//
// Approving, refusing and executing are national and SUPER_ADMIN-only, because
// an import grants lifetime priority and imposes lifetime exclusion across
// communes. Nobody reviews the import they uploaded: checked in the service, and
// again by a CHECK constraint.
adminRouter.post('/imports', acceptImportUpload, asyncHandler(uploadImport))
adminRouter.get('/imports', asyncHandler(listImports))
// Registered ahead of `/imports/:id` — Express matches route patterns in
// registration order, and "template.csv"/"template.xlsx" would otherwise be
// swallowed by the `:id` param. Session-auth only, like every other read
// here: the template carries no data, just the column names every upload
// must use.
adminRouter.get('/imports/template.csv', asyncHandler(downloadImportSampleCsv))
adminRouter.get('/imports/template.xlsx', asyncHandler(downloadImportSampleXlsx))
adminRouter.get('/imports/:id', asyncHandler(getImport))
adminRouter.get('/imports/:id/summary', asyncHandler(getImportSummary))
adminRouter.get('/imports/:id/rows', asyncHandler(listImportRows))
adminRouter.get('/imports/:id/conflicts', asyncHandler(listImportConflicts))
adminRouter.post('/imports/:id/approve', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(approveImport))
adminRouter.post('/imports/:id/reject', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(rejectImport))
adminRouter.post('/imports/:id/execute', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(executeImport))

adminRouter.get('/approvals', asyncHandler(listApprovals))
adminRouter.get('/approvals/:id', asyncHandler(getApproval))
adminRouter.post('/approvals/:id/approve', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(approveRequest))
adminRouter.post('/approvals/:id/reject', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(rejectRequest))
// Withdrawing is not a decision, so it needs no elevated role — only authorship,
// which the service checks.
adminRouter.post('/approvals/:id/cancel', asyncHandler(cancelRequest))

// Administrator accounts. SUPER_ADMIN-only and unscoped, deliberately: an
// administrator's authority is not a property of a territory even when it names
// one, and a scoped list would tell a WILAYA_ADMIN who can overrule them while
// hiding everyone else who can. The rules that matter — no self-editing, no
// granting reach you do not hold, no removing the last way in — live in the
// service, so no route here can skip them.
//
// There is no DELETE: an account is the actor on audit records that must outlive
// it. Deactivating is the operation, and it revokes the sessions too.
adminRouter.get('/admins', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(listAdmins))
adminRouter.post('/admins', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(createAdmin))
adminRouter.patch('/admins/:id/scope', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(changeAdminScope))
adminRouter.post('/admins/:id/deactivate', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(deactivateAdmin))
