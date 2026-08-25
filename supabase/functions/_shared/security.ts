export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required secret: ${name}`)
  return value
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

export function generateProtocol(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let token = ''
  for (const byte of bytes) token += alphabet[byte % alphabet.length]
  return `CI-${new Date().getUTCFullYear().toString().slice(-2)}-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}-${token.slice(12, 16)}`
}

export async function protocolDigest(protocol: string): Promise<string> {
  const pepper = requiredEnv('PROTOCOL_PEPPER')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(protocol.trim().toUpperCase()))
  return base64url(new Uint8Array(sig))
}

export async function encryptContact(plainText: string): Promise<{ciphertext: string; nonce: string}> {
  const rawKey = fromBase64url(requiredEnv('CONTACT_ENCRYPTION_KEY'))
  if (rawKey.byteLength !== 32) throw new Error('CONTACT_ENCRYPTION_KEY must be 32 bytes, base64url encoded')
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(plainText))
  return { ciphertext: base64url(new Uint8Array(encrypted)), nonce: base64url(nonce) }
}

export async function decryptContact(ciphertext: string, nonce: string): Promise<string> {
  const rawKey = fromBase64url(requiredEnv('CONTACT_ENCRYPTION_KEY'))
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(nonce) }, key, fromBase64url(ciphertext))
  return new TextDecoder().decode(decrypted)
}

export const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer'
}
