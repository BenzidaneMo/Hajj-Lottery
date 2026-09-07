import { Router } from 'express'

import { toCommuneDto } from '../lib/geo-dto.js'
import { prisma } from '../lib/prisma.js'

export const communesRouter = Router()

communesRouter.get('/', async (req, res) => {
  const wilayaId = typeof req.query.wilayaId === 'string' ? req.query.wilayaId : undefined

  const communes = await prisma.commune.findMany({
    where: { isActive: true, ...(wilayaId ? { wilayaId } : {}) },
    orderBy: [{ wilayaId: 'asc' }, { code: 'asc' }],
  })
  res.json(communes.map(toCommuneDto))
})

communesRouter.get('/:id', async (req, res) => {
  const commune = await prisma.commune.findFirst({
    where: { id: req.params.id, isActive: true },
  })
  if (!commune) {
    res.status(404).json({ error: 'Commune not found' })
    return
  }
  res.json(toCommuneDto(commune))
})
