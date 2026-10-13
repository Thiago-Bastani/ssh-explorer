import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ConnectOptions, HostKeyPrompt } from '@shared/types'
import { Session } from './session'

let win: BrowserWindow | null = null
let session: Session | null = null
let lastDownloadDir = app.getPath('downloads')

// --- Hosts conhecidos (equivalente ao ~/.ssh/known_hosts, mas por fingerprint) --

const knownHostsFile = (): string => path.join(app.getPath('userData'), 'known_hosts.json')

function loadKnownHosts(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(knownHostsFile(), 'utf8'))
  } catch {
    return {}
  }
}

const pendingHostKeys = new Map<string, (accept: boolean) => void>()

async function verifyHostKey(host: string, port: number, fingerprint: string): Promise<boolean> {
  const id = `[${host}]:${port}`
  const known = loadKnownHosts()
  if (known[id] === fingerprint) return true

  const prompt: HostKeyPrompt = { requestId: randomUUID(), host, port, fingerprint, previous: known[id] }
  const accepted = await new Promise<boolean>((resolve) => {
    pendingHostKeys.set(prompt.requestId, resolve)
    win?.webContents.send('hostkey:prompt', prompt)
  })
  if (accepted) {
    known[id] = fingerprint
    fs.mkdirSync(path.dirname(knownHostsFile()), { recursive: true })
    fs.writeFileSync(knownHostsFile(), JSON.stringify(known, null, 2))
  }
  return accepted
}

// --- IPC ----------------------------------------------------------------------

function requireSession(): Session {
  if (!session) throw new Error('Não conectado')
  return session
}

function registerIpc(): void {
  ipcMain.handle('connect', async (_e, opts: ConnectOptions) => {
    session?.close()
    const s = new Session({
      verifyHostKey: (fp) => verifyHostKey(opts.host, opts.port, fp),
      termData: (d) => win?.webContents.send('term:data', d),
      transfer: (t) => win?.webContents.send('transfer', t),
      disconnected: (reason) => {
        if (session === s) session = null
        win?.webContents.send('disconnected', reason)
      }
    })
    const result = await s.connect(opts)
    session = s
    return result
  })

  ipcMain.handle('disconnect', () => {
    session?.close()
    session = null
  })

  ipcMain.handle('list', (_e, dir: string) => requireSession().list(dir))
  ipcMain.handle('mkdir', (_e, dir: string) => requireSession().mkdir(dir))
  ipcMain.handle('rename', (_e, from: string, to: string) => requireSession().rename(from, to))
  ipcMain.handle('remove', (_e, target: string, isDir: boolean) => requireSession().remove(target, isDir))
  ipcMain.handle('upload', (_e, locals: string[], remoteDir: string) => requireSession().upload(locals, remoteDir))

  ipcMain.handle('download', async (_e, remotes: string[]) => {
    const s = requireSession()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Salvar em…',
      defaultPath: lastDownloadDir,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return false
    lastDownloadDir = res.filePaths[0]
    await s.download(remotes, lastDownloadDir)
    shell.openPath(lastDownloadDir)
    return true
  })

  ipcMain.handle('pick-key', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Chave privada',
      defaultPath: path.join(os.homedir(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('pick-upload', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Enviar arquivos',
      properties: ['openFile', 'multiSelections']
    })
    return res.canceled ? [] : res.filePaths
  })

  ipcMain.handle('default-key', () => {
    for (const name of ['id_ed25519', 'id_ecdsa', 'id_rsa']) {
      const p = path.join(os.homedir(), '.ssh', name)
      if (fs.existsSync(p)) return p
    }
    return null
  })

  ipcMain.handle('term:start', (_e, cols: number, rows: number) => requireSession().startShell(cols, rows))
  ipcMain.on('term:write', (_e, data: string) => session?.termWrite(data))
  ipcMain.on('term:resize', (_e, cols: number, rows: number) => session?.termResize(cols, rows))

  ipcMain.on('hostkey:answer', (_e, requestId: string, accept: boolean) => {
    pendingHostKeys.get(requestId)?.(accept)
    pendingHostKeys.delete(requestId)
  })
}

// --- Janela -------------------------------------------------------------------

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#1b1d23',
    title: 'SSH Explorer',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Links externos abrem no navegador, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    // Em dev, erros do renderer aparecem também no terminal do `npm run dev`.
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') console.log(`[renderer:${e.level}] ${e.message}`)
    })
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  session?.close()
  app.quit()
})
