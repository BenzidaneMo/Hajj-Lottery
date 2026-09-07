import { Router } from 'express'

import { NotFoundError } from '../lib/errors.js'
import { toCommuneDto } from '../lib/geo-dto.js'
import { prisma } from '../lib/prisma.js'
import { asyncHandler } from '../middleware/error-handler.js'

export const communesRouter = Router()

communesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const wilayaId = typeof req.query.wilayaId === 'string' ? req.query.wilayaId : undefined

    const communes = await prisma.commune.findMany({
      where: { isActive: true, ...(wilayaId ? { wilayaId } : {}) },
      orderBy: [{ wilayaId: 'asc' }, { code: 'asc' }],
    })
    res.json(communes.map(toCommuneDto))
  }),
)

communesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const commune = await prisma.commune.findFirst({
      where: { id: req.params.id, isActive: true },
    })
    if (!commune) throw new NotFoundError('COMMUNE_NOT_FOUND', 'Commune not found')
    res.json(toCommuneDto(commune))
  }),
)
