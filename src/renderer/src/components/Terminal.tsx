import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api, errMsg } from '../util'

export function Terminal(): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new XTerm({
      fontFamily: 'Cascadia Mono, Consolas, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: '#14161b', foreground: '#d7dae0', cursor: '#7aa2f7', selectionBackground: '#3b4261' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    fit.fit()

    // Copiar/colar pelo clipboard do sistema (via main, mais confiável que navigator.clipboard).
    const copy = (): void => {
      const sel = term.getSelection()
      if (!sel) return
      api.clipboardWrite(sel)
      term.clearSelection()
    }
    const paste = (): void => {
      api.clipboardRead().then((t) => t && term.paste(t))
    }

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      // Ctrl+C com texto selecionado copia; sem seleção continua sendo o Ctrl+C (SIGINT) de sempre.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyC' && term.hasSelection()) {
        copy()
        return false
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') return copy(), false
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') return paste(), false
      if (e.ctrlKey && !e.shiftKey && e.code === 'Insert') return copy(), false
      if (e.shiftKey && !e.ctrlKey && e.code === 'Insert') return paste(), false
      return true
    })

    // Botão direito, como no Windows Terminal: com seleção copia, sem seleção cola.
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      if (term.hasSelection()) copy()
      else paste()
    }
    host.current!.addEventListener('contextmenu', onContextMenu)

    const offData = api.onTermData((d) => term.write(d))
    const input = term.onData((d) => api.termWrite(d))
    api.termStart(term.cols, term.rows).catch((e) => term.write(`\x1b[31m${errMsg(e)}\x1b[0m\r\n`))

    const ro = new ResizeObserver(() => {
      if (!host.current?.offsetHeight) return
      fit.fit()
      api.termResize(term.cols, term.rows)
    })
    ro.observe(host.current!)

    const hostEl = host.current!
    return () => {
      hostEl.removeEventListener('contextmenu', onContextMenu)
      ro.disconnect()
      input.dispose()
      offData()
      term.dispose()
    }
  }, [])

  return <div className="terminal-host" ref={host} />
}
