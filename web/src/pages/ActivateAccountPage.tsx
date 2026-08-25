import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'
import { supabase, supabaseConfigured } from '../lib/supabase'
import './activate-account.css'

type State = 'checking' | 'ready' | 'invalid' | 'saving' | 'success'

export function ActivateAccountPage() {
  const [state, setState] = useState<State>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setMessage('A aplicação não está conectada ao serviço de autenticação.')
      setState('invalid')
      return
    }

    const client = supabase
    let active = true

    async function checkSession() {
      const { data, error } = await client.auth.getSession()
      if (!active) return

      if (error || !data.session) {
        setMessage('O link de ativação é inválido, expirou ou já foi utilizado. Solicite um novo convite ao administrador do canal.')
        setState('invalid')
        return
      }

      setState('ready')
    }

    const timeout = window.setTimeout(() => void checkSession(), 250)
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (session && (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY' || event === 'INITIAL_SESSION')) {
        setState('ready')
      }
    })

    return () => {
      active = false
      window.clearTimeout(timeout)
      listener.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')

    if (!supabase) return
    if (password.length < 12) {
      setMessage('Use uma senha com pelo menos 12 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setMessage('As senhas informadas não são iguais.')
      return
    }

    setState('saving')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setMessage('Não foi possível definir a senha. O link pode ter expirado; solicite um novo convite.')
      setState('ready')
      return
    }

    setState('success')
    window.setTimeout(() => window.location.replace('/#/admin'), 700)
  }

  return (
    <main className="activate-page">
      <section className="activate-card" aria-labelledby="activate-title">
        <div className="activate-brand">
          <span className="brand-icon"><ShieldCheck size={22} /></span>
          <div><strong>Canal de Integridade</strong><small>Ativação de acesso interno</small></div>
        </div>

        {state === 'checking' && (
          <div className="activate-state" role="status">
            <LoaderCircle className="spin" size={30} />
            <h1 id="activate-title">Validando convite</h1>
            <p>Conferindo a sessão de ativação antes de permitir a definição da senha.</p>
          </div>
        )}

        {state === 'invalid' && (
          <div className="activate-state">
            <KeyRound size={30} />
            <h1 id="activate-title">Não foi possível ativar</h1>
            <p>{message}</p>
            <a className="button secondary" href="/#/">Voltar ao portal</a>
          </div>
        )}

        {(state === 'ready' || state === 'saving') && (
          <form className="activate-form" onSubmit={handleSubmit}>
            <span className="eyebrow">Primeiro acesso</span>
            <h1 id="activate-title">Defina sua senha</h1>
            <p>Esta senha será usada somente na área interna. O acesso continuará limitado pelos papéis cadastrados no Supabase.</p>

            <label className="field">
              <span>Nova senha</span>
              <input autoComplete="new-password" minLength={12} onChange={(e) => setPassword(e.target.value)} required type="password" value={password} />
              <small>Mínimo de 12 caracteres.</small>
            </label>
            <label className="field">
              <span>Confirmar nova senha</span>
              <input autoComplete="new-password" minLength={12} onChange={(e) => setConfirmPassword(e.target.value)} required type="password" value={confirmPassword} />
            </label>

            {message && <div className="activate-error" role="alert">{message}</div>}

            <button className="button primary activate-submit" disabled={state === 'saving'} type="submit">
              {state === 'saving' ? <><LoaderCircle className="spin" size={18} /> Salvando...</> : <><KeyRound size={18} /> Ativar acesso</>}
            </button>
          </form>
        )}

        {state === 'success' && (
          <div className="activate-state success" role="status">
            <CheckCircle2 size={34} />
            <h1 id="activate-title">Acesso ativado</h1>
            <p>Senha definida com sucesso. Redirecionando para a Administração.</p>
          </div>
        )}
      </section>
    </main>
  )
}
