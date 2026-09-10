import type {
  PublicApplicationStatusDto,
  PublicDrawStatusDto,
  PublicPageDto,
  PublicPlatformStatsDto,
  PublicResultDto,
  PublicResultSummaryDto,
} from '@hajj-lottery/shared'
import type { Request, RequestHandler } from 'express'

import { BadRequestError, NotFoundError } from '../lib/errors.js'
import { cachePublicListing, cachePublishedResult } from '../middleware/public-cache.js'
import { applicationStatusService } from '../services/application-status.service.js'
import { publicResultsService, type PublicGeographicFilters } from '../services/public-results.service.js'
import {
  applicationStatusLookupSchema,
  publicDrawStatusQuerySchema,
  publicResultParamsSchema,
  publicResultsQuerySchema,
} from '../validation/public.js'

/**
 * The citizen-facing endpoints. No session, no account, no admin anything.
 *
 * Everything here is a read. Nothing under `/api/public` writes a row, sets a
 * cookie, or touches a participant, a pool, an audit record or an internal id —
 * and the DTOs these hand to `res.json` are built field by field in
 * `lib/public-dto.ts` rather than serialized from Prisma models, so a column
 * added upstream cannot become public by default.
 */

/**
 * Query filters, parsed and clamped, for both public listings.
 *
 * The page size is clamped inside the schema rather than rejected, so
 * `?pageSize=10000000` is served a hundred rows instead of an error — the cap is
 * the server's, not a default the caller may raise.
 */
function listingFilters(req: Request, schema: PublicListingSchema): PublicGeographicFilters {
  const parsed = schema.safeParse(req.query)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'Check the filters in the request')
  }
  return parsed.data
}

type PublicListingSchema = typeof publicResultsQuerySchema | typeof publicDrawStatusQuerySchema

/**
 * `POST /api/public/application-status` — a citizen checks their own application.
 *
 * A POST rather than a GET, and not for REST reasons. A GET would put a receipt
 * reference and a mobile number in the request line, where they reach access
 * logs, browser history, `Referer` headers and every proxy in between, and where
 * a shared cache would key on them. Neither value is a secret worth much, but
 * writing both into infrastructure logs across the country is a decision nobody
 * would take deliberately.
 *
 * The response is `no-store` by way of the router default: it describes one
 * person's application, and no shared cache can tell one caller from another
 * here because there is no session to vary on.
 */
export const lookupApplicationStatus: RequestHandler = async (req, res) => {
  const parsed = applicationStatusLookupSchema.safeParse(req.body)
  if (!parsed.success) {
    // Deliberately not a field-level report. Naming which of the two values was
    // malformed is harmless on its own, but it makes the failure shapes
    // distinguishable, and every distinguishable failure on this route is one
    // more bit a caller can use. The client has the same rules and can say
    // something more helpful before ever sending the request.
    throw new BadRequestError('VALIDATION_FAILED', 'Check the reference and mobile number you entered')
  }

  // The service raises one indistinguishable failure for an unknown reference
  // and for a wrong number alike — see application-status.service.ts.
  const body: PublicApplicationStatusDto = await applicationStatusService.lookup(parsed.data)
  res.json(body)
}

/**
 * `GET /api/public/results` — published results, most recently announced first.
 *
 * Unpublished results are not here, and there is no filter that reaches them:
 * the listing reads `result_publications`, so a commune that has drawn but not
 * announced has nothing to be found by rather than a row that is filtered out.
 */
export const listPublicResults: RequestHandler = async (req, res) => {
  const filters = listingFilters(req, publicResultsQuerySchema)
  const body: PublicPageDto<PublicResultSummaryDto> = await publicResultsService.listResults(filters)

  cachePublicListing(res)
  res.json(body)
}

/**
 * `GET /api/public/results/:drawYear/:wilayaCode/:communeCode` — one official result.
 *
 * Addressed by official codes rather than by database ids, so the URL is one a
 * citizen can be told over the phone and one that stays valid regardless of what
 * the database does. Wilaya *and* commune, because commune codes are unique only
 * within their wilaya.
 *
 * A commune that has not published, one that never drew, and one that does not
 * exist all return the same 404. Distinguishing them would turn this into a way
 * to find out which communes have finished drawing but not yet announced, which
 * is exactly the window in which that information is worth something.
 */
export const getPublicResult: RequestHandler = async (req, res) => {
  const parsed = publicResultParamsSchema.safeParse(req.params)
  if (!parsed.success) throw resultNotFound()

  const { drawYear, wilayaCode, communeCode } = parsed.data
  const body: PublicResultDto | null = await publicResultsService.findResult(
    drawYear,
    wilayaCode,
    communeCode,
  )
  if (!body) throw resultNotFound()

  cachePublishedResult(res)
  res.json(body)
}

/**
 * `GET /api/public/draw-status` — where each commune's draw stands.
 *
 * The transparency endpoint: which communes are taking applications, which have
 * closed, which have drawn, and which have announced. It carries no applicant
 * count and no pool information of any kind — see the service for why.
 */
export const listPublicDrawStatus: RequestHandler = async (req, res) => {
  const filters = listingFilters(req, publicDrawStatusQuerySchema)
  const body: PublicPageDto<PublicDrawStatusDto> = await publicResultsService.listDrawStatus(filters)

  cachePublicListing(res)
  res.json(body)
}

/**
 * `GET /api/public/stats` — platform-wide scale for the landing page.
 *
 * Takes no input, so there is nothing to validate and nothing to rate-limit
 * beyond the usual per-IP shared budget everything else here has. Cached the
 * same as a listing: the numbers move only as fast as a wilaya/commune
 * changes or an administrator configures a new commune draw.
 */
export const getPublicStats: RequestHandler = async (_req, res) => {
  const body: PublicPlatformStatsDto = await publicResultsService.getPlatformStats()

  cachePublicListing(res)
  res.json(body)
}

function resultNotFound(): NotFoundError {
  return new NotFoundError('RESULT_NOT_PUBLISHED', 'No published result for that commune and draw year')
}
