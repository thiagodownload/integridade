import { useState, type FormEvent } from 'react'
import { ArrowLeft, KeyRound, LoaderCircle, Mail, ShieldCheck } from 'lucide-react'
import { supabase, supabaseConfigured } from '../lib/supabase'

export function StaffLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [recovering, setRecovering] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')

    if (!supabaseConfigured || !supabase) {
      setError('O ambiente ainda não possui a configuração pública do Supabase.')
      return
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password) {
      setError('Informe e-mail e senha.')
      return
    }

    setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })
    setLoading(false)

    if (signInError) {
      setError('Não foi possível entrar. Confira as credenciais ou procure o administrador do canal.')
    }
  }

  async function handleRecovery() {
    setError('')
    setNotice('')

    if (!supabaseConfigured || !supabase) {
      setError('O ambiente ainda não possui a configuração pública do Supabase.')
      return
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Informe seu e-mail corporativo para solicitar a recuperação.')
      return
    }

    setRecovering(true)
    const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/auth/ativar`,
    })
    setRecovering(false)

    if (recoveryError) {
      setError('Não foi possível solicitar a recuperação agora. Tente novamente mais tarde ou procure o administrador do canal.')
      return
    }

    setNotice('Se a conta estiver autorizada, você receberá um e-mail com o link para definir uma nova senha.')
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="staff-login-title">
        <a className="auth-back" href="#/"><ArrowLeft size={17} /> Voltar ao portal</a>

        <div className="auth-brand">
          <span className="brand-icon"><ShieldCheck size={22} /></span>
          <div><strong>Integridade</strong><small>Área interna protegida</small></div>
        </div>

        <div className="auth-heading">
          <span className="eyebrow">Acesso administrativo</span>
          <h1 id="staff-login-title">Entrar na área interna</h1>
          <p>Use apenas a conta corporativa autorizada. O acesso aos relatos continua limitado por função, atribuição e regras de confidencialidade.</p>
        </div>

        {!supabaseConfigured && (
          <div className="auth-warning" role="status">
            A configuração pública do Supabase ainda não foi aplicada neste ambiente. Nenhuma credencial deve ser colocada diretamente no código.
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>E-mail</span>
            <input
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nome@empresa.com.br"
              disabled={loading || recovering}
            />
          </label>

          <label className="field">
            <span>Senha</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading || recovering}
            />
          </label>

          <button className="auth-recovery-link" type="button" onClick={handleRecovery} disabled={loading || recovering}>
            {recovering ? <LoaderCircle className="spin" size={16} /> : <Mail size={16} />}
            {recovering ? 'Enviando recuperação...' : 'Esqueci minha senha'}
          </button>

          {error && <div className="auth-error" role="alert">{error}</div>}
          {notice && <div className="auth-notice" role="status">{notice}</div>}

          <button className="button primary auth-submit" type="submit" disabled={loading || recovering || !supabaseConfigured}>
            {loading ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
            {loading ? 'Validando acesso...' : 'Entrar com segurança'}
          </button>
        </form>

        <div className="auth-security-note">
          <ShieldCheck size={18} />
          <p>Não existe cadastro público para a área interna. Contas, papéis e permissões são administrados separadamente.</p>
        </div>
      </section>
    </main>
  )
}
