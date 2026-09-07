import { PrismaClient } from '@prisma/client'

// A single shared PrismaClient instance avoids exhausting database
// connections across hot-reloads in development.
export const prisma = new PrismaClient()
