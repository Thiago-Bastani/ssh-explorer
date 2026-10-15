import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import type { ConnectOptions, ConnectResult, RemoteEntry, SudoResult, TransferProgress } from '@shared/types'
import { SftpBackend, ScpBackend, rjoin, withErrorLog, type FileBackend, type LogFn } from './backends'

export interface SessionEvents {
  /** Pergunta ao usuário se confia no host key. */
  verifyHostKey(fingerprint: string): Promise<boolean>
  termData(data: string): void
  transfer(t: TransferProgress): void
  log: LogFn
  disconnected(reason: string): void
}

/** Fingerprint no mesmo formato do OpenSSH: SHA256:base64-sem-padding */
const fingerprintOf = (key: Buffer): string =>
  'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')

export class Session {
  private conn = new Client()
  private backend!: FileBackend
  /** Backend sem sudo (sftp, ou scp se o servidor não tem sftp). */
  private baseBackend!: FileBackend
  /** Senha do login, reaproveitada como senha do sudo. Só em memória. */
  private loginPassword?: string
  private shell: ClientChannel | null = null
  private closedByUser = false

  constructor(private events: SessionEvents) {}

  private log: LogFn = (kind, text) => this.events.log(kind, text)

  connect(opts: ConnectOptions): Promise<ConnectResult> {
    const config: ConnectConfig = {
      host: opts.host,
      port: opts.port,
      username: opts.username,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
      hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
        this.events.verifyHostKey(fingerprintOf(key)).then(verify, () => verify(false))
      }
    }

    if (opts.auth === 'password') {
      config.password = opts.password
      this.loginPassword = opts.password
      // Muitos servidores pedem senha via keyboard-interactive em vez de "password".
      config.tryKeyboard = true
      this.conn.on('keyboard-interactive', (_n, _i, _l, prompts, finish) =>
        finish(prompts.map(() => opts.password ?? ''))
      )
    } else if (opts.auth === 'key') {
      if (!opts.keyPath) throw new Error('Informe o arquivo da chave privada')
      config.privateKey = fs.readFileSync(opts.keyPath)
      config.passphrase = opts.passphrase || undefined
    } else {
      config.agent =
        process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK
    }

    return new Promise((resolve, reject) => {
      let ready = false
      this.conn.once('error', (err) => {
        if (!ready) reject(new Error(humanize(err)))
      })
      this.conn.on('close', () => {
        if (ready && !this.closedByUser) this.events.disconnected('Conexão encerrada pelo servidor')
      })
      this.conn.once('ready', () => {
        ready = true
        this.conn.on('error', (err) => this.events.disconnected(humanize(err)))
        this.conn.sftp(async (err, sftp) => {
          // Sem subsistema sftp no servidor → cai para scp/exec, ainda na mesma conexão.
          this.backend = this.baseBackend = err ? new ScpBackend(this.conn, this.log) : new SftpBackend(sftp, this.log)
          this.backend = this.baseBackend = withErrorLog(this.baseBackend, this.log)
          try {
            resolve({ home: await this.backend.home(), transport: this.backend.kind })
          } catch (e) {
            reject(e)
          }
        })
      })
      try {
        this.conn.connect(config)
      } catch (e) {
        reject(e)
      }
    })
  }

  close(): void {
    this.closedByUser = true
    this.shell?.close()
    this.conn.end()
  }

  // --- Sudo -----------------------------------------------------------------
  // SFTP sempre roda como o usuário logado, então com sudo as operações de arquivo
  // passam pelo ScpBackend (comandos via exec), cada um prefixado com sudo.

  async setSudo(enabled: boolean, password?: string): Promise<SudoResult> {
    if (!enabled) {
      this.backend = this.baseBackend
      return { ok: true }
    }

    // 1) NOPASSWD? Então nem precisa de senha.
    const probe = await this.execStatus('sudo -n true')
    if (probe.code === 0) {
      this.backend = withErrorLog(new ScpBackend(this.conn, this.log, {}), this.log)
      return { ok: true }
    }
    if (probe.code === 127 || /not found/i.test(probe.stderr)) {
      return { ok: false, needPassword: false, error: 'sudo não está instalado no servidor' }
    }
    if (/not in the sudoers|not allowed/i.test(probe.stderr)) {
      return { ok: false, needPassword: false, error: 'Este usuário não tem permissão de sudo no servidor' }
    }

    // 2) Precisa de senha: a digitada agora, ou a do login.
    const pw = password ?? this.loginPassword
    if (pw === undefined) return { ok: false, needPassword: true }

    // stdin fechado logo após a senha: se estiver errada, o sudo não fica esperando outra.
    const check = await this.execStatus("sudo -S -k -p '' -- true", pw + '\n')
    if (check.code === 0) {
      this.backend = withErrorLog(new ScpBackend(this.conn, this.log, { password: pw }), this.log)
      return { ok: true }
    }
    if (/not in the sudoers|not allowed/i.test(check.stderr)) {
      return { ok: false, needPassword: false, error: 'Este usuário não tem permissão de sudo no servidor' }
    }
    if (/tty/i.test(check.stderr)) {
      return { ok: false, needPassword: false, error: 'O sudo deste servidor exige um terminal (requiretty)' }
    }
    // Senha do login não serviu: pede para o usuário. Senha digitada errada: avisa.
    return { ok: false, needPassword: true, error: password !== undefined ? 'Senha do sudo incorreta' : undefined }
  }

  /** Roda um comando avulso e devolve exit code + stderr (sem rejeitar). */
  private async execStatus(cmd: string, stdin?: string): Promise<{ code: number | null; stderr: string }> {
    this.log('exec', cmd) // a senha (stdin) não entra no log
    const ch = await new Promise<ClientChannel>((resolve, reject) =>
      this.conn.exec(cmd, (err, c) => (err ? reject(err) : resolve(c)))
    )
    return new Promise((resolve) => {
      let code: number | null = null
      const err: Buffer[] = []
      ch.on('data', () => {})
      ch.stderr.on('data', (d: Buffer) => err.push(d))
      ch.on('exit', (c: number | null) => (code = c))
      ch.on('close', () => {
        const stderr = Buffer.concat(err).toString('utf8')
        if (code !== 0) this.log('exec', `✗ saiu com código ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`, true)
        resolve({ code, stderr })
      })
      if (stdin) ch.write(stdin)
      ch.end()
    })
  }

  list(dir: string): Promise<RemoteEntry[]> {
    return this.backend.list(dir)
  }
  mkdir(dir: string): Promise<void> {
    return this.backend.mkdir(dir)
  }
  rename(from: string, to: string): Promise<void> {
    return this.backend.rename(from, to)
  }
  remove(target: string, isDir: boolean): Promise<void> {
    return this.backend.remove(target, isDir)
  }

  // --- Terminal --------------------------------------------------------------

  startShell(cols: number, rows: number): Promise<void> {
    this.shell?.close()
    return new Promise((resolve, reject) => {
      this.conn.shell({ term: 'xterm-256color', cols, rows }, (err, ch) => {
        if (err) return reject(err)
        this.shell = ch
        ch.setEncoding('utf8')
        ch.stderr.setEncoding('utf8')
        ch.on('data', (d: string) => this.events.termData(d))
        ch.stderr.on('data', (d: string) => this.events.termData(d))
        ch.on('close', () => {
          if (this.shell === ch) {
            this.shell = null
            this.events.termData('\r\n\x1b[90m[sessão do terminal encerrada]\x1b[0m\r\n')
          }
        })
        resolve()
      })
    })
  }

  termWrite(data: string): void {
    this.shell?.write(data)
  }

  termResize(cols: number, rows: number): void {
    this.shell?.setWindow(rows, cols, 0, 0)
  }

  // --- Transferências --------------------------------------------------------

  /** Envia arquivos e pastas locais (recursivo) para remoteDir. */
  async upload(localPaths: string[], remoteDir: string): Promise<void> {
    await Promise.all(
      localPaths.map((local) =>
        this.transfer('upload', path.basename(local), async (report) => {
          const b = this.backend // ligar/desligar o sudo no meio não troca o backend da transferência
          const plan = await planLocal(local, rjoin(remoteDir, path.basename(local)))
          report.total(plan.bytes)
          const limit = concurrencyFor(b)
          // Pastas por nível (pai antes do filho), cada nível em paralelo.
          for (const level of groupByDepth(plan.dirs))
            await pool(level, limit, (dir) => b.mkdir(dir).catch(() => {})) // já existe: ok
          await pool(plan.files, limit, (f) => b.uploadFile(f.local, f.remote, report.add))
        })
      )
    )
  }

  /** Baixa arquivos e pastas remotos (recursivo) para localDir. */
  async download(remotePaths: string[], localDir: string): Promise<void> {
    await Promise.all(
      remotePaths.map((remote) =>
        this.transfer('download', path.posix.basename(remote), async (report) => {
          const b = this.backend
          const plan = await planRemote(b, remote, path.join(localDir, safeLocalName(path.posix.basename(remote))))
          report.total(plan.bytes)
          await pool(plan.dirs, 16, (dir) => fs.promises.mkdir(dir, { recursive: true }))
          await pool(plan.files, concurrencyFor(b), (f) => b.downloadFile(f.remote, f.local, report.add))
        })
      )
    )
  }

  /** Executa uma transferência emitindo progresso (no máximo ~10x por segundo). */
  private async transfer(
    kind: TransferProgress['kind'],
    name: string,
    job: (report: { total(n: number): void; add(n: number): void }) => Promise<void>
  ): Promise<void> {
    const t: TransferProgress = { id: randomUUID(), kind, name, transferred: 0, total: 0, state: 'running' }
    let lastEmit = 0
    const emit = (force = false): void => {
      const now = Date.now()
      if (force || now - lastEmit > 100) {
        lastEmit = now
        this.events.transfer({ ...t })
      }
    }
    emit(true)
    try {
      await job({
        total: (n) => {
          t.total = n
          emit(true)
        },
        add: (n) => {
          t.transferred += n
          emit()
        }
      })
      t.state = 'done'
      t.transferred = t.total
      emit(true)
    } catch (e) {
      t.state = 'error'
      t.error = (e as Error).message
      this.log('sftp', `✗ transferência de ${name}: ${t.error}`, true)
      emit(true)
      throw e
    }
  }
}

/**
 * SFTP multiplexa várias requisições no mesmo canal, então dá para ter muitos arquivos em voo.
 * O scp abre um canal exec por arquivo e o sshd limita isso (MaxSessions, padrão 10),
 * e a conexão ainda é usada pelo terminal, então fica mais baixo.
 */
const concurrencyFor = (b: FileBackend): number => (b.kind === 'sftp' ? 8 : 4)

/** Roda `fn` em todos os itens com no máximo `limit` ao mesmo tempo; o primeiro erro interrompe a fila. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const item = items[next++]
      try {
        await fn(item)
      } catch (e) {
        failed = true
        throw e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** Agrupa caminhos POSIX por profundidade, do mais raso ao mais fundo. */
function groupByDepth(dirs: string[]): string[][] {
  const levels = new Map<number, string[]>()
  for (const d of dirs) {
    const depth = d.split('/').length
    levels.set(depth, [...(levels.get(depth) ?? []), d])
  }
  return [...levels.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}

interface Plan {
  dirs: string[]
  files: { local: string; remote: string }[]
  bytes: number
}

async function planRemote(b: FileBackend, remote: string, local: string): Promise<Plan> {
  const plan: Plan = { dirs: [], files: [], bytes: 0 }
  const parent = path.posix.dirname(remote)
  const self = (await b.list(parent)).find((e) => e.name === path.posix.basename(remote))
  if (!self) throw new Error(`Não encontrado: ${remote}`)
  const walk = async (r: string, l: string, e: RemoteEntry): Promise<void> => {
    if (e.type === 'dir') {
      plan.dirs.push(l)
      for (const child of await b.list(r)) {
        if (child.type === 'dir' && child.link) continue // evita loops de symlink
        if (child.type === 'other') continue
        await walk(rjoin(r, child.name), path.join(l, safeLocalName(child.name)), child)
      }
    } else {
      plan.files.push({ local: l, remote: r })
      plan.bytes += e.size
    }
  }
  await walk(remote, local, self)
  return plan
}

async function planLocal(local: string, remote: string): Promise<Plan> {
  const plan: Plan = { dirs: [], files: [], bytes: 0 }
  const walk = async (l: string, r: string): Promise<void> => {
    const st = await fs.promises.stat(l)
    if (st.isDirectory()) {
      plan.dirs.push(r)
      for (const name of await fs.promises.readdir(l)) await walk(path.join(l, name), rjoin(r, name))
    } else if (st.isFile()) {
      plan.files.push({ local: l, remote: r })
      plan.bytes += st.size
    }
  }
  await walk(local, remote)
  return plan
}

/** Nomes válidos no Linux podem ser inválidos no Windows (ex: "a:b", "con"). */
function safeLocalName(name: string): string {
  if (process.platform !== 'win32') return name
  let n = name.replace(/[<>:"\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '_')
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = '_' + n
  return n || '_'
}

function humanize(err: Error & { level?: string; code?: string }): string {
  if (err.level === 'client-authentication') return 'Autenticação falhou (usuário, senha ou chave incorretos)'
  if (err.code === 'ECONNREFUSED') return 'Conexão recusada (o SSH está rodando nessa porta?)'
  if (err.code === 'ENOTFOUND') return 'Host não encontrado'
  if (err.code === 'ETIMEDOUT' || /Timed out/i.test(err.message)) return 'Tempo esgotado ao conectar'
  if (/host key|Host denied/i.test(err.message)) return 'Host key recusado'
  return err.message
}
