import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

// The gate reads a module-level env singleton, so an unset key is exercised
// by mocking that module for this file only.
vi.mock('../src/config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    CLIENT_ORIGIN: 'http://localhost:5173',
    INTERNAL_API_KEY: undefined,
  },
}))

const { createApp } = await import('../src/app.js')

const app = createApp()

describe('participant API with INTERNAL_API_KEY unset', () => {
  it('fails closed rather than serving personal data', async () => {
    const response = await request(app).get('/api/participants/by-national-id/112233445566778899')

    expect(response.status).toBe(503)
    expect(response.body.code).toBe('NOT_CONFIGURED')
  })

  it('fails closed on writes too, even with a key supplied', async () => {
    const response = await request(app)
      .post('/api/participants')
      .set('x-internal-api-key', 'any-key')
      .send({ nationalId: '112233445566778899', fullName: 'Test', dob: '1985-04-12' })

    expect(response.status).toBe(503)
  })

  it('still serves the public geographic API', async () => {
    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
  })
})
