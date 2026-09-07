import { z } from 'zod'

/**
 * Login input is checked only for shape, never for password strength: a
 * strength rule here would reject a legitimate old password and, worse, would
 * let an attacker skip candidates without spending a request.
 */
export const loginSchema = z
  .object({
    username: z.string({ required_error: 'Username is required' }).min(1).max(100),
    password: z.string({ required_error: 'Password is required' }).min(1).max(1024),
  })
  .strict()

export type LoginInput = z.infer<typeof loginSchema>
