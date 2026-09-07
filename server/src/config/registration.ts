import { env } from './env.js'

/**
 * Which year citizens are registering for, and whether intake is open.
 *
 * Deliberately minimal: a real draw lifecycle — opening and closing dates per
 * commune, published results, archived years — belongs to a later step. What
 * matters here is that the answer comes from the server, so a browser cannot
 * apply for a year that is not running, nor slip an application into a closed
 * or historical one by editing a form field.
 */
export interface RegistrationWindow {
  drawYear: number
  isOpen: boolean
}

export function currentRegistrationWindow(): RegistrationWindow {
  return {
    drawYear: env.DRAW_YEAR ?? new Date().getUTCFullYear(),
    isOpen: env.REGISTRATION_OPEN,
  }
}
