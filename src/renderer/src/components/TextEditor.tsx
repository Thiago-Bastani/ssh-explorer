import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { EDIT_MAX } from '../fileTypes'
import { api, errMsg, formatSize } from '../util'

/** Editor básico: lê com `cat`, grava com `cat >` quando você salva. */
export function TextEditor(props: {
  name: string
  path: string
  size: number
  onClose(): void
  /** Chamado depois de cada gravação com sucesso (o Explorer atualiza a listagem). */
  onSaved(): void
}): React.JSX.Element {
  const { name, path, size } = props
  const tooBig = size > EDIT_MAX
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState('') // último conteúdo que está no servidor
  const [crlf, setCrlf] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [error, setError] = useState<string | null>(
    tooBig ? `Arquivo grande demais para editar (${formatSize(size)}, máx. ${formatSize(EDIT_MAX)}). Use Baixar.` : null
  )
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (tooBig) return
    let alive = true
    api
      .readFile(path, EDIT_MAX)
      .then((bytes) => {
        if (!alive) return
        if (bytes.subarray(0, 8192).includes(0)) throw new Error('Arquivo binário: não dá para editar como texto')
        let raw: string
        try {
          raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
        } catch {
          throw new Error('O arquivo não está em UTF-8: editar poderia corrompê-lo')
        }
        const win = raw.includes('\r\n')
        const clean = win ? raw.replace(/\r\n/g, '\n') : raw
        setCrlf(win)
        setSaved(clean)
        setText(clean)
        setTimeout(() => area.current?.focus())
      })
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [path, tooBig])

  const dirty = text !== null && text !== saved

  const save = async (): Promise<boolean> => {
    if (text === null || saving) return false
    setSaving(true)
    setError(null)
    try {
      await api.writeText(path, crlf ? text.replace(/\n/g, '\r\n') : text)
      setSaved(text)
      props.onSaved()
      return true
    } catch (e) {
      const msg = errMsg(e)
      setError(/permission denied|permissão negada/i.test(msg) ? `${msg} — ative o sudo no Explorer e salve de novo` : msg)
      return false
    } finally {
      setSaving(false)
    }
  }

  const requestClose = (): void => {
    if (dirty) setConfirmClose(true)
    else props.onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      requestClose()
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      const useTab = /^makefile$|\.mk$|\.go$/i.test(name)
      // execCommand mantém o Ctrl+Z funcionando dentro da textarea.
      document.execCommand('insertText', false, useTab ? '\t' : '  ')
    }
  }

  const lines = text === null ? 0 : text.split('\n').length

  return (
    <div className="overlay" onKeyDown={(e) => e.stopPropagation()}>
      <div className="overlay-panel" role="dialog" aria-label={`Editar ${name}`}>
        <div className="overlay-head">
          <b className="grow ellipsis" title={path}>
            {name}
            {dirty && <span title="Alterações não salvas"> ●</span>}
          </b>
          <span className="muted small ellipsis">{path}</span>
          <button className="primary" onClick={save} disabled={!dirty || saving} title="Salvar (Ctrl+S)">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          <button onClick={requestClose}>Fechar</button>
        </div>

        {error && <div className="error banner">{error}</div>}

        {text !== null ? (
          <textarea
            ref={area}
            className="editor-area"
            value={text}
            wrap={wrap ? 'soft' : 'off'}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
        ) : (
          <div className="overlay-body">
            {!error && <div className="muted viewer-msg">Carregando…</div>}
          </div>
        )}

        <div className="editor-status muted">
          <span>{lines} linhas</span>
          <span>UTF-8</span>
          <span>{crlf ? 'CRLF' : 'LF'}</span>
          <span className="grow" />
          <label className="toggle">
            <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
            Quebra de linha
          </label>
          <span>Ctrl+S salva</span>
        </div>
      </div>

      {confirmClose && (
        <Modal
          title="Alterações não salvas"
          onClose={() => setConfirmClose(false)}
          actions={
            <>
              <button onClick={() => setConfirmClose(false)}>Cancelar</button>
              <button className="danger" onClick={props.onClose}>
                Descartar
              </button>
              <button
                className="primary"
                autoFocus
                onClick={async () => {
                  setConfirmClose(false)
                  if (await save()) props.onClose()
                }}
              >
                Salvar e fechar
              </button>
            </>
          }
        >
          <p>
            Salvar as alterações em <b>{name}</b> antes de fechar?
          </p>
        </Modal>
      )}
    </div>
  )
}
