// Duas formas de mexer em arquivos remotos, ambas pela MESMA conexão SSH (porta 22):
//  - SftpBackend: subsistema sftp do sshd (padrão, mesmo protocolo do `scp` moderno)
//  - ScpBackend:  canal exec rodando `scp -t/-f` e comandos de shell, para servidores sem sftp
import fs from 'node:fs'
import path from 'node:path'
import type { Client, SFTPWrapper, ClientChannel, Stats } from 'ssh2'
import type { EntryType, RemoteEntry } from '@shared/types'

export type Progress = (bytes: number) => void

export interface FileBackend {
  readonly kind: 'sftp' | 'scp'
  home(): Promise<string>
  list(dir: string): Promise<RemoteEntry[]>
  mkdir(p: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** Remove arquivo, ou pasta recursivamente. */
  remove(p: string, isDir: boolean): Promise<void>
  /** onProgress recebe a quantidade de bytes transferidos desde a última chamada. */
  uploadFile(local: string, remote: string, onProgress: Progress): Promise<void>
  downloadFile(remote: string, local: string, onProgress: Progress): Promise<void>
}

// Caminhos remotos são sempre POSIX, mesmo rodando no Windows.
export const rjoin = (...parts: string[]): string => path.posix.join(...parts)

/** Aspas simples para shell POSIX: tudo literal, inclusive $, espaços e aspas. */
export const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

const p = <T>(fn: (cb: (err: Error | null | undefined, res?: T) => void) => void): Promise<T> =>
  new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res as T))))

function typeFromMode(mode: number): EntryType {
  const fmt = mode & 0o170000
  if (fmt === 0o040000) return 'dir'
  if (fmt === 0o100000) return 'file'
  return 'other'
}

// ---------------------------------------------------------------------------
// SFTP

export class SftpBackend implements FileBackend {
  readonly kind = 'sftp'
  constructor(private sftp: SFTPWrapper) {}

  home(): Promise<string> {
    return p<string>((cb) => this.sftp.realpath('.', cb))
  }

  async list(dir: string): Promise<RemoteEntry[]> {
    const items = await p<{ filename: string; attrs: Stats }[]>((cb) => this.sftp.readdir(dir, cb))
    return Promise.all(
      items.map(async ({ filename, attrs }) => {
        const isLink = (attrs.mode & 0o170000) === 0o120000
        let target = attrs
        if (isLink) {
          // Descobre se o link aponta para pasta; link quebrado vira 'other'.
          target = await p<Stats>((cb) => this.sftp.stat(rjoin(dir, filename), cb)).catch(() => attrs)
        }
        return {
          name: filename,
          type: typeFromMode(target.mode),
          link: isLink,
          size: target.size,
          mtime: attrs.mtime,
          mode: (attrs.mode & 0o777).toString(8)
        }
      })
    )
  }

  mkdir(dir: string): Promise<void> {
    return p((cb) => this.sftp.mkdir(dir, cb))
  }

  rename(from: string, to: string): Promise<void> {
    return p((cb) => this.sftp.rename(from, to, cb))
  }

  async remove(target: string, isDir: boolean): Promise<void> {
    if (!isDir) return p((cb) => this.sftp.unlink(target, cb))
    for (const e of await this.list(target)) {
      // Não segue symlinks de pasta: remove só o link.
      await this.remove(rjoin(target, e.name), e.type === 'dir' && !e.link)
    }
    return p((cb) => this.sftp.rmdir(target, cb))
  }

  uploadFile(local: string, remote: string, onProgress: Progress): Promise<void> {
    let last = 0
    return p((cb) =>
      this.sftp.fastPut(local, remote, {
        step: (total) => {
          onProgress(total - last)
          last = total
        }
      }, cb)
    )
  }

  downloadFile(remote: string, local: string, onProgress: Progress): Promise<void> {
    let last = 0
    return p((cb) =>
      this.sftp.fastGet(remote, local, {
        step: (total) => {
          onProgress(total - last)
          last = total
        }
      }, cb)
    )
  }
}

// ---------------------------------------------------------------------------
// SCP + exec (fallback)

/** Leitor de bytes sobre um canal, para falar o protocolo scp. */
class ChannelReader {
  private buf = Buffer.alloc(0)
  private waiter: (() => void) | null = null
  private closed = false

  constructor(ch: ClientChannel) {
    ch.on('data', (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d])
      this.wake()
    })
    ch.on('close', () => {
      this.closed = true
      this.wake()
    })
  }

  private wake(): void {
    const w = this.waiter
    this.waiter = null
    w?.()
  }

  private async fill(n: number): Promise<void> {
    while (this.buf.length < n) {
      if (this.closed) throw new Error('scp: conexão encerrada no meio da transferência')
      await new Promise<void>((r) => (this.waiter = r))
    }
  }

  async readLine(): Promise<string> {
    for (;;) {
      const nl = this.buf.indexOf(10)
      if (nl >= 0) {
        const line = this.buf.subarray(0, nl).toString('utf8')
        this.buf = this.buf.subarray(nl + 1)
        return line
      }
      await this.fill(this.buf.length + 1)
    }
  }

  /** Lê o byte de resposta do scp: 0 = ok, 1/2 = erro seguido de mensagem. */
  async ack(): Promise<void> {
    await this.fill(1)
    const code = this.buf[0]
    if (code === 0) {
      this.buf = this.buf.subarray(1)
      return
    }
    const msg = await this.readLine()
    throw new Error(`scp: ${msg.slice(1).trim()}`)
  }

  /** Repassa exatamente `size` bytes para `onChunk`. */
  async readExact(size: number, onChunk: (b: Buffer) => Promise<void> | void): Promise<void> {
    let left = size
    while (left > 0) {
      if (this.buf.length === 0) await this.fill(1)
      const take = Math.min(left, this.buf.length)
      const chunk = this.buf.subarray(0, take)
      this.buf = this.buf.subarray(take)
      left -= take
      await onChunk(chunk)
    }
  }
}

/**
 * Modo sudo. `password` ausente = servidor com NOPASSWD.
 * Com senha, ela vai pelo stdin (`sudo -S`), nunca na linha de comando (apareceria no `ps`).
 * `-k` ignora credenciais em cache: assim o sudo SEMPRE lê a senha primeiro e o resto do
 * stdin chega intacto ao comando (essencial para o `scp -t` receber os dados do upload).
 */
export interface SudoMode {
  password?: string
}

export function sudoWrap(cmd: string, sudo: SudoMode): string {
  const prefix = sudo.password === undefined ? 'sudo -n' : "sudo -S -k -p ''"
  return `${prefix} -- sh -c ${shq(cmd)}`
}

export class ScpBackend implements FileBackend {
  readonly kind = 'scp'
  constructor(
    private conn: Client,
    private sudo?: SudoMode
  ) {}

  private async open(cmd: string): Promise<ClientChannel> {
    const ch = await p<ClientChannel>((cb) => this.conn.exec(this.sudo ? sudoWrap(cmd, this.sudo) : cmd, cb))
    // O sudo lê a senha caractere a caractere até o \n; o que vier depois é do comando.
    if (this.sudo?.password !== undefined) ch.write(this.sudo.password + '\n')
    return ch
  }

  /** Roda um comando e devolve o stdout; rejeita se o exit code != 0. */
  private async run(cmd: string): Promise<string> {
    const ch = await this.open(cmd)
    ch.end() // nenhum desses comandos lê stdin
    return new Promise((resolve, reject) => {
      const out: Buffer[] = []
      const err: Buffer[] = []
      let code: number | null = null
      ch.on('data', (d: Buffer) => out.push(d))
      ch.stderr.on('data', (d: Buffer) => err.push(d))
      ch.on('exit', (c: number | null) => (code = c))
      ch.on('close', () => {
        if (code === 0) resolve(Buffer.concat(out).toString('utf8'))
        else reject(new Error(Buffer.concat(err).toString('utf8').trim() || `comando falhou (código ${code})`))
      })
    })
  }

  async home(): Promise<string> {
    return (await this.run('pwd')).trim()
  }

  async list(dir: string): Promise<RemoteEntry[]> {
    // Um único `stat` para a pasta toda. -L resolve symlinks; a 2ª linha marca quem é link.
    // Formato: tipo/tamanho/mtime/modo/nome  ('/' não pode aparecer em nome de arquivo).
    const script =
      `cd -- ${shq(dir)} || exit 1; ` +
      `stat -L -c '%F/%s/%Y/%a/%n' -- * .* 2>/dev/null; ` +
      `for f in * .*; do [ -L "$f" ] && printf 'L/%s\\n' "$f"; done; true`
    const out = await this.run(script)
    const links = new Set<string>()
    const entries: RemoteEntry[] = []
    for (const line of out.split('\n')) {
      if (line.startsWith('L/')) {
        links.add(line.slice(2))
        continue
      }
      const m = /^([^/]+)\/(\d+)\/(\d+)\/([0-7]+)\/(.+)$/.exec(line)
      if (!m || m[5] === '.' || m[5] === '..') continue
      const kind = m[1]
      entries.push({
        name: m[5],
        type: kind === 'directory' ? 'dir' : kind.startsWith('regular') ? 'file' : 'other',
        link: false,
        size: Number(m[2]),
        mtime: Number(m[3]),
        mode: m[4]
      })
    }
    for (const e of entries) e.link = links.has(e.name)
    return entries
  }

  async mkdir(dir: string): Promise<void> {
    await this.run(`mkdir -- ${shq(dir)}`)
  }

  async rename(from: string, to: string): Promise<void> {
    await this.run(`mv -- ${shq(from)} ${shq(to)}`)
  }

  async remove(target: string, isDir: boolean): Promise<void> {
    await this.run(`rm ${isDir ? '-rf' : '-f'} -- ${shq(target)}`)
  }

  async uploadFile(local: string, remote: string, onProgress: Progress): Promise<void> {
    const { size } = await fs.promises.stat(local)
    const ch = await this.open(`scp -t ${shq(remote)}`)
    const rd = new ChannelReader(ch)
    try {
      await rd.ack()
      ch.write(`C0644 ${size} ${path.posix.basename(remote)}\n`)
      await rd.ack()
      await new Promise<void>((resolve, reject) => {
        const src = fs.createReadStream(local)
        src.on('data', (chunk) => onProgress(chunk.length))
        src.on('error', reject)
        src.on('end', resolve)
        src.pipe(ch, { end: false })
      })
      ch.write(Buffer.from([0]))
      await rd.ack()
    } finally {
      ch.end()
    }
  }

  async downloadFile(remote: string, local: string, onProgress: Progress): Promise<void> {
    const ch = await this.open(`scp -f ${shq(remote)}`)
    const rd = new ChannelReader(ch)
    const out = fs.createWriteStream(local)
    try {
      ch.write(Buffer.from([0]))
      let header = await rd.readLine()
      if (header.startsWith('\x01') || header.startsWith('\x02')) throw new Error(`scp: ${header.slice(1)}`)
      if (header.startsWith('T')) {
        ch.write(Buffer.from([0]))
        header = await rd.readLine()
      }
      const m = /^C[0-7]+ (\d+) /.exec(header)
      if (!m) throw new Error(`scp: resposta inesperada: ${header}`)
      ch.write(Buffer.from([0]))
      await rd.readExact(Number(m[1]), async (chunk) => {
        onProgress(chunk.length)
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      })
      await rd.ack()
      ch.write(Buffer.from([0]))
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
    } catch (e) {
      out.destroy()
      await fs.promises.rm(local, { force: true })
      throw e
    } finally {
      ch.end()
    }
  }
}
