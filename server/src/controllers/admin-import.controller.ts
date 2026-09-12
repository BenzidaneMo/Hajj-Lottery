import type {
  ImportBatchDto,
  ImportBatchStatus,
  ImportIssueDto,
  ImportRowDto,
  ImportRowPageDto,
  ImportSourceFormat,
  ImportSummaryDto,
} from '@hajj-lottery/shared'
import type { ImportBatch, ImportRow, User } from '@prisma/client'
import type { Request, RequestHandler } from 'express'

import { BadRequestError, NotFoundError } from '../lib/errors.js'
import { buildSampleCsv, buildSampleWorkbook } from '../lib/import-sample.js'
import { storedIssues } from '../services/legacy-import.service.js'
import { neutralizeOptional, neutralizeSpreadsheetText } from '../lib/spreadsheet-safety.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { auditActor } from '../services/audit.service.js'
import { authorizationService } from '../services/authorization.service.js'
import { legacyImportService, type ImportBatchWithUsers } from '../services/legacy-import.service.js'
import { prisma } from '../lib/prisma.js'
import { importDecisionSchema, importListQuerySchema, importRowQuerySchema } from '../validation/import.js'

/**
 * The legacy import, over HTTP.
 *
 * Two rules shape every handler. Reads are reached through
 * `AuthorizationService`, so a batch that touches nothing in the caller's
 * territory is *not found* rather than forbidden — the same answer an id that was
 * never issued gets, so nobody can discover whether another commune has imported
 * anything by probing. And nothing an administrator sends decides anything except
 * which file to read and whether to accept it: the uploader is the session's
 * user, the territory is their stored scope, and the batch's status comes from
 * which endpoint was called.
 *
 * Values that came out of a spreadsheet are neutralised on the way back out. A
 * name reading `=HYPERLINK(...)` is stored exactly as the register had it —
 * that is the evidence a reviewer is judging — and rendered inert, so no
 * downstream export turns a review screen into a formula.
 */

/**
 * POST /api/admin/imports — upload a register.
 *
 * Open to every administrator, because preparing a commune's own history is
 * ordinary work for the people who hold it. What their role decides is *reach*:
 * a scoped administrator's file may only name their own territory, and rows that
 * go further are refused per row so the overreach is visible rather than silent.
 * Nothing here writes anything authoritative — see the service.
 */
export const uploadImport: RequestHandler = async (req, res) => {
  const file = uploadedFile(req)
  const user = getAuthenticatedUser(req)

  const batch = await legacyImportService.upload(user, auditActor(user), {
    filename: file.originalname,
    contentType: file.mimetype,
    bytes: file.buffer,
  })

  res.status(201).json(toBatchDto(batch, await rowCount(batch.id)))
}

/**
 * GET /api/admin/imports/template.csv and template.xlsx
 *
 * A downloadable, always-current template — generated from the same column
 * constants the validator enforces, never a static file that could drift from
 * them. `Content-Disposition` is what actually triggers a save dialog here:
 * the client and API are different origins in every environment, and a plain
 * anchor's `download` attribute is ignored by browsers for cross-origin URLs.
 */
export const downloadImportSampleCsv: RequestHandler = (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="hajj-lottery-import-sample.csv"')
  res.send(buildSampleCsv())
}

export const downloadImportSampleXlsx: RequestHandler = async (_req, res) => {
  const workbook = await buildSampleWorkbook()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="hajj-lottery-import-sample.xlsx"')
  res.send(workbook)
}

/** GET /api/admin/imports — batches touching the caller's territory, newest first. */
export const listImports: RequestHandler = async (req, res) => {
  const parsed = importListQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'Invalid import query', parsed.error.flatten())
  }

  const user = getAuthenticatedUser(req)
  const batches = await authorizationService.listImportBatches(user, parsed.data)

  const items = await Promise.all(
    batches.map(async (batch) =>
      toBatchDto(batch, await rowCount(batch.id, authorizationService.importRowScope(user, batch))),
    ),
  )

  res.json({ items })
}

/** GET /api/admin/imports/:id */
export const getImport: RequestHandler = async (req, res) => {
  const user = getAuthenticatedUser(req)
  const batch = await scopedBatch(req)

  res.json(toBatchDto(batch, await rowCount(batch.id, authorizationService.importRowScope(user, batch))))
}

/**
 * GET /api/admin/imports/:id/summary — what the batch would do.
 *
 * Counted over the rows this caller may see, which is why it is computed rather
 * than stored: one set of numbers for everybody would either tell a COMMUNE_ADMIN
 * the size of the national import or tell the national administrator nothing.
 */
export const getImportSummary: RequestHandler = async (req, res) => {
  const user = getAuthenticatedUser(req)
  const batch = await scopedBatch(req)

  const counts = await legacyImportService.summarize(
    batch.id,
    authorizationService.importRowScope(user, batch),
  )

  const summary: ImportSummaryDto = { batch: toBatchDto(batch, counts.rows), ...counts }
  res.json(summary)
}

/** GET /api/admin/imports/:id/rows — the staged rows, paged and scoped. */
export const listImportRows: RequestHandler = async (req, res) => {
  res.json(await rowPage(req))
}

/**
 * GET /api/admin/imports/:id/conflicts — only what blocks.
 *
 * A separate endpoint rather than a query parameter on the row list, because it
 * is the screen an administrator actually works from: everything that has to be
 * resolved before this register can become history, and nothing else.
 */
export const listImportConflicts: RequestHandler = async (req, res) => {
  const conflicts = await rowPage(req, 'CONFLICT')
  const invalid = await rowPage(req, 'INVALID')

  res.json({
    items: [...conflicts.items, ...invalid.items].sort((a, b) => a.rowNumber - b.rowNumber),
    total: conflicts.total + invalid.total,
    page: conflicts.page,
    pageSize: conflicts.pageSize,
    totalPages: Math.max(conflicts.totalPages, invalid.totalPages),
  })
}

/**
 * POST /api/admin/imports/:id/approve — SUPER_ADMIN, and never the uploader.
 *
 * The batch is reached unscoped here on purpose: approval is a national decision
 * about a national object, and a SUPER_ADMIN reaches every batch anyway. The
 * separation of duties is the constraint that matters, and it is checked in the
 * service and again by the database.
 */
export const approveImport: RequestHandler = async (req, res) => {
  const user = getAuthenticatedUser(req)
  const { batch, uploader } = await batchAndUploader(req)

  const approved = await legacyImportService.approve(
    auditActor(user),
    uploader,
    batch.id,
    decisionReason(req),
  )

  res.json(toBatchDto(approved, await rowCount(approved.id)))
}

/** POST /api/admin/imports/:id/reject — SUPER_ADMIN. Permanent; a fix is a new upload. */
export const rejectImport: RequestHandler = async (req, res) => {
  const user = getAuthenticatedUser(req)
  const { batch, uploader } = await batchAndUploader(req)

  const rejected = await legacyImportService.reject(auditActor(user), uploader, batch.id, decisionReason(req))

  res.json(toBatchDto(rejected, await rowCount(rejected.id)))
}

/**
 * POST /api/admin/imports/:id/execute — SUPER_ADMIN.
 *
 * The body is ignored entirely. There is nothing a client could usefully say
 * here: which rows to write, whether to skip conflicts, what to mark verified —
 * every one of those is a decision the batch already carries, and accepting any
 * of them from a request would make the approval mean something different from
 * what was approved.
 */
export const executeImport: RequestHandler = async (req, res) => {
  const user = getAuthenticatedUser(req)
  const { batch, uploader } = await batchAndUploader(req)

  res.json(await legacyImportService.execute(auditActor(user), uploader, batch.id))
}

// --- Plumbing -------------------------------------------------------------

function uploadedFile(req: Request): Express.Multer.File {
  const file = req.file
  if (!file) {
    throw new BadRequestError('IMPORT_FILE_REQUIRED', 'Attach the register as a file field named "file"')
  }
  return file
}

/** Reaches the batch through the caller's scope, or 404s. */
async function scopedBatch(req: Request): Promise<ImportBatchWithUsers> {
  const batch = await authorizationService.findImportBatch(getAuthenticatedUser(req), req.params.id ?? '')
  if (!batch) throw new NotFoundError('IMPORT_BATCH_NOT_FOUND', 'Import batch not found')

  return batch
}

/** The batch and the administrator who uploaded it, whose reach files the event. */
async function batchAndUploader(req: Request): Promise<{ batch: ImportBatchWithUsers; uploader: User }> {
  const batch = await scopedBatch(req)
  const uploader = await prisma.user.findUnique({ where: { id: batch.uploadedByUserId } })
  if (!uploader)
    throw new NotFoundError('USER_NOT_FOUND', 'The administrator who uploaded this import is gone')

  return { batch, uploader }
}

function decisionReason(req: Request): string {
  const parsed = importDecisionSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'A decision requires a reason', parsed.error.flatten())
  }

  return parsed.data.reason
}

async function rowPage(req: Request, status?: ImportRow['status']): Promise<ImportRowPageDto> {
  const parsed = importRowQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'Invalid row query', parsed.error.flatten())
  }

  const user = getAuthenticatedUser(req)
  const batch = await scopedBatch(req)

  const page = await authorizationService.listImportRows(user, batch, {
    ...parsed.data,
    ...(status ? { status } : {}),
  })

  return { ...page, items: page.items.map(toRowDto) }
}

async function rowCount(batchId: string, scope: Record<string, unknown> = {}): Promise<number> {
  return prisma.importRow.count({ where: { importBatchId: batchId, ...scope } })
}

function toBatchDto(batch: ImportBatchWithUsers, rows: number): ImportBatchDto {
  return {
    id: batch.id,
    // Uploaded filenames are attacker-chosen text that ends up on a screen.
    sourceFilename: neutralizeSpreadsheetText(batch.sourceFilename),
    sourceFormat: batch.sourceFormat as ImportSourceFormat,
    sourceChecksum: batch.sourceChecksum,
    status: batch.status as ImportBatchStatus,
    drawYearStart: batch.drawYearStart,
    drawYearEnd: batch.drawYearEnd,
    uploadedBy: batch.uploadedBy,
    approvedBy: batch.approvedBy,
    rowCount: rows,
    createdAt: batch.createdAt.toISOString(),
    reviewedAt: batch.reviewedAt?.toISOString() ?? null,
    importedAt: batch.importedAt?.toISOString() ?? null,
  }
}

/**
 * One staged row, for a reviewer.
 *
 * The national ID is reduced to its last four digits. A reviewer needs to find
 * the line in the paper register, which four digits and a row number do; nobody
 * reviewing a batch needs a screenful of complete national identity numbers, and
 * a review page is the easiest place in the system to leave one open.
 */
function toRowDto(row: ImportRow): ImportRowDto {
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    status: row.status,
    nationalIdSuffix: row.nationalId ? row.nationalId.slice(-4) : '',
    fullName: neutralizeOptional(row.fullName) ?? '',
    communeCode: neutralizeSpreadsheetText(row.communeCode),
    drawYear: row.drawYear,
    participated: row.participated,
    won: row.won,
    issues: storedIssues(row).map((issue): ImportIssueDto => ({
      code: issue.code,
      column: issue.column,
      detail: neutralizeOptional(issue.detail),
    })),
  }
}

export type { ImportBatch }
