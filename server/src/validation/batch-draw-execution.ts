import { z } from 'zod'

/**
 * Request shapes for batch draw execution. `.strict()` throughout — a batch
 * request carries no seed, no algorithm choice and no winner count, so there
 * is nothing else a client could legitimately add.
 */

export const batchValidateSchema = z
  .object({ drawYearId: z.string({ required_error: 'A draw year is required' }).min(1).max(100) })
  .strict()

/**
 * The execute request re-sends the exact commune draws the validate step
 * reported ready — never a count, a filter or "all of them" — so the server
 * runs precisely what the operator confirmed, nothing discovered fresh at
 * the last moment.
 */
export const batchExecuteSchema = z
  .object({
    drawYearId: z.string({ required_error: 'A draw year is required' }).min(1).max(100),
    communeDrawIds: z
      .array(z.string().min(1).max(100))
      .min(1, 'At least one commune draw is required')
      .max(2000, 'That is more commune draws than exist'),
  })
  .strict()
  .refine((value) => new Set(value.communeDrawIds).size === value.communeDrawIds.length, {
    message: 'A commune draw may appear only once in a batch',
    path: ['communeDrawIds'],
  })

export type BatchValidateRequest = z.infer<typeof batchValidateSchema>
export type BatchExecuteRequest = z.infer<typeof batchExecuteSchema>
