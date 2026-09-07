import { Router } from 'express'

import { toCommuneDto, toWilayaDto } from '../lib/geo-dto.js'
import { sortByCode } from '../lib/geo-order.js'
import { NotFoundError } from '../lib/errors.js'
import { prisma } from '../lib/prisma.js'
import { asyncHandler } from '../middleware/error-handler.js'

export const wilayasRouter = Router()

wilayasRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const wilayas = await prisma.wilaya.findMany({ where: { isActive: true } })
    res.json(sortByCode(wilayas).map(toWilayaDto))
  }),
)

wilayasRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const wilaya = await prisma.wilaya.findFirst({
      where: { id: req.params.id, isActive: true },
    })
    if (!wilaya) throw new NotFoundError('WILAYA_NOT_FOUND', 'Wilaya not found')
    res.json(toWilayaDto(wilaya))
  }),
)

wilayasRouter.get(
  '/:id/communes',
  asyncHandler(async (req, res) => {
    const wilaya = await prisma.wilaya.findFirst({
      where: { id: req.params.id, isActive: true },
    })
    if (!wilaya) throw new NotFoundError('WILAYA_NOT_FOUND', 'Wilaya not found')

    const communes = await prisma.commune.findMany({
      where: { wilayaId: wilaya.id, isActive: true },
    })
    res.json(sortByCode(communes).map(toCommuneDto))
  }),
)
