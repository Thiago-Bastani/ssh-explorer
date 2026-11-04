import { useEffect, useState } from 'react'
import { VIEW_MAX, mimeOf } from '../fileTypes'
import { api, errMsg, formatSize } from '../util'

/** Mostra imagem ou PDF: lê o arquivo com um `cat` e exibe a partir de um blob local. */
export function FileViewer(props: {
  name: string
  path: string
  size: number
  kind: 'image' | 'pdf'
  onClose(): void
  onDownload(): void
}): React.JSX.Element {
  const { name, path, size, kind, onClose } = props
  const tooBig = size > VIEW_MAX
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(
    tooBig ? `Arquivo grande demais para visualizar (${formatSize(size)}, máx. ${formatSize(VIEW_MAX)}).` : null
  )
  const [actualSize, setActualSize] = useState(false)

  useEffect(() => {
    if (tooBig) return
    let alive = true
    let made: string | null = null
    api
      .readFile(path, VIEW_MAX)
      .then((bytes) => {
        if (!alive) return
        made = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeOf(name) }))
        setUrl(made)
      })
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [path, name, tooBig])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="overlay"
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="overlay-panel" role="dialog" aria-label={name}>
        <div className="overlay-head">
          <b className="grow ellipsis" title={path}>
            {name}
          </b>
          <span className="muted small">{formatSize(size)}</span>
          <button onClick={props.onDownload}>↓ Baixar</button>
          <button onClick={onClose}>Fechar</button>
        </div>
        <div className="overlay-body viewer">
          {error ? (
            <div className="error viewer-msg">{error}</div>
          ) : !url ? (
            <div className="muted viewer-msg">Carregando…</div>
          ) : kind === 'pdf' ? (
            <iframe className="viewer-frame" src={url} title={name} />
          ) : (
            <img
              className={`viewer-img ${actualSize ? 'actual' : ''}`}
              src={url}
              alt={name}
              title="Clique para alternar entre ajustar e tamanho real"
              onClick={() => setActualSize((v) => !v)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
