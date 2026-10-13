import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { Api } from '@shared/types'

/** Registra um listener e devolve a função para removê-lo. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  connect: (opts) => ipcRenderer.invoke('connect', opts),
  connectSaved: (id) => ipcRenderer.invoke('connect-saved', id),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  listSaved: () => ipcRenderer.invoke('saved:list'),
  saveConnection: (req) => ipcRenderer.invoke('saved:save', req),
  deleteSaved: (id) => ipcRenderer.invoke('saved:delete', id),
  canRememberSecrets: () => ipcRenderer.invoke('saved:can-encrypt'),
  setSudo: (enabled, password) => ipcRenderer.invoke('sudo', enabled, password),
  list: (p) => ipcRenderer.invoke('list', p),
  mkdir: (p) => ipcRenderer.invoke('mkdir', p),
  rename: (from, to) => ipcRenderer.invoke('rename', from, to),
  remove: (p, isDir) => ipcRenderer.invoke('remove', p, isDir),
  upload: (locals, remoteDir) => ipcRenderer.invoke('upload', locals, remoteDir),
  download: (remotes) => ipcRenderer.invoke('download', remotes),
  pickKeyFile: () => ipcRenderer.invoke('pick-key'),
  pickUploadFiles: () => ipcRenderer.invoke('pick-upload'),
  defaultKeyPath: () => ipcRenderer.invoke('default-key'),
  pathForFile: (file) => webUtils.getPathForFile(file),

  termStart: (cols, rows) => ipcRenderer.invoke('term:start', cols, rows),
  termWrite: (data) => ipcRenderer.send('term:write', data),
  termResize: (cols, rows) => ipcRenderer.send('term:resize', cols, rows),

  onTermData: (cb) => on('term:data', cb),
  onHostKey: (cb) => on('hostkey:prompt', cb),
  answerHostKey: (id, accept) => ipcRenderer.send('hostkey:answer', id, accept),
  onTransfer: (cb) => on('transfer', cb),
  onDisconnected: (cb) => on('disconnected', cb)
}

contextBridge.exposeInMainWorld('api', api)
