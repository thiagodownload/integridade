import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound, LoaderCircle, LogOut, ShieldCheck, Smartphone } from 'lucide-react'
import { supabase } from '../lib/supabase'

type MfaMode = 'loading' | 'enroll' | 'challenge' | 'success' | 'error'

interface EnrollmentData {
  factorId: string
  qrCode: string
  secret: string
}

interface MfaGateProps {
  onVerified: () => void
}

function normalizeCode(value: string) {
  return value.replace(/\D/g, '').slice(0, 6)
}

export function MfaGate({ onVerified }: MfaGateProps) {
  const [mode, setMode] = useState<MfaMode>('loading')
  const [verifiedFactorId, setVerifiedFactorId] = useState('')
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) {
      setMode('error')
      setError('O serviço de autenticação não está disponível neste ambiente.')
      return
    }

    let active = true
    const client = supabase

    async function loadState() {
      const aalResult = await client.auth.mfa.getAuthenticatorAssuranceLevel()
      if (!active) return

      if (aalResult.error) {
        setMode('error')
        setError('Não foi possível validar o nível de segurança da sessão.')
        return
      }

      if (aalResult.data.currentLevel === 'aal2') {
        setMode('success')
        onVerified()
        return
      }

      const factorsResult = await client.auth.mfa.listFactors()
      if (!active) return

      if (factorsResult.error) {
        setMode('error')
        setError('Não foi possível consultar os fatores de autenticação da conta.')
        return
      }

      const factor = factorsResult.data.totp[0]
      if (factor) {
        setVerifiedFactorId(factor.id)
        setMode('challenge')
        return
      }

      setMode('enroll')
    }

    void loadState()
    return () => {
      active = false
    }
  }, [onVerified])

  async function startEnrollment() {
    if (!supabase || busy) return

    setBusy(true)
    setError('')

    const factorsResult = await supabase.auth.mfa.listFactors()
    if (factorsResult.error) {
      setBusy(false)
      setError('Não foi possível preparar o segundo fator. Tente novamente.')
      return
    }

    const staleFactors = factorsResult.data.all.filter(
      (factor) => factor.factor_type === 'totp' && factor.status === 'unverified',
    )

    for (const factor of staleFactors) {
      await supabase.auth.mfa.unenroll({ factorId: factor.id })
    }

    const enrollResult = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Canal de Integridade',
    })

    setBusy(false)

    if (enrollResult.error || !enrollResult.data.totp) {
      setError('Não foi possível iniciar a configuração do autenticador. Verifique se MFA está habilitado no Supabase Auth.')
      return
    }

    setEnrollment({
      factorId: enrollResult.data.id,
      qrCode: enrollResult.data.totp.qr_code,
      secret: enrollResult.data.totp.secret,
    })
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return

    const normalized = normalizeCode(code)
    if (normalized.length !== 6) {
      setError('Informe o código de 6 dígitos exibido no aplicativo autenticador.')
      return
    }

    const factorId = enrollment?.factorId || verifiedFactorId
    if (!factorId) {
      setError('Nenhum fator MFA válido foi encontrado para esta sessão.')
      return
    }

    setBusy(true)
    setError('')

    const verifyResult = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: normalized,
    })

    if (verifyResult.error) {
      setBusy(false)
      setCode('')
      setError('Código inválido ou expirado. Aguarde o próximo código do autenticador e tente novamente.')
      return
    }

    const aalResult = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    setBusy(false)

    if (aalResult.error || aalResult.data.currentLevel !== 'aal2') {
      setError('O segundo fator foi validado, mas a sessão ainda não alcançou o nível AAL2. Entre novamente e tente outra vez.')
      return
    }

    setMode('success')
    onVerified()
  }

  async function signOut() {
    await supabase?.auth.signOut()
    window.location.hash = '/'
  }

  if (mode === 'loading' || mode === 'success') {
    return (
      <main className="auth-page">
        <div className="auth-state-card" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={26} />
          <strong>{mode === 'success' ? 'Segundo fator confirmado' : 'Validando autenticação multifator'}</strong>
          <span>{mode === 'success' ? 'Liberando a área interna com sessão AAL2.' : 'Conferindo os fatores cadastrados para esta conta.'}</span>
        </div>
      </main>
    )
  }

  if (mode === 'error') {
    return (
      <main className="auth-page">
        <section className="auth-state-card denied" aria-labelledby="mfa-error-title">
          <span className="auth-state-icon"><KeyRound size={28} /></span>
          <strong id="mfa-error-title">Não foi possível validar o MFA</strong>
          <span>{error}</span>
          <div className="auth-state-actions">
            <button className="button secondary" type="button" onClick={signOut}><LogOut size={17} /> Sair da conta</button>
          </div>
        </section>
      </main>
    )
  }

  const enrolling = mode === 'enroll' && enrollment
  const title = mode === 'challenge' ? 'Confirme seu segundo fator' : 'Proteja sua conta com MFA'

  return (
    <main className="auth-page">
      <section className="auth-card mfa-card" aria-labelledby="mfa-title">
        <div className="auth-brand">
          <span className="brand-icon"><ShieldCheck size={22} /></span>
          <div><strong>Integridade</strong><small>Autenticação multifator obrigatória</small></div>
        </div>

        <div className="auth-heading">
          <span className="eyebrow">Segurança da área interna</span>
          <h1 id="mfa-title">{title}</h1>
          <p>
            {mode === 'challenge'
              ? 'Abra o aplicativo autenticador vinculado a esta conta e informe o código atual.'
              : 'A área interna exige um segundo fator. Use um aplicativo autenticador compatível com TOTP para concluir a configuração.'}
          </p>
        </div>

        {mode === 'enroll' && !enrollment && (
          <div className="mfa-intro">
            <div className="mfa-feature"><Smartphone size={20} /><span>O código muda periodicamente e é solicitado após a senha.</span></div>
            <div className="mfa-feature"><ShieldCheck size={20} /><span>Sem uma sessão AAL2, Administração e Operações permanecem bloqueadas.</span></div>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="button primary auth-submit" type="button" disabled={busy} onClick={startEnrollment}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
              {busy ? 'Preparando MFA...' : 'Configurar autenticador'}
            </button>
          </div>
        )}

        {enrolling && (
          <div className="mfa-enrollment">
            <div className="mfa-qr-wrap">
              <img src={enrollment.qrCode} alt="QR Code para cadastrar o Canal de Integridade no aplicativo autenticador" />
            </div>
            <div className="mfa-manual">
              <strong>Se não conseguir ler o QR Code</strong>
              <span>Cadastre manualmente esta chave no aplicativo autenticador:</span>
              <code>{enrollment.secret}</code>
            </div>
            <div className="auth-warning">Não compartilhe o QR Code, a chave manual ou códigos temporários. Eles funcionam como parte da credencial da sua conta.</div>
          </div>
        )}

        {(mode === 'challenge' || enrolling) && (
          <form className="auth-form" onSubmit={verifyCode}>
            <label className="field">
              <span>Código do autenticador</span>
              <input
                className="mfa-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(normalizeCode(event.target.value))}
                placeholder="000000"
                disabled={busy}
                autoFocus
              />
            </label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="button primary auth-submit" type="submit" disabled={busy || code.length !== 6}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
              {busy ? 'Validando código...' : 'Confirmar e continuar'}
            </button>
          </form>
        )}

        <div className="auth-security-note">
          <ShieldCheck size={18} />
          <p>A senha sozinha concede apenas AAL1. O conteúdo interno só é liberado após o segundo fator elevar a sessão para AAL2.</p>
        </div>

        <button className="mfa-signout" type="button" onClick={signOut}><LogOut size={16} /> Sair e usar outra conta</button>
      </section>
    </main>
  )
}
