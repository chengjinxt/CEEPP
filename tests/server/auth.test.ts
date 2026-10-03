/// <reference types="@cloudflare/vitest-plugin/types" />
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { verifyAdmin } from '../../src/server/auth'

const issuer = `https://ceepp-test-${crypto.randomUUID()}.cloudflareaccess.com`
const audience = 'ceepp-admin-application'
const adminEmail = 'admin@example.test'
let privateKey: CryptoKey

async function assertion(email: string, tokenAudience = audience): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(tokenAudience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

function accessRequest(token: string): Request {
  return new Request('https://papers.example.test/admin/api/papers', {
    headers: { 'Cf-Access-Jwt-Assertion': token },
  })
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true })
  privateKey = pair.privateKey as CryptoKey
  const key = await exportJWK(pair.publicKey)
  key.kid = 'test-key'
  key.alg = 'RS256'
  key.use = 'sig'
  vi.stubGlobal('fetch', async () => jsonResponse({ keys: [key] }))
})

afterAll(() => vi.unstubAllGlobals())

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

describe('Cloudflare Access verification', () => {
  it('accepts a correctly signed token for the configured application and administrator', async () => {
    const result = await verifyAdmin(accessRequest(await assertion(adminEmail)), {
      ACCESS_TEAM_DOMAIN: issuer,
      ACCESS_AUD: audience,
      ADMIN_EMAIL: adminEmail,
    })
    expect(result).toBe(true)
  })

  it('rejects a signed token for another application or account', async () => {
    const configuration = {
      ACCESS_TEAM_DOMAIN: issuer,
      ACCESS_AUD: audience,
      ADMIN_EMAIL: adminEmail,
    }
    expect(await verifyAdmin(accessRequest(await assertion(adminEmail, 'another-app')), configuration)).toBe(false)
    expect(await verifyAdmin(accessRequest(await assertion('reader@example.test')), configuration)).toBe(false)
  })
})
