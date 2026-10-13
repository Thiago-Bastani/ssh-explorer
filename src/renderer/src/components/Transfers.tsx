import { useState } from 'react'
import type { TransferProgress } from '@shared/types'
import { formatSize } from '../util'

export function Transfers(props: { items: TransferProgress[]; onClear(): void }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const { items } = props
  if (items.length === 0) return null

  const running = items.filter((t) => t.state === 'running')
  const failed = items.filter((t) => t.state === 'error').length
  const total = running.reduce((s, t) => s + t.total, 0)
  const done = running.reduce((s, t) => s + t.transferred, 0)

  return (
    <div className="transfers">
      <button className="link" onClick={() => setOpen((o) => !o)}>
        {running.length > 0
          ? `⇅ ${running.length} em andamento · ${total ? Math.floor((done / total) * 100) : 0}%`
          : failed
            ? `⚠ ${failed} com erro`
            : '✓ Transferências concluídas'}
      </button>
      {open && (
        <div className="transfers-panel">
          <div className="transfers-head">
            <b>Transferências</b>
            <button className="link" onClick={props.onClear}>
              Limpar concluídas
            </button>
          </div>
          {items
            .slice()
            .reverse()
            .map((t) => {
              const pct = t.total ? (t.transferred / t.total) * 100 : t.state === 'done' ? 100 : 0
              return (
                <div key={t.id} className={`transfer ${t.state}`}>
                  <div className="transfer-line">
                    <span>{t.kind === 'upload' ? '↑' : '↓'}</span>
                    <span className="grow ellipsis" title={t.name}>
                      {t.name}
                    </span>
                    <span className="muted">
                      {t.state === 'error' ? 'erro' : `${formatSize(t.transferred)} / ${formatSize(t.total)}`}
                    </span>
                  </div>
                  <div className="bar">
                    <div style={{ width: `${pct}%` }} />
                  </div>
                  {t.error && <div className="error small">{t.error}</div>}
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
