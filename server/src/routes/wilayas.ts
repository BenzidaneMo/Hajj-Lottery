import { Router } from 'express'

import { toCommuneDto, toWilayaDto } from '../lib/geo-dto.js'
import { prisma } from '../lib/prisma.js'

export const wilayasRouter = Router()

wilayasRouter.get('/', async (_req, res) => {
  const wilayas = await prisma.wilaya.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  })
  res.json(wilayas.map(toWilayaDto))
})

wilayasRouter.get('/:id', async (req, res) => {
  const wilaya = await prisma.wilaya.findFirst({
    where: { id: req.params.id, isActive: true },
  })
  if (!wilaya) {
    res.status(404).json({ error: 'Wilaya not found' })
    return
  }
  res.json(toWilayaDto(wilaya))
})

wilayasRouter.get('/:id/communes', async (req, res) => {
  const wilaya = await prisma.wilaya.findFirst({
    where: { id: req.params.id, isActive: true },
  })
  if (!wilaya) {
    res.status(404).json({ error: 'Wilaya not found' })
    return
  }
  const communes = await prisma.commune.findMany({
    where: { wilayaId: wilaya.id, isActive: true },
    orderBy: { code: 'asc' },
  })
  res.json(communes.map(toCommuneDto))
})
