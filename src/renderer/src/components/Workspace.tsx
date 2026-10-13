import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectOptions, ConnectResult, TransferProgress } from '@shared/types'
import { Explorer } from './Explorer'
import { Terminal } from './Terminal'
import { Transfers } from './Transfers'
import { api } from '../util'

const TERM_HEIGHT_KEY = 'terminal-height'

export function Workspace(props: {
  opts: ConnectOptions
  result: ConnectResult
  onDisconnect(): void
}): React.JSX.Element {
  const [transfers, setTransfers] = useState<TransferProgress[]>([])
  const [termHeight, setTermHeight] = useState(() => {
    try {
      return Number(localStorage.getItem(TERM_HEIGHT_KEY)) || 260
    } catch {
      return 260
    }
  })
  const [termOpen, setTermOpen] = useState(true)
  const dragging = useRef(false)

  useEffect(
    () =>
      api.onTransfer((t) =>
        setTransfers((list) => {
          const i = list.findIndex((x) => x.id === t.id)
          if (i < 0) return [...list, t]
          const next = list.slice()
          next[i] = t
          return next
        })
      ),
    []
  )

  const clearFinished = useCallback(() => setTransfers((list) => list.filter((t) => t.state === 'running')), [])

  // Divisor arrastável entre explorador e terminal.
  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (!dragging.current) return
      const h = Math.min(Math.max(window.innerHeight - e.clientY - 28, 80), window.innerHeight - 200)
      setTermHeight(h)
    }
    const up = (): void => {
      if (!dragging.current) return
      dragging.current = false
      document.body.classList.remove('resizing')
      setTermHeight((h) => {
        try {
          localStorage.setItem(TERM_HEIGHT_KEY, String(h))
        } catch {
          /* ignora */
        }
        return h
      })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const { opts, result } = props

  return (
    <div className="workspace">
      <Explorer
        home={result.home}
        title={`${opts.username}@${opts.host}${opts.port !== 22 ? `:${opts.port}` : ''}`}
        onDisconnect={props.onDisconnect}
      />

      {termOpen && (
        <>
          <div
            className="splitter"
            onMouseDown={() => {
              dragging.current = true
              document.body.classList.add('resizing')
            }}
          />
          <div className="terminal-pane" style={{ height: termHeight }}>
            <Terminal />
          </div>
        </>
      )}

      <footer className="statusbar">
        <button className="link" onClick={() => setTermOpen((o) => !o)}>
          {termOpen ? '▾ Terminal' : '▸ Terminal'}
        </button>
        <span className="muted">
          SSH :{opts.port} · arquivos via {result.transport === 'sftp' ? 'SFTP' : 'scp (servidor sem sftp)'}
        </span>
        <span className="grow" />
        <Transfers items={transfers} onClear={clearFinished} />
      </footer>
    </div>
  )
}
