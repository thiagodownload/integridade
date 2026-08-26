import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendPortalEmail } from '../_shared/portal-email.ts'

const OPERATIONS_URL = 'https://integridade.mundialatacadista.com.br/#/operacoes'

type Job = {
  outbox_id: number
  organization_id: string
  report_id: string
  recipient_user_id: string
  event_type: string
  payload: Record<string, unknown> | null
  attempts: number
}

type MailTemplate = { subject: string; text: string }

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
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
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

function templateFor(job: Job): MailTemplate {
  if (job.event_type === 'report.created') {
    return { subject: 'Novo relato recebido', text: 'Há um novo relato no Canal de Integridade aguardando triagem.' }
  }
  if (job.event_type === 'report.restricted.created') {
    return { subject: 'Novo item restrito recebido', text: 'Há um novo item restrito no Canal de Integridade que requer atenção autorizada.' }
  }
  if (job.event_type === 'report.message.created') {
    return { subject: 'Nova mensagem no relato', text: 'Há uma nova mensagem vinculada a um relato no Canal de Integridade.' }
  }

  const assignmentType = String(job.payload?.assignment_type ?? 'collaborator')
  if (assignmentType === 'principal') {
    return { subject: 'Nova responsabilidade no Canal de Integridade', text: 'Você foi definido como responsável principal por um caso no Canal de Integridade.' }
  }
  if (assignmentType === 'observer') {
    return { subject: 'Novo acompanhamento disponível', text: 'Você recebeu acesso de acompanhamento a um caso no Canal de Integridade.' }
  }
  return { subject: 'Você foi adicionado a um caso', text: 'Você foi incluído como colaborador em um caso no Canal de Integridade.' }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  const service = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const suppliedSecret = req.headers.get('x-worker-secret') ?? ''
    const { data: expectedSecret, error: secretError } = await service.rpc('get_staff_assignment_worker_secret_internal')
    if (secretError || typeof expectedSecret !== 'string' || !(await secureEquals(suppliedSecret, expectedSecret))) {
      return reply(401, { error: 'worker_authentication_failed' })
    }

    const { data: claimed, error: claimError } = await service.rpc('claim_staff_email_outbox_internal', { p_limit: 10 })
    if (claimError) return reply(500, { error: 'outbox_claim_failed' })

    const jobs = (Array.isArray(claimed) ? claimed : []) as Job[]
    let sent = 0
    let failed = 0

    for (const job of jobs) {
      try {
        const { data: profile, error: profileError } = await service
          .from('staff_profiles')
          .select('organization_id,email,active,email_confirmed_at')
          .eq('user_id', job.recipient_user_id)
          .maybeSingle()

        const recipient = String(profile?.email ?? '').trim().toLowerCase()
        if (profileError || !profile || String(profile.organization_id) !== job.organization_id || !profile.active || !profile.email_confirmed_at || !validEmail(recipient)) {
          throw new Error('recipient_unavailable')
        }

        const template = templateFor(job)
        try {
          await sendPortalEmail(service, job.organization_id, {
            to: recipient,
            subject: template.subject,
            text: `${template.text} Acesse a área interna: ${OPERATIONS_URL} Por confidencialidade, este e-mail não contém dados do relato.`,
            html: `<p>${template.text}</p><p><a href="${OPERATIONS_URL}">Acessar a área interna</a></p><p>Por confidencialidade, este e-mail não contém dados do relato.</p>`,
          })
        } catch (error) {
          const code = error instanceof Error && (error.message === 'email_transport_not_configured' || error.message === 'email_transport_load_failed')
            ? 'email_transport_unavailable'
            : 'smtp_delivery_failed'
          throw new Error(code)
        }

        await service.rpc('complete_staff_email_outbox_internal', { p_outbox_id: job.outbox_id, p_success: true, p_error_code: null })
        await service.from('audit_events').insert({
          organization_id: job.organization_id,
          actor_user_id: null,
          action: 'notification.staff.email.sent',
          object_type: 'report',
          object_id: job.report_id,
          metadata: { outbox_id: job.outbox_id, event_type: job.event_type, attempt: job.attempts },
        })
        sent += 1
      } catch (error) {
        const code = error instanceof Error ? error.message : 'delivery_failed'
        const safeCode = ['recipient_unavailable', 'email_transport_unavailable', 'smtp_delivery_failed'].includes(code) ? code : 'delivery_failed'
        try {
          await service.rpc('complete_staff_email_outbox_internal', { p_outbox_id: job.outbox_id, p_success: false, p_error_code: safeCode })
          await service.from('audit_events').insert({
            organization_id: job.organization_id,
            actor_user_id: null,
            action: 'notification.staff.email.failed',
            object_type: 'report',
            object_id: job.report_id,
            metadata: { outbox_id: job.outbox_id, event_type: job.event_type, attempt: job.attempts, error_code: safeCode },
          })
        } catch {
          // A fila preserva o item para tentativa futura.
        }
        failed += 1
      }
    }

    return reply(200, { ok: true, claimed: jobs.length, sent, failed })
  } catch {
    return reply(500, { error: 'unexpected_error' })
  }
})
