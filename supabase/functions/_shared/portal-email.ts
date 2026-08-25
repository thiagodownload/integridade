import nodemailer from 'npm:nodemailer@^9.0.0'

type ServiceClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
}

export type PortalEmailConfig = {
  senderName: string
  senderEmail: string
  replyToEmail: string | null
  subjectPrefix: string
  transportEnabled: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpRequireTls: boolean
  smtpUsername: string
  smtpPassword: string
}

type PortalMail = {
  to: string
  subject: string
  text: string
  html: string
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown> | undefined) ?? null
  if (data && typeof data === 'object') return data as Record<string, unknown>
  return null
}

export async function getPortalEmailConfig(service: ServiceClient, organizationId: string): Promise<PortalEmailConfig> {
  const { data, error } = await service.rpc('get_email_transport_internal', {
    p_organization_id: organizationId,
  })
  if (error) throw new Error('email_transport_load_failed')

  const row = firstRow(data)
  if (!row) throw new Error('email_transport_not_configured')

  const config: PortalEmailConfig = {
    senderName: String(row.sender_name ?? ''),
    senderEmail: String(row.sender_email ?? ''),
    replyToEmail: row.reply_to_email ? String(row.reply_to_email) : null,
    subjectPrefix: String(row.subject_prefix ?? ''),
    transportEnabled: Boolean(row.transport_enabled),
    smtpHost: String(row.smtp_host ?? ''),
    smtpPort: Number(row.smtp_port ?? 587),
    smtpSecure: Boolean(row.smtp_secure),
    smtpRequireTls: Boolean(row.smtp_require_tls),
    smtpUsername: String(row.smtp_username ?? ''),
    smtpPassword: String(row.smtp_password ?? ''),
  }

  if (
    !config.transportEnabled ||
    !config.senderEmail ||
    !config.smtpHost ||
    !config.smtpUsername ||
    !config.smtpPassword ||
    !Number.isInteger(config.smtpPort)
  ) {
    throw new Error('email_transport_not_configured')
  }

  return config
}

function createTransport(config: PortalEmailConfig) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    requireTLS: config.smtpRequireTls,
    auth: {
      user: config.smtpUsername,
      pass: config.smtpPassword,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })
}

export async function verifyPortalEmailTransport(service: ServiceClient, organizationId: string): Promise<void> {
  const config = await getPortalEmailConfig(service, organizationId)
  const transport = createTransport(config)
  await transport.verify()
  transport.close()
}

export async function sendPortalEmail(service: ServiceClient, organizationId: string, mail: PortalMail): Promise<void> {
  const config = await getPortalEmailConfig(service, organizationId)
  const transport = createTransport(config)
  const prefix = config.subjectPrefix.trim()
  const subject = prefix ? `${prefix} ${mail.subject}` : mail.subject

  await transport.sendMail({
    from: { name: config.senderName, address: config.senderEmail },
    replyTo: config.replyToEmail ? { address: config.replyToEmail } : undefined,
    to: mail.to,
    subject,
    text: mail.text,
    html: mail.html,
  })

  transport.close()
}
