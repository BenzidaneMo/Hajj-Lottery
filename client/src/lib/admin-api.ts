import type {
  AdminApplicationDetailDto,
  AdminApplicationPageDto,
  AdminDashboardDto,
  AdminParticipantPageDto,
  AdminRole,
  AdminUserDto,
  ApplicationEligibilityDto,
  ApplicationStatus,
  ApplicationWeightDto,
  BatchExecutionResultDto,
  BatchValidationDto,
  ApprovalRequestDto,
  ApprovalStatus,
  AuditAction,
  AuditLogPageDto,
  AuditTargetType,
  CommuneDrawDto,
  CommuneDrawPageDto,
  CommuneDrawStatus,
  DrawPoolSummaryDto,
  DrawResultDto,
  DrawYearDto,
  DrawYearStatus,
  EntryType,
  ImportBatchDto,
  ImportBatchStatus,
  ImportExecutionDto,
  ImportRowPageDto,
  ImportRowStatus,
  ImportSummaryDto,
  ParticipantHistoryDto,
  PoolValidationDto,
  ResultPublicationDto,
  AbandonmentReason,
} from '@hajj-lottery/shared'

import { apiGet, apiPatch, apiPost, apiUpload, queryString } from './api'

/**
 * Every administrative call the console makes, in one place and typed against
 * the shared DTOs.
 *
 * Two things this file is deliberately not. It is not a place where domain
 * rules live — no eligibility, no weighting, no ordering, no decision about
 * who may call what; the server settles all of that and the console shows the
 * answer. And it is not a cache: each function is a request, so a screen that
 * needs fresher data asks again rather than reasoning about staleness.
 */

// --- Dashboard ---------------------------------------------------------------

export function fetchDashboard(): Promise<AdminDashboardDto> {
  return apiGet<AdminDashboardDto>('/api/admin/dashboard')
}

// --- Applications ------------------------------------------------------------

export interface ApplicationQuery {
  drawYear?: number
  wilayaId?: string
  communeId?: string
  status?: ApplicationStatus
  entryType?: EntryType
  applicationReference?: string
  page?: number
  pageSize?: number
}

export function fetchApplications(query: ApplicationQuery): Promise<AdminApplicationPageDto> {
  return apiGet<AdminApplicationPageDto>(`/api/admin/applications${queryString({ ...query })}`)
}

export function fetchApplication(id: string): Promise<AdminApplicationDetailDto> {
  return apiGet<AdminApplicationDetailDto>(`/api/admin/applications/${encodeURIComponent(id)}`)
}

export function fetchApplicationEligibility(id: string): Promise<ApplicationEligibilityDto> {
  return apiGet<ApplicationEligibilityDto>(`/api/admin/applications/${encodeURIComponent(id)}/eligibility`)
}

export function fetchApplicationWeight(id: string): Promise<ApplicationWeightDto> {
  return apiGet<ApplicationWeightDto>(`/api/admin/applications/${encodeURIComponent(id)}/weight`)
}

// --- Participants ------------------------------------------------------------

export interface ParticipantQuery {
  name?: string
  nationalId?: string
  hasWonHajj?: boolean
  page?: number
  pageSize?: number
}

/**
 * The national registry. A national ID is sent in the request body's place —
 * the query string — only because the endpoint is a GET; it never reaches a
 * route path, a browser history entry the app writes, or a stored filter.
 */
export function fetchParticipants(query: ParticipantQuery): Promise<AdminParticipantPageDto> {
  return apiGet<AdminParticipantPageDto>(`/api/admin/participants${queryString({ ...query })}`)
}

export function fetchParticipantHistory(participantId: string): Promise<ParticipantHistoryDto> {
  return apiGet<ParticipantHistoryDto>(`/api/admin/participants/${encodeURIComponent(participantId)}/history`)
}

export interface HistoryCorrection {
  participated?: boolean
  won?: boolean
  verified?: boolean
  reason: string
}

/** A scoped administrator's route: asks, and somebody else decides. */
export function requestHistoryCorrection(
  historyId: string,
  change: HistoryCorrection,
): Promise<ApprovalRequestDto> {
  return apiPost<ApprovalRequestDto>(
    `/api/admin/history/${encodeURIComponent(historyId)}/correction-requests`,
    change,
  )
}

/** A SUPER_ADMIN's route: corrects directly, still with a reason, still audited. */
export function correctHistory(historyId: string, change: HistoryCorrection): Promise<unknown> {
  return apiPatch<unknown>(`/api/admin/history/${encodeURIComponent(historyId)}`, change)
}

// --- Draw years --------------------------------------------------------------

export function fetchDrawYears(): Promise<DrawYearDto[]> {
  return apiGet<DrawYearDto[]>('/api/admin/draw-years')
}

export function createDrawYear(year: number): Promise<DrawYearDto> {
  return apiPost<DrawYearDto>('/api/admin/draw-years', { year })
}

export function updateDrawYearStatus(id: string, status: DrawYearStatus): Promise<DrawYearDto> {
  return apiPatch<DrawYearDto>(`/api/admin/draw-years/${encodeURIComponent(id)}`, { status })
}

// --- Commune draws -----------------------------------------------------------

export function fetchCommuneDraws(query: {
  drawYearId?: string
  communeId?: string
  wilayaId?: string
  status?: CommuneDrawStatus
  page?: number
  pageSize?: number
}): Promise<CommuneDrawPageDto> {
  return apiGet<CommuneDrawPageDto>(`/api/admin/commune-draws${queryString({ ...query })}`)
}

export function fetchCommuneDraw(id: string): Promise<CommuneDrawDto> {
  return apiGet<CommuneDrawDto>(`/api/admin/commune-draws/${encodeURIComponent(id)}`)
}

export function createCommuneDraw(input: {
  drawYearId: string
  communeId: string
  allocatedSpots: number
}): Promise<CommuneDrawDto> {
  return apiPost<CommuneDrawDto>('/api/admin/commune-draws', input)
}

export function updateCommuneDraw(
  id: string,
  change: { allocatedSpots?: number; status?: CommuneDrawStatus; expectedUpdatedAt?: string },
): Promise<CommuneDrawDto> {
  return apiPatch<CommuneDrawDto>(`/api/admin/commune-draws/${encodeURIComponent(id)}`, change)
}

/**
 * A preview only — nothing runs. `executeBatchDraws` must be sent exactly
 * the `ready` ids this returns, never a freshly recomputed set.
 */
export function validateBatchDraws(drawYearId: string): Promise<BatchValidationDto> {
  return apiPost<BatchValidationDto>('/api/admin/commune-draws/batch/validate', { drawYearId })
}

export function executeBatchDraws(
  drawYearId: string,
  communeDrawIds: string[],
): Promise<BatchExecutionResultDto> {
  return apiPost<BatchExecutionResultDto>('/api/admin/commune-draws/batch/execute', {
    drawYearId,
    communeDrawIds,
  })
}

// --- Pool, execution, publication --------------------------------------------

/** A dry run. Writes nothing, and reports every blocker rather than the first. */
export function validatePool(communeDrawId: string): Promise<PoolValidationDto> {
  return apiPost<PoolValidationDto>(
    `/api/admin/commune-draws/${encodeURIComponent(communeDrawId)}/validate-pool`,
  )
}

export function freezePool(communeDrawId: string): Promise<DrawPoolSummaryDto> {
  return apiPost<DrawPoolSummaryDto>(
    `/api/admin/commune-draws/${encodeURIComponent(communeDrawId)}/freeze-pool`,
  )
}

export function fetchPoolSummary(communeDrawId: string): Promise<DrawPoolSummaryDto> {
  return apiGet<DrawPoolSummaryDto>(
    `/api/admin/commune-draws/${encodeURIComponent(communeDrawId)}/pool/summary`,
  )
}

/**
 * Runs the lottery. Sends no body at all — not a winner count, not a seed, not
 * an algorithm version. The server ignores one anyway; sending none makes it
 * plain that nothing here influences the outcome.
 */
export function executeDraw(communeDrawId: string): Promise<DrawResultDto> {
  return apiPost<DrawResultDto>(`/api/admin/commune-draws/${encodeURIComponent(communeDrawId)}/execute`)
}

export function fetchDrawResult(communeDrawId: string): Promise<DrawResultDto> {
  return apiGet<DrawResultDto>(`/api/admin/commune-draws/${encodeURIComponent(communeDrawId)}/result`)
}

export function publishResult(communeDrawId: string): Promise<ResultPublicationDto> {
  return apiPost<ResultPublicationDto>(
    `/api/admin/commune-draws/${encodeURIComponent(communeDrawId)}/publish-result`,
  )
}

// --- Winner abandonment and the reserve lifecycle ----------------------------

export function abandonWinner(
  communeDrawId: string,
  selectionOrder: number,
  body: { reason: AbandonmentReason; explanation: string },
): Promise<DrawResultDto> {
  return apiPost<DrawResultDto>(
    `/api/admin/commune-draws/${encodeURIComponent(communeDrawId)}/winners/${selectionOrder}/abandon`,
    body,
  )
}

/**
 * Offers a vacated place to the next reserve.
 *
 * `reservePosition` is not a choice. The caller passes the position the server
 * already reported as next, and the server refuses any other — the order came
 * from the lottery, and picking within it would be picking a winner.
 */
export function callReserve(
  communeDrawId: string,
  reservePosition: number,
  winnerSelectionOrder: number,
): Promise<DrawResultDto> {
  return apiPost<DrawResultDto>(
    `/api/admin/commune-draws/${encodeURIComponent(communeDrawId)}/reserves/${reservePosition}/call`,
    { winnerSelectionOrder },
  )
}

export function acceptReserve(communeDrawId: string, reservePosition: number): Promise<DrawResultDto> {
  return apiPost<DrawResultDto>(
    `/api/admin/commune-draws/${encodeURIComponent(communeDrawId)}/reserves/${reservePosition}/accept`,
  )
}

export function declineReserve(
  communeDrawId: string,
  reservePosition: number,
  explanation: string,
): Promise<DrawResultDto> {
  return apiPost<DrawResultDto>(
    `/api/admin/commune-draws/${encodeURIComponent(communeDrawId)}/reserves/${reservePosition}/decline`,
    { explanation },
  )
}

// --- Legacy import -----------------------------------------------------------

export function fetchImports(status?: ImportBatchStatus): Promise<{ items: ImportBatchDto[] }> {
  return apiGet<{ items: ImportBatchDto[] }>(`/api/admin/imports${queryString({ status })}`)
}

export function uploadImport(file: File): Promise<ImportBatchDto> {
  return apiUpload<ImportBatchDto>('/api/admin/imports', 'file', file)
}

export function fetchImportSummary(id: string): Promise<ImportSummaryDto> {
  return apiGet<ImportSummaryDto>(`/api/admin/imports/${encodeURIComponent(id)}/summary`)
}

export function fetchImportRows(
  id: string,
  query: { status?: ImportRowStatus; page?: number; pageSize?: number },
): Promise<ImportRowPageDto> {
  return apiGet<ImportRowPageDto>(
    `/api/admin/imports/${encodeURIComponent(id)}/rows${queryString({ ...query })}`,
  )
}

export function fetchImportConflicts(
  id: string,
  query: { page?: number; pageSize?: number },
): Promise<ImportRowPageDto> {
  return apiGet<ImportRowPageDto>(
    `/api/admin/imports/${encodeURIComponent(id)}/conflicts${queryString({ ...query })}`,
  )
}

export function approveImport(id: string, reason: string): Promise<ImportBatchDto> {
  return apiPost<ImportBatchDto>(`/api/admin/imports/${encodeURIComponent(id)}/approve`, { reason })
}

export function rejectImport(id: string, reason: string): Promise<ImportBatchDto> {
  return apiPost<ImportBatchDto>(`/api/admin/imports/${encodeURIComponent(id)}/reject`, { reason })
}

export function executeImport(id: string): Promise<ImportExecutionDto> {
  return apiPost<ImportExecutionDto>(`/api/admin/imports/${encodeURIComponent(id)}/execute`)
}

// --- Approvals ---------------------------------------------------------------

export function fetchApprovals(status?: ApprovalStatus): Promise<{ items: ApprovalRequestDto[] }> {
  return apiGet<{ items: ApprovalRequestDto[] }>(`/api/admin/approvals${queryString({ status })}`)
}

export function approveRequest(id: string, reason: string): Promise<ApprovalRequestDto> {
  return apiPost<ApprovalRequestDto>(`/api/admin/approvals/${encodeURIComponent(id)}/approve`, { reason })
}

export function rejectRequest(id: string, reason: string): Promise<ApprovalRequestDto> {
  return apiPost<ApprovalRequestDto>(`/api/admin/approvals/${encodeURIComponent(id)}/reject`, { reason })
}

export function cancelRequest(id: string, reason: string): Promise<ApprovalRequestDto> {
  return apiPost<ApprovalRequestDto>(`/api/admin/approvals/${encodeURIComponent(id)}/cancel`, { reason })
}

// --- Audit -------------------------------------------------------------------

export interface AuditQuery {
  action?: AuditAction
  actorUserId?: string
  targetType?: AuditTargetType
  targetId?: string
  wilayaId?: string
  communeId?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export function fetchAuditLogs(query: AuditQuery): Promise<AuditLogPageDto> {
  return apiGet<AuditLogPageDto>(`/api/admin/audit-logs${queryString({ ...query })}`)
}

// --- Administrator accounts --------------------------------------------------

export function fetchAdmins(): Promise<{ items: AdminUserDto[] }> {
  return apiGet<{ items: AdminUserDto[] }>('/api/admin/admins')
}

export interface NewAdminInput {
  username: string
  password: string
  role: AdminRole
  wilayaId?: string | null
  communeId?: string | null
}

export function createAdminAccount(input: NewAdminInput): Promise<AdminUserDto> {
  return apiPost<AdminUserDto>('/api/admin/admins', input)
}

export function changeAdminScope(
  id: string,
  input: { role: AdminRole; wilayaId?: string | null; communeId?: string | null; reason: string },
): Promise<AdminUserDto> {
  return apiPatch<AdminUserDto>(`/api/admin/admins/${encodeURIComponent(id)}/scope`, input)
}

export function deactivateAdminAccount(id: string, reason: string): Promise<AdminUserDto> {
  return apiPost<AdminUserDto>(`/api/admin/admins/${encodeURIComponent(id)}/deactivate`, { reason })
}
