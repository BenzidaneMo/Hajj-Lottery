import type {
  AdminApplicationDetailDto,
  AdminApplicationSummaryDto,
  AdminDashboardDto,
  AdminRole,
  AdminUserDto,
  ApprovalRequestDto,
  AuditLogDto,
  AuthenticatedUserDto,
  CommuneDrawDto,
  DrawPoolSummaryDto,
  DrawResultDto,
  DrawYearDto,
  ImportBatchDto,
  ImportSummaryDto,
  ParticipationHistoryDto,
  PoolValidationDto,
} from '@hajj-lottery/shared'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import i18n from '../src/i18n'
import { AuthContext, type AuthContextValue } from '../src/lib/auth-context'

import { COMMUNE, WILAYA } from './harness'

/**
 * Fixtures and a signed-in session for the administrative console tests.
 *
 * The session is supplied through the context rather than by letting
 * `AuthProvider` call `/api/auth/me`, so a test states the role it is exercising
 * in one word instead of staging a login. That is safe to do here precisely
 * because the role in this context is *only* what the client was told: every
 * assertion about what a role may actually do is an assertion about the request
 * the page sent, or about the server's answer being honoured.
 */

export const WILAYA_REF = { id: 'wil-1', ...WILAYA }
export const COMMUNE_REF = { id: 'com-1', ...COMMUNE }

export function session(
  role: AdminRole,
  overrides: Partial<AuthenticatedUserDto> = {},
): AuthenticatedUserDto {
  const scope =
    role === 'SUPER_ADMIN'
      ? { wilaya: null, commune: null }
      : role === 'WILAYA_ADMIN'
        ? { wilaya: WILAYA_REF, commune: null }
        : { wilaya: WILAYA_REF, commune: COMMUNE_REF }

  return {
    id: `user-${role}`,
    username: role.toLowerCase(),
    role,
    isActive: true,
    scope,
    lastLoginAt: '2027-01-04T08:00:00.000Z',
    ...overrides,
  }
}

/** Renders an admin page with a session, at `path` matched by `pattern`. */
export function renderAdmin(
  element: ReactElement,
  options: {
    role?: AdminRole
    user?: AuthenticatedUserDto
    pattern?: string
    path?: string
  } = {},
): RenderResult {
  const user = options.user ?? session(options.role ?? 'SUPER_ADMIN')
  const value: AuthContextValue = {
    status: 'authenticated',
    user,
    signIn: async () => {},
    signOut: async () => {},
  }

  return render(
    <I18nextProvider i18n={i18n}>
      <AuthContext.Provider value={value}>
        <MemoryRouter initialEntries={[options.path ?? '/admin']}>
          <Routes>
            <Route path={options.pattern ?? '/admin'} element={element} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </I18nextProvider>,
  )
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

export function dashboard(overrides: Partial<AdminDashboardDto> = {}): AdminDashboardDto {
  return {
    scope: 'NATIONAL',
    wilaya: null,
    commune: null,
    drawYear: { id: 'dy-1', year: 2027, status: 'REGISTRATION_OPEN' },
    counts: {
      communeDraws: 40,
      draftDraws: 8,
      readyDraws: 12,
      lockedDraws: 6,
      completedDraws: 14,
      cancelledDraws: 0,
      allocatedSpots: 480,
      applications: 8431,
      eligibleApplications: 8100,
      ineligibleApplications: 331,
      publishedResults: 9,
      unpublishedResults: 5,
      withdrawnWinners: 3,
      reservesAwaitingDecision: 2,
    },
    governance: { pendingImports: 4, pendingApprovals: 7 },
    generatedAt: '2027-03-01T10:00:00.000Z',
    ...overrides,
  }
}

export function drawYear(overrides: Partial<DrawYearDto> = {}): DrawYearDto {
  return {
    id: 'dy-1',
    year: 2027,
    status: 'REGISTRATION_OPEN',
    communeDrawCount: 40,
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-12-01T09:00:00.000Z',
    ...overrides,
  }
}

export function communeDraw(overrides: Partial<CommuneDrawDto> = {}): CommuneDrawDto {
  return {
    id: 'cd-1',
    drawYear: 2027,
    allocatedSpots: 12,
    status: 'READY',
    commune: COMMUNE_REF,
    wilaya: WILAYA_REF,
    createdAt: '2026-12-01T09:00:00.000Z',
    updatedAt: '2027-01-01T09:00:00.000Z',
    ...overrides,
  }
}

export function application(overrides: Partial<AdminApplicationSummaryDto> = {}): AdminApplicationSummaryDto {
  return {
    id: 'app-1',
    applicationReference: 'HZ-2027-MES-8F42K1',
    drawYear: 2027,
    entryType: 'SINGLE',
    status: 'ELIGIBLE',
    participantCount: 1,
    calculatedWeight: 4,
    commune: COMMUNE_REF,
    wilaya: WILAYA_REF,
    createdAt: '2027-02-11T09:15:00.000Z',
    ...overrides,
  }
}

export function applicationDetail(
  overrides: Partial<AdminApplicationDetailDto> = {},
): AdminApplicationDetailDto {
  return {
    ...application(),
    updatedAt: '2027-02-11T09:15:00.000Z',
    applicants: [
      {
        participantId: 'p-1',
        role: 'PRIMARY',
        firstNameAr: 'أمينة',
        lastNameAr: 'بلقاسم',
        firstNameLatin: 'Amina',
        lastNameLatin: 'Belkacem',
        nationalIdSuffix: '7391',
        dob: '1968-04-02',
        gender: 'FEMALE',
        phoneNumber: '+213555000000',
        hasWonHajj: false,
      },
    ],
    ...overrides,
  }
}

export function poolValidation(overrides: Partial<PoolValidationDto> = {}): PoolValidationDto {
  return {
    ready: true,
    drawYear: 2027,
    communeCode: COMMUNE.code,
    allocatedSpots: 12,
    applicationCount: 843,
    totalWeight: 1904,
    blockers: [],
    validatedAt: '2027-03-01T10:00:00.000Z',
    ...overrides,
  }
}

export function poolSummary(overrides: Partial<DrawPoolSummaryDto> = {}): DrawPoolSummaryDto {
  return {
    id: 'pool-1',
    drawYear: 2027,
    communeCode: COMMUNE.code,
    entryCount: 843,
    totalWeight: 1904,
    allocatedSpots: 12,
    snapshotHash: 'b'.repeat(64),
    snapshotVersion: 1,
    frozenAt: '2027-03-02T10:00:00.000Z',
    alreadyFrozen: true,
    ...overrides,
  }
}

/**
 * A concluded draw with three winners and three reserves.
 *
 * Deliberately 3 + 3 rather than a token pair: the reserve-ordering assertions
 * need enough rows that a sort would visibly rearrange them.
 */
export function drawResult(overrides: Partial<DrawResultDto> = {}): DrawResultDto {
  return {
    id: 'dr-1',
    drawYear: 2027,
    communeCode: COMMUNE.code,
    winnerCount: 3,
    reserveCount: 3,
    activeWinnerCount: 3,
    winningParticipantCount: 4,
    allocatedSpots: 3,
    entryCount: 843,
    totalWeightAtDraw: 1904,
    poolHash: 'b'.repeat(64),
    algorithmVersion: 'weighted-csprng-v1',
    startedAt: '2027-04-28T08:29:00.000Z',
    completedAt: '2027-04-28T08:30:00.000Z',
    publishedAt: null,
    winners: [
      {
        selectionOrder: 1,
        applicationReference: 'HZ-2027-MES-8F42K1',
        entryType: 'SINGLE',
        selectedWeight: 3,
        participantCount: 1,
        outcome: 'ACTIVE',
        abandonment: null,
      },
      {
        selectionOrder: 2,
        applicationReference: 'HZ-2027-MES-QQ19ZP',
        entryType: 'PAIRED',
        selectedWeight: 5,
        participantCount: 2,
        outcome: 'ACTIVE',
        abandonment: null,
      },
      {
        selectionOrder: 3,
        applicationReference: 'HZ-2027-MES-3KD7VB',
        entryType: 'SINGLE',
        selectedWeight: 1,
        participantCount: 1,
        outcome: 'ACTIVE',
        abandonment: null,
      },
    ],
    reserves: [
      {
        reservePosition: 1,
        selectionOrder: 4,
        applicationReference: 'HZ-2027-MES-R51TTA',
        entryType: 'SINGLE',
        participantCount: 1,
        selectedWeight: 2,
        status: 'WAITING',
        replacesSelectionOrder: null,
        calledAt: null,
        decidedAt: null,
      },
      {
        reservePosition: 2,
        selectionOrder: 5,
        applicationReference: 'HZ-2027-MES-B90WQ4',
        entryType: 'PAIRED',
        participantCount: 2,
        selectedWeight: 4,
        status: 'WAITING',
        replacesSelectionOrder: null,
        calledAt: null,
        decidedAt: null,
      },
      {
        reservePosition: 3,
        selectionOrder: 6,
        applicationReference: 'HZ-2027-MES-Z22MMK',
        entryType: 'SINGLE',
        participantCount: 1,
        selectedWeight: 1,
        status: 'WAITING',
        replacesSelectionOrder: null,
        calledAt: null,
        decidedAt: null,
      },
    ],
    events: [
      { selectionOrder: 1, activeTotalWeight: 1904, randomValue: 41 },
      { selectionOrder: 2, activeTotalWeight: 1901, randomValue: 912 },
      { selectionOrder: 3, activeTotalWeight: 1896, randomValue: 1500 },
    ],
    ...overrides,
  }
}

export function historyRecord(overrides: Partial<ParticipationHistoryDto> = {}): ParticipationHistoryDto {
  return {
    id: 'ph-1',
    drawYear: 2025,
    participated: true,
    won: false,
    source: 'APPLICATION',
    verified: true,
    notes: null,
    commune: COMMUNE,
    wilaya: WILAYA,
    createdAt: '2025-06-01T09:00:00.000Z',
    updatedAt: '2025-06-01T09:00:00.000Z',
    ...overrides,
  }
}

export function importBatch(overrides: Partial<ImportBatchDto> = {}): ImportBatchDto {
  return {
    id: 'ib-1',
    sourceFilename: 'mostaganem-2019.csv',
    sourceFormat: 'CSV',
    sourceChecksum: 'c'.repeat(64),
    status: 'READY_FOR_REVIEW',
    drawYearStart: 2015,
    drawYearEnd: 2019,
    uploadedBy: { id: 'user-WILAYA_ADMIN', username: 'wilaya_admin' },
    approvedBy: null,
    rowCount: 320,
    createdAt: '2027-01-05T09:00:00.000Z',
    reviewedAt: null,
    importedAt: null,
    ...overrides,
  }
}

export function importSummary(overrides: Partial<ImportSummaryDto> = {}): ImportSummaryDto {
  return {
    batch: importBatch(),
    rows: 320,
    valid: 300,
    warnings: 14,
    conflicts: 6,
    invalid: 0,
    newParticipants: 210,
    existingParticipants: 90,
    historicalRecords: 300,
    winners: 12,
    importable: false,
    ...overrides,
  }
}

export function approvalRequest(overrides: Partial<ApprovalRequestDto> = {}): ApprovalRequestDto {
  return {
    id: 'ar-1',
    type: 'HISTORICAL_RECORD_CORRECTION',
    status: 'PENDING',
    requestedBy: { id: 'user-COMMUNE_ADMIN', username: 'commune_admin' },
    reviewedBy: null,
    targetType: 'PARTICIPATION_HISTORY',
    targetId: 'ph-1',
    wilayaCode: WILAYA.code,
    communeCode: COMMUNE.code,
    requestedChange: { participated: true },
    reason: 'The paper register shows they took part.',
    reviewReason: null,
    reviewedAt: null,
    createdAt: '2027-02-20T09:00:00.000Z',
    ...overrides,
  }
}

export function auditLog(overrides: Partial<AuditLogDto> = {}): AuditLogDto {
  return {
    id: 'al-1',
    action: 'DRAW_POOL_FROZEN',
    actor: { id: 'user-SUPER_ADMIN', username: 'super_admin' },
    targetType: 'DRAW_POOL',
    targetId: 'pool-1',
    wilayaCode: WILAYA.code,
    communeCode: COMMUNE.code,
    reason: null,
    before: null,
    after: { entryCount: 843, totalWeight: 1904 },
    metadata: null,
    createdAt: '2027-03-02T10:00:00.000Z',
    ...overrides,
  }
}

export function adminUser(overrides: Partial<AdminUserDto> = {}): AdminUserDto {
  return {
    id: 'user-2',
    username: 'oran_admin',
    role: 'WILAYA_ADMIN',
    isActive: true,
    wilaya: WILAYA_REF,
    commune: null,
    lastLoginAt: '2027-02-28T07:30:00.000Z',
    createdAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  }
}
