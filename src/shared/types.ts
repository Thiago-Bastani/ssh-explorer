// Contrato entre o renderer (UI) e o main (Node/ssh2).

export type AuthMethod = 'password' | 'key' | 'agent'

export interface ConnectOptions {
  host: string
  port: number
  username: string
  auth: AuthMethod
  password?: string
  /** Caminho local da chave privada (auth = 'key'). */
  keyPath?: string
  passphrase?: string
}

/** Conexão salva como a UI enxerga: sem senha, só a indicação de que existe uma. */
export interface SavedConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: AuthMethod
  keyPath?: string
  /** Há senha (ou passphrase da chave) guardada, criptografada no main. */
  hasSecret: boolean
  lastUsed?: number
}

export interface SaveConnectionRequest {
  /** Presente ao editar uma conexão existente. */
  id?: string
  name: string
  opts: ConnectOptions
  /** Guardar a senha/passphrase. Vazia ao editar = manter a que já estava salva. */
  rememberSecret: boolean
}

export type SudoResult =
  | { ok: true }
  /** needPassword: a UI deve pedir a senha do sudo e tentar de novo. */
  | { ok: false; needPassword: boolean; error?: string }

export type EntryType = 'dir' | 'file' | 'other'

export interface RemoteEntry {
  name: string
  /** Tipo do alvo (para symlinks, o tipo daquilo para onde apontam). */
  type: EntryType
  link: boolean
  size: number
  /** epoch em segundos */
  mtime: number
  /** permissões em octal, ex: "755" */
  mode: string
}

export interface ConnectResult {
  home: string
  /** 'sftp' normalmente; 'scp' quando o servidor não tem o subsistema sftp. */
  transport: 'sftp' | 'scp'
}

export interface HostKeyPrompt {
  requestId: string
  host: string
  port: number
  fingerprint: string
  /** fingerprint salvo anteriormente, se o host key mudou */
  previous?: string
}

export interface TransferProgress {
  id: string
  kind: 'upload' | 'download'
  name: string
  transferred: number
  total: number
  state: 'running' | 'done' | 'error'
  error?: string
}

/** Linha do log de operações: comando exec real, ou operação SFTP descrita. */
export interface LogEntry {
  id: number
  /** epoch em ms */
  ts: number
  kind: 'exec' | 'sftp'
  text: string
  /** Falha (com a mensagem do servidor), registrada logo após a operação que falhou. */
  error?: boolean
}

export interface Api {
  connect(opts: ConnectOptions): Promise<ConnectResult>
  /** Conecta usando a senha guardada (descriptografada só no main). */
  connectSaved(id: string): Promise<ConnectResult>
  disconnect(): Promise<void>

  listSaved(): Promise<SavedConnection[]>
  saveConnection(req: SaveConnectionRequest): Promise<SavedConnection>
  deleteSaved(id: string): Promise<void>
  /** false se o SO não oferece criptografia (aí senhas não são guardadas). */
  canRememberSecrets(): Promise<boolean>

  /** Liga/desliga sudo nas operações de arquivo (não afeta o terminal). */
  setSudo(enabled: boolean, password?: string): Promise<SudoResult>
  list(path: string): Promise<RemoteEntry[]>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string, isDir: boolean): Promise<void>
  /** Envia arquivos/pastas locais para remoteDir. */
  upload(localPaths: string[], remoteDir: string): Promise<void>
  /** Pergunta a pasta local de destino e baixa os itens. Retorna false se cancelado. */
  download(remotePaths: string[]): Promise<boolean>
  pickKeyFile(): Promise<string | null>
  pickUploadFiles(): Promise<string[]>
  defaultKeyPath(): Promise<string | null>
  /** Caminho local de um File solto via drag & drop. */
  pathForFile(file: File): string

  termStart(cols: number, rows: number): Promise<void>
  termWrite(data: string): void
  termResize(cols: number, rows: number): void

  onTermData(cb: (data: string) => void): () => void
  onHostKey(cb: (p: HostKeyPrompt) => void): () => void
  answerHostKey(requestId: string, accept: boolean): void
  onTransfer(cb: (t: TransferProgress) => void): () => void
  onDisconnected(cb: (reason: string) => void): () => void
  /** Recebe o log em lotes (o main agrupa a cada ~100 ms). */
  onLog(cb: (batch: LogEntry[]) => void): () => void
}
