import { useEffect, useLayoutEffect, useRef } from 'react'
import type { LogEntry } from '@shared/types'

export const LOG_LIMIT = 1000

const time = (ts: number): string => new Date(ts).toLocaleTimeString('pt-BR', { hour12: false })

export function LogPanel(props: { items: LogEntry[]; height: number; onClear(): void }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // Só acompanha as linhas novas se o usuário já estava no fim.
  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [props.items])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const onScroll = (): void => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="log-pane" style={{ height: props.height }}>
      <div className="log-head">
        <b>Log de operações</b>
        <span className="muted small">últimas {LOG_LIMIT} · senhas nunca aparecem aqui</span>
        <span className="grow" />
        <button className="link" onClick={props.onClear}>
          Limpar
        </button>
      </div>
      <div className="log-lines" ref={box}>
        {props.items.map((l) => (
          <div key={l.id} className={`log-line ${l.kind}${l.error ? ' error' : ''}`}>
            <span className="muted">{time(l.ts)}</span>
            <span className="log-kind">{l.error ? '✗' : l.kind === 'exec' ? '$' : 'sftp'}</span>
            <span className="log-text">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
