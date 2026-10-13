// Conexões salvas em %APPDATA%/ssh-explorer/connections.json.
// Senhas/passphrases são criptografadas com safeStorage (DPAPI no Windows, Keychain no macOS,
// libsecret no Linux) e nunca saem do processo main.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, safeStorage } from 'electron'
import type { ConnectOptions, SaveConnectionRequest, SavedConnection } from '@shared/types'

interface Stored extends Omit<SavedConnection, 'hasSecret'> {
  /** base64 do safeStorage.encryptString: senha (auth=password) ou passphrase (auth=key) */
  secret?: string
}

const file = (): string => path.join(app.getPath('userData'), 'connections.json')

function load(): Stored[] {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'))
  } catch {
    return []
  }
}

function persist(list: Stored[]): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  // Grava em arquivo temporário e renomeia: um crash no meio não corrompe a lista.
  const tmp = file() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2))
  fs.renameSync(tmp, file())
}

const toPublic = ({ secret, ...rest }: Stored): SavedConnection => ({ ...rest, hasSecret: !!secret })

export const canRememberSecrets = (): boolean => safeStorage.isEncryptionAvailable()

export function listSaved(): SavedConnection[] {
  return load()
    .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0) || a.name.localeCompare(b.name))
    .map(toPublic)
}

export function saveConnection(req: SaveConnectionRequest): SavedConnection {
  const list = load()
  const { opts } = req
  const prev = req.id ? list.find((c) => c.id === req.id) : undefined
  const typed = opts.auth === 'password' ? opts.password : opts.auth === 'key' ? opts.passphrase : undefined

  let secret: string | undefined
  if (req.rememberSecret && opts.auth !== 'agent' && canRememberSecrets()) {
    if (typed) secret = safeStorage.encryptString(typed).toString('base64')
    // Campo vazio na edição: mantém a senha antiga, desde que o tipo de auth não tenha mudado.
    else if (prev?.auth === opts.auth) secret = prev.secret
  }

  const entry: Stored = {
    id: prev?.id ?? randomUUID(),
    name: req.name.trim() || `${opts.username}@${opts.host}`,
    host: opts.host,
    port: opts.port,
    username: opts.username,
    auth: opts.auth,
    keyPath: opts.auth === 'key' ? opts.keyPath : undefined,
    secret,
    lastUsed: prev?.lastUsed
  }
  persist(prev ? list.map((c) => (c.id === prev.id ? entry : c)) : [...list, entry])
  return toPublic(entry)
}

export function deleteSaved(id: string): void {
  persist(load().filter((c) => c.id !== id))
}

/** Monta as opções de conexão com a senha descriptografada. */
export function resolveSaved(id: string): ConnectOptions {
  const c = load().find((x) => x.id === id)
  if (!c) throw new Error('Conexão salva não encontrada')
  const secret = c.secret ? safeStorage.decryptString(Buffer.from(c.secret, 'base64')) : undefined
  return {
    host: c.host,
    port: c.port,
    username: c.username,
    auth: c.auth,
    keyPath: c.keyPath,
    password: c.auth === 'password' ? secret : undefined,
    passphrase: c.auth === 'key' ? secret : undefined
  }
}

export function touch(id: string): void {
  const list = load()
  const c = list.find((x) => x.id === id)
  if (!c) return
  c.lastUsed = Date.now()
  persist(list)
}
