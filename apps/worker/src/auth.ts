import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  ADMIN_EMAIL?: string
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export async function verifyAdmin(request: Request, env: AccessEnv): Promise<boolean> {
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion')
  const configuredDomain = env.ACCESS_TEAM_DOMAIN?.trim().replace(/\/$/, '')
  const audience = env.ACCESS_AUD?.trim()
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase()
  if (!assertion || !configuredDomain || !audience || !adminEmail) return false

  try {
    const issuer = configuredDomain.startsWith('https://')
      ? configuredDomain
      : `https://${configuredDomain}`
    const url = new URL(issuer)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.cloudflareaccess.com') || url.pathname !== '/' || url.search || url.hash) {
      return false
    }

    let keys = keySets.get(issuer)
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
      keySets.set(issuer, keys)
    }
    const { payload } = await jwtVerify(assertion, keys, {
      issuer,
      audience,
      algorithms: ['RS256'],
    })
    return typeof payload.email === 'string' && payload.email.toLowerCase() === adminEmail
  } catch {
    return false
  }
}
