import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6'

const TEAM_SLUG = 'thiagodownload100-9875'
const TEAM_ID = 'team_gWg41owd8eAZqF1O8bfexEgo'
const PROJECT_NAME = 'canal-integridade'
const TEAM_ISSUER = `https://oidc.vercel.com/${TEAM_SLUG}`
const GLOBAL_ISSUER = 'https://oidc.vercel.com'
const AUDIENCE = `https://vercel.com/${TEAM_SLUG}`
const SUBJECT = `owner:${TEAM_SLUG}:project:${PROJECT_NAME}:environment:production`
const JWKS = createRemoteJWKSet(new URL('https://oidc.vercel.com/.well-known/jwks'))

export class GatewayAuthError extends Error {
  status = 401
  code = 'gateway_authentication_failed'
}

export async function verifyVercelGateway(req: Request) {
  const token = req.headers.get('x-vercel-oidc-token') ?? ''
  if (!token) throw new GatewayAuthError()

  let payload: Record<string, unknown> | null = null

  for (const issuer of [TEAM_ISSUER, GLOBAL_ISSUER]) {
    try {
      const verified = await jwtVerify(token, JWKS, {
        issuer,
        audience: AUDIENCE,
        subject: SUBJECT,
      })
      payload = verified.payload as Record<string, unknown>
      break
    } catch {
      // Tenta o segundo modo de issuer suportado pela Vercel.
    }
  }

  if (!payload) throw new GatewayAuthError()

  if (
    payload.owner_id !== TEAM_ID ||
    payload.project !== PROJECT_NAME ||
    payload.environment !== 'production'
  ) {
    throw new GatewayAuthError()
  }

  return payload
}

export function gatewayIdentityDigest(req: Request): string {
  const value = req.headers.get('x-gateway-ip-digest') ?? ''
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(value)) throw new GatewayAuthError()
  return value
}
