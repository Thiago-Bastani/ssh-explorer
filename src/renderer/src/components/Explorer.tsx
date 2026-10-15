import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RemoteEntry } from '@shared/types'
import { Modal, PromptModal } from './Modal'
import { api, errMsg, formatDate, formatSize, path, shq } from '../util'

type SortKey = 'name' | 'size' | 'mtime'
/** Médio = ícones grandes lado a lado (padrão), como a área de trabalho do Windows. */
type ViewMode = 'medium' | 'small' | 'list'
type Dialog =
  | { kind: 'mkdir' }
  | { kind: 'rename'; entry: RemoteEntry }
  | { kind: 'delete'; entries: RemoteEntry[] }
  | null

interface Menu {
  x: number
  y: number
  entry: RemoteEntry | null
}

const PREFS_KEY = 'explorer-prefs'

function loadPrefs(): { showHidden: boolean; syncTerm: boolean } {
  try {
    return { showHidden: false, syncTerm: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return { showHidden: false, syncTerm: false }
  }
}

/** Ícone vetorial para as visualizações em grade. */
function EntryIcon(props: { entry: RemoteEntry; size: number }): React.JSX.Element {
  const { entry: e, size } = props
  return (
    <svg className="entry-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      {e.type === 'dir' ? (
        <>
          <path d="M4 12a3 3 0 0 1 3-3h10l4 4h20a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#e0a73c" />
          <rect x="4" y="17" width="40" height="22" rx="3" fill="#f6c453" />
        </>
      ) : e.type === 'other' ? (
        <path d="M24 5l17 19-17 19L7 24z" fill="none" stroke="#8b91a0" strokeWidth="3" strokeLinejoin="round" />
      ) : (
        <>
          <path d="M11 4h18l10 10v28a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#c9cfdc" />
          <path d="M29 4l10 10H31a2 2 0 0 1-2-2z" fill="#8b91a0" />
          <path d="M15 24h18M15 30h18M15 36h12" stroke="#8b91a0" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
      {e.link && (
        <g>
          <circle cx="36" cy="38" r="9" fill="#1b1d23" />
          <path d="M31 41l9-9m0 0h-6m6 0v6" stroke="#7aa2f7" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  )
}

function icon(e: RemoteEntry): string {
  if (e.type === 'dir') return e.link ? '📁↗' : '📁'
  if (e.type === 'other') return '◇'
  return e.link ? '📄↗' : '📄'
}

export function Explorer(props: { home: string; title: string; onDisconnect(): void }): React.JSX.Element {
  const [cwd, setCwd] = useState(props.home)
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false })
  const [prefs, setPrefs] = useState(loadPrefs)
  // De propósito fora de `prefs`: não é salvo. Cada sessão começa em 'medium'.
  const [view, setView] = useState<ViewMode>('medium')
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null) // '' = pasta atual
  const [sudo, setSudo] = useState(false)
  /** Pasta que falhou por falta de permissão (oferece "Tentar com sudo"). */
  const [deniedDir, setDeniedDir] = useState<string | null>(null)
  /** Pedido de senha do sudo em aberto; `then` roda depois de ativar. */
  const [sudoPrompt, setSudoPrompt] = useState<{ error?: string; then?: () => void } | null>(null)
  const history = useRef<{ back: string[]; fwd: string[] }>({ back: [], fwd: [] })
  const cwdRef = useRef(cwd)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      /* ignora */
    }
  }, [prefs])

  const load = useCallback(async (dir: string): Promise<boolean> => {
    setLoading(true)
    try {
      const list = await api.list(dir)
      cwdRef.current = dir
      setCwd(dir)
      setEntries(list)
      setError(null)
      setDeniedDir(null)
      return true
    } catch (e) {
      const msg = errMsg(e)
      setError(`${dir}: ${msg}`)
      setDeniedDir(/permission denied|permissão negada/i.test(msg) ? dir : null)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const navigate = useCallback(
    async (dir: string, mode: 'push' | 'back' | 'fwd' = 'push') => {
      const target = path.normalize(dir)
      const from = cwdRef.current
      if (!(await load(target))) return
      setSelected(new Set())
      setAnchor(null)
      const h = history.current
      if (mode === 'push' && target !== from) {
        h.back.push(from)
        h.fwd = []
      }
      if (prefs.syncTerm && target !== from) {
        // Ctrl+U limpa o que estiver digitado; o espaço inicial evita poluir o histórico do bash.
        api.termWrite(`\x15 cd ${shq(target)}\r`)
      }
    },
    [load, prefs.syncTerm]
  )

  const refresh = useCallback(() => load(cwdRef.current), [load])

  useEffect(() => {
    load(props.home)
  }, [load, props.home])

  const goBack = (): void => {
    const prev = history.current.back.pop()
    if (prev) {
      history.current.fwd.push(cwd)
      navigate(prev, 'back')
    }
  }
  const goFwd = (): void => {
    const next = history.current.fwd.pop()
    if (next) {
      history.current.back.push(cwd)
      navigate(next, 'fwd')
    }
  }
  const goUp = (): void => {
    if (cwd !== '/') navigate(path.dirname(cwd))
  }

  const visible = useMemo(() => {
    const list = prefs.showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'))
    const dir = sort.desc ? -1 : 1
    return list.slice().sort((a, b) => {
      // Pastas sempre primeiro, como no Explorer do Windows.
      if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1
      const cmp =
        sort.key === 'name'
          ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
          : a[sort.key] - b[sort.key]
      return cmp * dir
    })
  }, [entries, prefs.showHidden, sort])

  const selectedEntries = visible.filter((e) => selected.has(e.name))
  const full = (e: RemoteEntry): string => path.join(cwd, e.name)

  // --- Ações ------------------------------------------------------------------

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      setError(errMsg(e))
    }
    refresh()
  }

  /** Liga o sudo; se o servidor pedir senha, abre o prompt e tenta de novo. */
  const enableSudo = async (then?: () => void, password?: string): Promise<void> => {
    try {
      const res = await api.setSudo(true, password)
      if (res.ok) {
        setSudo(true)
        setSudoPrompt(null)
        if (then) then()
        else refresh()
      } else if (res.needPassword) {
        setSudoPrompt({ error: res.error, then })
      } else {
        setSudoPrompt(null)
        setError(res.error ?? 'Não foi possível ativar o sudo')
      }
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const toggleSudo = async (on: boolean): Promise<void> => {
    if (on) return enableSudo()
    await api.setSudo(false)
    setSudo(false)
    refresh()
  }

  const open = (e: RemoteEntry): void => {
    if (e.type === 'dir') navigate(full(e))
    else download([e])
  }

  const download = (list: RemoteEntry[]): void => {
    if (list.length) api.download(list.map(full)).catch((e) => setError(errMsg(e)))
  }

  const upload = async (locals: string[], remoteDir = cwd): Promise<void> => {
    if (!locals.length) return
    try {
      await api.upload(locals, remoteDir)
    } catch (e) {
      setError(errMsg(e))
    }
    if (cwdRef.current === remoteDir) refresh()
  }

  // --- Seleção ----------------------------------------------------------------

  const clickRow = (e: React.MouseEvent, entry: RemoteEntry): void => {
    if (e.shiftKey && anchor) {
      const names = visible.map((x) => x.name)
      const [a, b] = [names.indexOf(anchor), names.indexOf(entry.name)].sort((x, y) => x - y)
      setSelected(new Set(names.slice(a, b + 1)))
      return
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (next.has(entry.name)) next.delete(entry.name)
      else next.add(entry.name)
      setSelected(next)
    } else {
      setSelected(new Set([entry.name]))
    }
    setAnchor(entry.name)
  }

  const gridColumns = (): number => {
    const el = listRef.current
    return el ? getComputedStyle(el).gridTemplateColumns.split(' ').length : 1
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (dialog || editingPath !== null) return
    const idx = visible.findIndex((x) => x.name === anchor)
    const arrows = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']
    if (arrows.includes(e.key) && !e.altKey) {
      e.preventDefault()
      const grid = view !== 'list'
      // Na grade, ←/→ andam 1 item e ↑/↓ andam uma linha inteira (nº de colunas).
      if (!grid && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      const cols = grid ? gridColumns() : 1
      const step = e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : e.key === 'ArrowRight' ? 1 : -1
      const next = visible[Math.min(Math.max((idx < 0 ? -step : idx) + step, 0), visible.length - 1)]
      if (next) {
        setSelected(new Set([next.name]))
        setAnchor(next.name)
        listRef.current?.querySelector(`[data-name="${CSS.escape(next.name)}"]`)?.scrollIntoView({ block: 'nearest' })
      }
    } else if (e.key === 'Enter' && selectedEntries.length === 1) {
      open(selectedEntries[0])
    } else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) {
      e.preventDefault()
      if (e.key === 'Backspace') goUp()
      else goBack()
    } else if (e.altKey && e.key === 'ArrowRight') {
      goFwd()
    } else if (e.key === 'Delete' && selectedEntries.length) {
      setDialog({ kind: 'delete', entries: selectedEntries })
    } else if (e.key === 'F2' && selectedEntries.length === 1) {
      setDialog({ kind: 'rename', entry: selectedEntries[0] })
    } else if (e.key === 'F5') {
      refresh()
    } else if (e.ctrlKey && e.key === 'a') {
      e.preventDefault()
      setSelected(new Set(visible.map((x) => x.name)))
    }
  }

  // --- Drag & drop vindo do Windows Explorer -----------------------------------

  const isFileDrag = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')

  const dragOver = (e: React.DragEvent, target: string): void => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropTarget(target)
  }

  const drop = (e: React.DragEvent, remoteDir: string): void => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const locals = Array.from(e.dataTransfer.files)
      .map((f) => api.pathForFile(f))
      .filter(Boolean)
    upload(locals, remoteDir)
  }

  // --- Breadcrumbs --------------------------------------------------------------

  const crumbs = useMemo(() => {
    const parts = cwd.split('/').filter(Boolean)
    return [{ label: '/', path: '/' }, ...parts.map((p, i) => ({ label: p, path: '/' + parts.slice(0, i + 1).join('/') }))]
  }, [cwd])

  const sortHeader = (key: SortKey, label: string): React.JSX.Element => (
    <button className="th" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))}>
      {label}
      {sort.key === key && <span className="muted">{sort.desc ? ' ▾' : ' ▴'}</span>}
    </button>
  )

  return (
    <section className="explorer" tabIndex={0} onKeyDown={onKeyDown} onClick={() => setMenu(null)}>
      <header className="toolbar">
        <div className="nav-buttons">
          <button title="Voltar (Alt+←)" onClick={goBack} disabled={!history.current.back.length}>
            ←
          </button>
          <button title="Avançar (Alt+→)" onClick={goFwd} disabled={!history.current.fwd.length}>
            →
          </button>
          <button title="Pasta acima (Backspace)" onClick={goUp} disabled={cwd === '/'}>
            ↑
          </button>
          <button title="Atualizar (F5)" onClick={refresh}>
            ⟳
          </button>
        </div>

        {editingPath !== null ? (
          <input
            className="pathbar"
            autoFocus
            value={editingPath}
            spellCheck={false}
            onChange={(e) => setEditingPath(e.target.value)}
            onBlur={() => setEditingPath(null)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                const target = editingPath.startsWith('/') ? editingPath : path.join(cwd, editingPath)
                setEditingPath(null)
                navigate(target)
              } else if (e.key === 'Escape') setEditingPath(null)
            }}
          />
        ) : (
          <div className="pathbar crumbs" onClick={() => setEditingPath(cwd)} title="Clique para digitar um caminho">
            {crumbs.map((c, i) => (
              <span key={c.path}>
                {i > 1 && <span className="sep">/</span>}
                <button
                  className="crumb"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(c.path)
                  }}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="host-badge" title={props.title}>
          {props.title}
          <button className="link" onClick={props.onDisconnect}>
            Desconectar
          </button>
        </div>
      </header>

      <div className="actions">
        <button onClick={() => setDialog({ kind: 'mkdir' })}>＋ Nova pasta</button>
        <button onClick={async () => upload(await api.pickUploadFiles())}>↑ Enviar arquivos</button>
        <button disabled={!selectedEntries.length} onClick={() => download(selectedEntries)}>
          ↓ Baixar
        </button>
        <button
          disabled={selectedEntries.length !== 1}
          onClick={() => setDialog({ kind: 'rename', entry: selectedEntries[0] })}
        >
          Renomear
        </button>
        <button
          className="danger-text"
          disabled={!selectedEntries.length}
          onClick={() => setDialog({ kind: 'delete', entries: selectedEntries })}
        >
          Excluir
        </button>
        <span className="grow" />
        {view !== 'list' && (
          <select
            className="sort-select"
            title="Ordenar por"
            value={`${sort.key}:${sort.desc ? 'desc' : 'asc'}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(':')
              setSort({ key: key as SortKey, desc: dir === 'desc' })
            }}
          >
            <option value="name:asc">Nome ▴</option>
            <option value="name:desc">Nome ▾</option>
            <option value="size:desc">Maiores</option>
            <option value="size:asc">Menores</option>
            <option value="mtime:desc">Mais recentes</option>
            <option value="mtime:asc">Mais antigos</option>
          </select>
        )}
        <div className="view-switch" role="group" aria-label="Tamanho dos ícones">
          {(
            [
              ['medium', 'Médio', 'Ícones médios'],
              ['small', 'Pequeno', 'Ícones pequenos'],
              ['list', 'Lista', 'Lista detalhada']
            ] as const
          ).map(([mode, label, title]) => (
            <button key={mode} title={title} className={view === mode ? 'on' : ''} onClick={() => setView(mode)}>
              {label}
            </button>
          ))}
        </div>
        <label
          className={`toggle sudo-toggle ${sudo ? 'on' : ''}`}
          title="Operações de arquivo com sudo (o terminal não é afetado)"
        >
          <input type="checkbox" checked={sudo} onChange={(e) => toggleSudo(e.target.checked)} />
          sudo
        </label>
        <label className="toggle" title="Mostrar arquivos que começam com ponto">
          <input
            type="checkbox"
            checked={prefs.showHidden}
            onChange={(e) => setPrefs((p) => ({ ...p, showHidden: e.target.checked }))}
          />
          Ocultos
        </label>
        <label className="toggle" title="Ao navegar, roda cd no terminal">
          <input
            type="checkbox"
            checked={prefs.syncTerm}
            onChange={(e) => setPrefs((p) => ({ ...p, syncTerm: e.target.checked }))}
          />
          Sincronizar terminal
        </label>
      </div>

      {error && (
        <div className="error banner">
          <span className="grow">{error}</span>
          {deniedDir && !sudo && (
            <button className="link" onClick={() => enableSudo(() => navigate(deniedDir))}>
              Tentar com sudo
            </button>
          )}
          <button className="link" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      <div
        className={`filelist view-${view} ${dropTarget === '' ? 'drop-here' : ''} ${loading ? 'loading' : ''}`}
        ref={listRef}
        onDragOver={(e) => dragOver(e, '')}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null)
        }}
        onDrop={(e) => drop(e, cwd)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(new Set())
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, entry: null })
        }}
      >
        {view === 'list' && (
        <div className="row-head">
          <span className="col-icon" />
          {sortHeader('name', 'Nome')}
          {sortHeader('size', 'Tamanho')}
          {sortHeader('mtime', 'Modificado')}
          <span className="th">Permissões</span>
        </div>
        )}

        {visible.map((e) => {
          const isDropDir = e.type === 'dir' && dropTarget === e.name
          return (
            <div
              key={e.name}
              data-name={e.name}
              className={`${view === 'list' ? 'row' : 'tile'} ${selected.has(e.name) ? 'selected' : ''} ${isDropDir ? 'drop-into' : ''}`}
              title={view === 'list' ? undefined : `${e.name}${e.type === 'dir' ? '' : ` · ${formatSize(e.size)}`} · ${formatDate(e.mtime)}`}
              onClick={(ev) => {
                ev.stopPropagation()
                setMenu(null)
                clickRow(ev, e)
              }}
              onDoubleClick={() => open(e)}
              onContextMenu={(ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                if (!selected.has(e.name)) {
                  setSelected(new Set([e.name]))
                  setAnchor(e.name)
                }
                setMenu({ x: ev.clientX, y: ev.clientY, entry: e })
              }}
              onDragOver={e.type === 'dir' ? (ev) => dragOver(ev, e.name) : undefined}
              onDrop={e.type === 'dir' ? (ev) => drop(ev, full(e)) : undefined}
            >
              {view === 'list' ? (
                <>
                  <span className="col-icon">{icon(e)}</span>
                  <span className="col-name ellipsis" title={e.name}>
                    {e.name}
                  </span>
                  <span className="col-size muted">{e.type === 'dir' ? '' : formatSize(e.size)}</span>
                  <span className="col-date muted">{formatDate(e.mtime)}</span>
                  <span className="col-mode muted mono">{e.mode}</span>
                </>
              ) : (
                <>
                  <EntryIcon entry={e} size={view === 'medium' ? 48 : 20} />
                  <span className="tile-name">{e.name}</span>
                </>
              )}
            </div>
          )
        })}

        {!loading && visible.length === 0 && !error && (
          <div className="empty muted">Pasta vazia — arraste arquivos para cá para enviar.</div>
        )}
      </div>

      {menu && (
        <ul className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={() => setMenu(null)}>
          {menu.entry ? (
            <>
              <li onClick={() => open(menu.entry!)}>{menu.entry.type === 'dir' ? 'Abrir' : 'Baixar'}</li>
              {menu.entry.type === 'dir' && <li onClick={() => download(selectedEntries)}>Baixar pasta</li>}
              <li onClick={() => setDialog({ kind: 'rename', entry: menu.entry! })}>Renomear</li>
              <li onClick={() => navigator.clipboard.writeText(full(menu.entry!))}>Copiar caminho</li>
              {menu.entry.type === 'dir' && (
                <li onClick={() => api.termWrite(`\x15 cd ${shq(full(menu.entry!))}\r`)}>Abrir no terminal</li>
              )}
              <li className="danger-text" onClick={() => setDialog({ kind: 'delete', entries: selectedEntries })}>
                Excluir{selectedEntries.length > 1 ? ` (${selectedEntries.length})` : ''}
              </li>
            </>
          ) : (
            <>
              <li onClick={() => setDialog({ kind: 'mkdir' })}>Nova pasta</li>
              <li onClick={async () => upload(await api.pickUploadFiles())}>Enviar arquivos…</li>
              <li onClick={refresh}>Atualizar</li>
              <li onClick={() => navigator.clipboard.writeText(cwd)}>Copiar caminho</li>
              <li onClick={() => api.termWrite(`\x15 cd ${shq(cwd)}\r`)}>Abrir no terminal</li>
            </>
          )}
        </ul>
      )}

      {sudoPrompt && (
        <PromptModal
          title="Senha do sudo"
          label="Senha do seu usuário no servidor (fica só em memória até desconectar)"
          password
          error={sudoPrompt.error}
          confirm="Ativar sudo"
          onClose={() => setSudoPrompt(null)}
          onSubmit={(pw) => enableSudo(sudoPrompt.then, pw)}
        />
      )}

      {dialog?.kind === 'mkdir' && (
        <PromptModal
          title="Nova pasta"
          label="Nome"
          confirm="Criar"
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            setDialog(null)
            run(() => api.mkdir(path.join(cwd, name)))
          }}
        />
      )}

      {dialog?.kind === 'rename' && (
        <PromptModal
          title="Renomear"
          label="Novo nome"
          initial={dialog.entry.name}
          confirm="Renomear"
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            const from = full(dialog.entry)
            setDialog(null)
            if (name !== dialog.entry.name) run(() => api.rename(from, path.join(cwd, name)))
          }}
        />
      )}

      {dialog?.kind === 'delete' && (
        <Modal
          title="Excluir"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button onClick={() => setDialog(null)}>Cancelar</button>
              <button
                className="danger"
                autoFocus
                onClick={() => {
                  const list = dialog.entries
                  setDialog(null)
                  run(async () => {
                    for (const e of list) await api.remove(full(e), e.type === 'dir' && !e.link)
                  })
                }}
              >
                Excluir
              </button>
            </>
          }
        >
          <p>
            {dialog.entries.length === 1 ? (
              <>
                Excluir <b>{dialog.entries[0].name}</b>
                {dialog.entries[0].type === 'dir' && !dialog.entries[0].link && ' e todo o seu conteúdo'}?
              </>
            ) : (
              <>Excluir {dialog.entries.length} itens (pastas com todo o conteúdo)?</>
            )}
          </p>
          <p className="muted small">Não existe lixeira no servidor: isso não pode ser desfeito.</p>
        </Modal>
      )}
    </section>
  )
}
