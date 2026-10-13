import { useEffect, useState } from 'react'
import type { AuthMethod, ConnectOptions, ConnectResult } from '@shared/types'
import { api, errMsg } from '../util'

const STORAGE_KEY = 'last-connection'

/** Lembra host/usuário/porta/chave — nunca senha ou passphrase. */
function loadLast(): Partial<ConnectOptions> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveLast(o: ConnectOptions): void {
  const { password: _p, passphrase: _pp, ...safe } = o
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe))
  } catch {
    /* sem storage: só não lembra */
  }
}

/** Aceita "usuario@host:porta" colado no campo host. */
function parseTarget(raw: string): { host: string; user?: string; port?: number } {
  let host = raw.trim()
  let user: string | undefined
  let port: number | undefined
  const at = host.lastIndexOf('@')
  if (at >= 0) {
    user = host.slice(0, at)
    host = host.slice(at + 1)
  }
  const m = /^(.*):(\d+)$/.exec(host)
  if (m && !m[1].includes(':')) {
    host = m[1]
    port = Number(m[2])
  }
  return { host, user, port }
}

export function ConnectForm(props: {
  notice: string | null
  onConnected(opts: ConnectOptions, result: ConnectResult): void
}): React.JSX.Element {
  const last = loadLast()
  const [host, setHost] = useState(last.host ?? '')
  const [port, setPort] = useState(String(last.port ?? 22))
  const [username, setUsername] = useState(last.username ?? '')
  const [auth, setAuth] = useState<AuthMethod>(last.auth ?? 'password')
  const [password, setPassword] = useState('')
  const [keyPath, setKeyPath] = useState(last.keyPath ?? '')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(props.notice)

  useEffect(() => {
    if (!keyPath) api.defaultKeyPath().then((p) => p && setKeyPath(p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const t = parseTarget(host)
    const opts: ConnectOptions = {
      host: t.host,
      port: t.port ?? (Number(port) || 22),
      username: t.user ?? username.trim(),
      auth,
      password: auth === 'password' ? password : undefined,
      keyPath: auth === 'key' ? keyPath : undefined,
      passphrase: auth === 'key' ? passphrase : undefined
    }
    if (!opts.host || !opts.username) {
      setError('Informe host e usuário')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.connect(opts)
      saveLast(opts)
      props.onConnected(opts, result)
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="connect-screen">
      <form className="connect-card" onSubmit={submit}>
        <h1>SSH Explorer</h1>
        <p className="muted">Uma conexão SSH, porta 22: arquivos, transferências e terminal.</p>

        <div className="hstack">
          <label className="field grow">
            <span>Host</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="servidor.com ou user@ip:porta"
              autoFocus
              spellCheck={false}
            />
          </label>
          <label className="field port">
            <span>Porta</span>
            <input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} />
          </label>
        </div>

        <label className="field">
          <span>Usuário</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} />
        </label>

        <div className="segmented" role="radiogroup" aria-label="Autenticação">
          {(
            [
              ['password', 'Senha'],
              ['key', 'Chave'],
              ['agent', 'ssh-agent']
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              role="radio"
              aria-checked={auth === value}
              className={auth === value ? 'active' : ''}
              onClick={() => setAuth(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {auth === 'password' && (
          <label className="field">
            <span>Senha</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}

        {auth === 'key' && (
          <>
            <label className="field">
              <span>Chave privada</span>
              <div className="hstack">
                <input className="grow" value={keyPath} onChange={(e) => setKeyPath(e.target.value)} spellCheck={false} />
                <button
                  type="button"
                  onClick={async () => {
                    const picked = await api.pickKeyFile()
                    if (picked) setKeyPath(picked)
                  }}
                >
                  Procurar…
                </button>
              </div>
            </label>
            <label className="field">
              <span>Passphrase (se tiver)</span>
              <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            </label>
          </>
        )}

        {auth === 'agent' && (
          <p className="muted small">
            Usa as chaves carregadas no agente do OpenSSH do Windows (<code>ssh-add</code>).
          </p>
        )}

        {error && <div className="error">{error}</div>}

        <button className="primary big" type="submit" disabled={busy}>
          {busy ? 'Conectando…' : 'Conectar'}
        </button>
      </form>
    </div>
  )
}
