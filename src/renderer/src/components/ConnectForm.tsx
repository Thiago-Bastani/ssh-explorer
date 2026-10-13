import { useEffect, useRef, useState } from 'react'
import type { AuthMethod, ConnectOptions, ConnectResult, SavedConnection } from '@shared/types'
import { Modal } from './Modal'
import { api, errMsg } from '../util'

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

const label = (c: { username: string; host: string; port: number }): string =>
  `${c.username}@${c.host}${c.port !== 22 ? `:${c.port}` : ''}`

const AUTH_LABEL: Record<AuthMethod, string> = { password: 'senha', key: 'chave', agent: 'ssh-agent' }

export function ConnectForm(props: {
  notice: string | null
  onConnected(opts: ConnectOptions, result: ConnectResult): void
}): React.JSX.Element {
  const [saved, setSaved] = useState<SavedConnection[]>([])
  const [canEncrypt, setCanEncrypt] = useState(true)
  const [editing, setEditing] = useState<SavedConnection | null>(null)

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [auth, setAuth] = useState<AuthMethod>('password')
  const [password, setPassword] = useState('')
  const [keyPath, setKeyPath] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [save, setSave] = useState(true)
  const [remember, setRemember] = useState(true)

  const [busy, setBusy] = useState<string | null>(null) // id da conexão ou 'form'
  const [error, setError] = useState<string | null>(props.notice)
  const [confirmDelete, setConfirmDelete] = useState<SavedConnection | null>(null)
  const secretInput = useRef<HTMLInputElement>(null)
  const defaultKey = useRef('')

  const reload = async (): Promise<SavedConnection[]> => {
    const list = await api.listSaved()
    setSaved(list)
    return list
  }

  useEffect(() => {
    reload()
    api.canRememberSecrets().then(setCanEncrypt)
    api.defaultKeyPath().then((p) => {
      defaultKey.current = p ?? ''
      setKeyPath((k) => k || defaultKey.current)
    })
  }, [])

  const fillForm = (c: SavedConnection | null): void => {
    setEditing(c)
    setName(c?.name ?? '')
    setHost(c?.host ?? '')
    setPort(String(c?.port ?? 22))
    setUsername(c?.username ?? '')
    setAuth(c?.auth ?? 'password')
    setKeyPath(c?.keyPath || defaultKey.current)
    setPassword('')
    setPassphrase('')
    setSave(true)
    setRemember(c ? c.hasSecret || c.auth === 'agent' : true)
    setError(null)
  }

  const finish = (c: { username: string; host: string; port: number; auth: AuthMethod }, result: ConnectResult): void =>
    props.onConnected({ host: c.host, port: c.port, username: c.username, auth: c.auth }, result)

  /** Clique numa conexão salva: conecta direto se tiver tudo que precisa. */
  const quickConnect = async (c: SavedConnection): Promise<void> => {
    if (c.auth === 'password' && !c.hasSecret) {
      fillForm(c)
      setError('Digite a senha para conectar')
      setTimeout(() => secretInput.current?.focus())
      return
    }
    setBusy(c.id)
    setError(null)
    try {
      finish(c, await api.connectSaved(c.id))
    } catch (err) {
      // Senha mudou, chave sumiu etc.: abre no formulário para corrigir.
      fillForm(c)
      setError(errMsg(err))
    } finally {
      setBusy(null)
    }
  }

  const buildOpts = (): ConnectOptions => {
    const t = parseTarget(host)
    return {
      host: t.host,
      port: t.port ?? (Number(port) || 22),
      username: t.user ?? username.trim(),
      auth,
      password: auth === 'password' ? password : undefined,
      keyPath: auth === 'key' ? keyPath : undefined,
      passphrase: auth === 'key' ? passphrase : undefined
    }
  }

  const persist = (opts: ConnectOptions): Promise<SavedConnection> =>
    api.saveConnection({ id: editing?.id, name, opts, rememberSecret: remember })

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const opts = buildOpts()
    if (!opts.host || !opts.username) {
      setError('Informe host e usuário')
      return
    }
    setBusy('form')
    setError(null)
    try {
      const typedSecret = auth === 'password' ? password : auth === 'key' ? passphrase : ''
      if (save && editing?.hasSecret && editing.auth === auth && !typedSecret && remember) {
        // Editando sem redigitar a senha: grava as mudanças e usa a senha guardada.
        const c = await persist(opts)
        await reload()
        finish(c, await api.connectSaved(c.id))
      } else {
        const result = await api.connect(opts)
        // Só salva depois de conectar com sucesso, para não guardar senha errada.
        if (save) await persist(opts)
        finish(opts, result)
      }
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(null)
    }
  }

  const saveOnly = async (): Promise<void> => {
    const opts = buildOpts()
    if (!opts.host || !opts.username) {
      setError('Informe host e usuário')
      return
    }
    try {
      const c = await persist(opts)
      const list = await reload()
      fillForm(list.find((x) => x.id === c.id) ?? c)
    } catch (err) {
      setError(errMsg(err))
    }
  }

  const secretPlaceholder =
    editing?.hasSecret && editing.auth === auth ? '•••••••• salva — deixe vazio para manter' : ''

  return (
    <div className="connect-screen">
      <div className="connect-layout">
        <aside className="saved-list">
          <div className="saved-head">
            <b>Conexões</b>
            <button className="link" onClick={() => fillForm(null)}>
              ＋ Nova
            </button>
          </div>
          {saved.length === 0 && <p className="muted small saved-empty">Nenhuma conexão salva ainda.</p>}
          {saved.map((c) => (
            <div
              key={c.id}
              className={`saved-item ${editing?.id === c.id ? 'active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => quickConnect(c)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && quickConnect(c)}
              title="Clique para conectar"
            >
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis">{c.name}</div>
                <div className="muted small ellipsis">
                  {label(c)} · {AUTH_LABEL[c.auth]}
                  {c.hasSecret && ' 🔒'}
                </div>
              </div>
              {busy === c.id ? (
                <span className="muted small">conectando…</span>
              ) : (
                <span className="saved-actions">
                  <button
                    className="icon"
                    title="Editar"
                    onClick={(e) => {
                      e.stopPropagation()
                      fillForm(c)
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="icon"
                    title="Excluir"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmDelete(c)
                    }}
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
          ))}
        </aside>

        <form className="connect-card" onSubmit={submit}>
          <h1>{editing ? `Editar: ${editing.name}` : 'Nova conexão'}</h1>

          <label className="field">
            <span>Nome (opcional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Produção, Raspberry…" />
          </label>

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
            ).map(([value, text]) => (
              <button
                type="button"
                key={value}
                role="radio"
                aria-checked={auth === value}
                className={auth === value ? 'active' : ''}
                onClick={() => setAuth(value)}
              >
                {text}
              </button>
            ))}
          </div>

          {auth === 'password' && (
            <label className="field">
              <span>Senha</span>
              <input
                ref={secretInput}
                type="password"
                value={password}
                placeholder={secretPlaceholder}
                onChange={(e) => setPassword(e.target.value)}
              />
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
                <input
                  ref={secretInput}
                  type="password"
                  value={passphrase}
                  placeholder={secretPlaceholder}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </label>
            </>
          )}

          {auth === 'agent' && (
            <p className="muted small">
              Usa as chaves carregadas no agente do OpenSSH do Windows (<code>ssh-add</code>).
            </p>
          )}

          <div className="checks">
            <label className="toggle">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
              Salvar conexão
            </label>
            {auth !== 'agent' && (
              <label
                className="toggle"
                title={
                  canEncrypt
                    ? 'Criptografada pelo Windows (DPAPI), só seu usuário consegue ler'
                    : 'Criptografia do sistema indisponível'
                }
              >
                <input
                  type="checkbox"
                  checked={remember && canEncrypt}
                  disabled={!save || !canEncrypt}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Lembrar {auth === 'password' ? 'senha' : 'passphrase'}
              </label>
            )}
          </div>

          {error && <div className="error">{error}</div>}

          <div className="hstack">
            {save && (
              <button type="button" onClick={saveOnly} disabled={!!busy}>
                Só salvar
              </button>
            )}
            <button className="primary big grow" type="submit" disabled={!!busy}>
              {busy === 'form' ? 'Conectando…' : 'Conectar'}
            </button>
          </div>
        </form>
      </div>

      {confirmDelete && (
        <Modal
          title="Excluir conexão"
          onClose={() => setConfirmDelete(null)}
          actions={
            <>
              <button onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button
                className="danger"
                autoFocus
                onClick={async () => {
                  const c = confirmDelete
                  setConfirmDelete(null)
                  await api.deleteSaved(c.id)
                  if (editing?.id === c.id) fillForm(null)
                  reload()
                }}
              >
                Excluir
              </button>
            </>
          }
        >
          <p>
            Remover <b>{confirmDelete.name}</b> ({label(confirmDelete)}) e a senha salva?
          </p>
        </Modal>
      )}
    </div>
  )
}
