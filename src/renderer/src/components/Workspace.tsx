import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectOptions, ConnectResult, LogEntry, TransferProgress } from '@shared/types'
import { Explorer } from './Explorer'
import { Terminal } from './Terminal'
import { Transfers } from './Transfers'
import { LogPanel, LOG_LIMIT } from './LogPanel'
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

  // O buffer fica num ref (anel de LOG_LIMIT linhas); o React só re-renderiza com o painel aberto.
  const [logOpen, setLogOpen] = useState(false)
  const [logItems, setLogItems] = useState<LogEntry[]>([])
  const logBuf = useRef<LogEntry[]>([])
  const [logErrors, setLogErrors] = useState(0)
  const logOpenRef = useRef(false)
  logOpenRef.current = logOpen

  useEffect(
    () =>
      api.onLog((batch) => {
        const buf = logBuf.current.concat(batch)
        logBuf.current = buf.length > LOG_LIMIT ? buf.slice(-LOG_LIMIT) : buf
        const errs = batch.filter((l) => l.error).length
        if (errs) setLogErrors((n) => n + errs)
        if (logOpenRef.current) setLogItems(logBuf.current)
      }),
    []
  )

  const toggleLog = useCallback(() => {
    setLogOpen((o) => {
      if (!o) setLogItems(logBuf.current)
      setLogErrors(0)
      return !o
    })
  }, [])

  const clearLog = useCallback(() => {
    logBuf.current = []
    setLogItems([])
    setLogErrors(0)
  }, [])

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

      {logOpen && <LogPanel items={logItems} height={160} onClear={clearLog} />}

      <footer className="statusbar">
        <button className="link" onClick={() => setTermOpen((o) => !o)}>
          {termOpen ? '▾ Terminal' : '▸ Terminal'}
        </button>
        <button className="link" onClick={toggleLog}>
          {logOpen ? '▾ Log' : '▸ Log'}
          {!logOpen && logErrors > 0 && <span className="error"> ({logErrors} {logErrors === 1 ? 'erro' : 'erros'})</span>}
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
