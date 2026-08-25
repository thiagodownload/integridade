import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendPortalEmail } from '../_shared/portal-email.ts'
import { decryptContact, loadPublicCryptoMaterial } from '../_shared/security.ts'

const TRACK_URL = 'https://integridade.mundialatacadista.com.br/#/acompanhar'

type Job = {
  outbox_id: number
  organization_id: string
  report_id: string
  event_type: string
  attempts: number
}

type CryptoMaterial = {
  protocolPepper: string
  contactEncryptionKey: string
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

async function hash(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return new Uint8Array(digest)
}

async function secureEquals(left: string, right: string): Promise<boolean> {
  if (!left || !right) return false
  const [a, b] = await Promise.all([hash(left), hash(right)])
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

function validEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  const service = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const suppliedSecret = req.headers.get('x-worker-secret') ?? ''
    const { data: expectedSecret, error: secretError } = await service.rpc('get_reporter_email_worker_secret_internal')
    if (secretError || typeof expectedSecret !== 'string' || !(await secureEquals(suppliedSecret, expectedSecret))) {
      return reply(401, { error: 'worker_authentication_failed' })
    }

    const { data: claimed, error: claimError } = await service.rpc('claim_reporter_email_outbox_internal', {
      p_limit: 5,
    })
    if (claimError) return reply(500, { error: 'outbox_claim_failed' })

    const jobs = (Array.isArray(claimed) ? claimed : []) as Job[]
    if (jobs.length === 0) return reply(200, { ok: true, claimed: 0, sent: 0, failed: 0, skipped: 0 })

    let material: CryptoMaterial | null = null
    let sent = 0
    let failed = 0
    let skipped = 0

    async function complete(job: Job, success: boolean, errorCode?: string) {
      await service.rpc('complete_reporter_email_outbox_internal', {
        p_outbox_id: job.outbox_id,
        p_success: success,
        p_error_code: errorCode ?? null,
      })
    }

    async function audit(job: Job, action: string, metadata: Record<string, unknown>) {
      await service.from('audit_events').insert({
        organization_id: job.organization_id,
        actor_user_id: null,
        action,
        object_type: 'report',
        object_id: job.report_id,
        metadata: {
          outbox_id: job.outbox_id,
          event_type: job.event_type,
          ...metadata,
        },
      })
    }

    for (const job of jobs) {
      try {
        const { data: contact, error: contactError } = await service
          .from('report_contacts')
          .select('email_enabled,email_ciphertext,email_nonce')
          .eq('report_id', job.report_id)
          .maybeSingle()

        if (contactError) throw new Error('contact_unavailable')

        if (!contact || !contact.email_enabled) {
          await complete(job, true)
          await audit(job, 'notification.reporter.email.skipped', { reason: 'contact_disabled' })
          skipped += 1
          continue
        }

        if (!contact.email_ciphertext || !contact.email_nonce) throw new Error('contact_unavailable')

        if (!material) {
          try {
            material = await loadPublicCryptoMaterial(service) as CryptoMaterial
          } catch {
            throw new Error('crypto_unavailable')
          }
        }

        let recipient = ''
        try {
          recipient = (await decryptContact(
            String(contact.email_ciphertext),
            String(contact.email_nonce),
            material.contactEncryptionKey,
          )).trim().toLowerCase()
        } catch {
          throw new Error('crypto_unavailable')
        }

        if (!validEmail(recipient)) throw new Error('contact_unavailable')

        try {
          await sendPortalEmail(service, job.organization_id, {
            to: recipient,
            subject: 'Há uma atualização disponível',
            text: `Há uma nova atualização disponível no Canal de Integridade. Para consultar, acesse ${TRACK_URL} e informe o protocolo que foi fornecido no envio do relato. Por segurança, este e-mail não contém protocolo, conteúdo do relato ou detalhes da atualização.`,
            html: `<p>Há uma nova atualização disponível no Canal de Integridade.</p><p><a href="${TRACK_URL}">Acessar o acompanhamento seguro</a></p><p>Informe o protocolo que foi fornecido no envio do relato.</p><p>Por segurança, este e-mail não contém protocolo, conteúdo do relato ou detalhes da atualização.</p>`,
          })
        } catch (error) {
          const code = error instanceof Error && (error.message === 'email_transport_not_configured' || error.message === 'email_transport_load_failed')
            ? 'email_transport_unavailable'
            : 'smtp_delivery_failed'
          throw new Error(code)
        } finally {
          recipient = ''
        }

        await complete(job, true)
        await audit(job, 'notification.reporter.email.sent', { attempt: job.attempts })
        sent += 1
      } catch (error) {
        const code = error instanceof Error ? error.message : 'delivery_failed'
        const safeCode = ['contact_unavailable','crypto_unavailable','smtp_delivery_failed','email_transport_unavailable'].includes(code)
          ? code
          : 'delivery_failed'
        try {
          await complete(job, false, safeCode)
          await audit(job, 'notification.reporter.email.failed', { attempt: job.attempts, error_code: safeCode })
        } catch {
          // O claim já deslocou available_at; uma execução futura tentará novamente.
        }
        failed += 1
      }
    }

    return reply(200, { ok: true, claimed: jobs.length, sent, failed, skipped })
  } catch {
    return reply(500, { error: 'unexpected_error' })
  }
})
