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

    // Ctrl+Shift+C / Ctrl+Shift+V para copiar/colar, como nos terminais Linux.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
      if (e.code === 'KeyC') {
        navigator.clipboard.writeText(term.getSelection())
        return false
      }
      if (e.code === 'KeyV') {
        navigator.clipboard.readText().then((t) => term.paste(t))
        return false
      }
      return true
    })

    const offData = api.onTermData((d) => term.write(d))
    const input = term.onData((d) => api.termWrite(d))
    api.termStart(term.cols, term.rows).catch((e) => term.write(`\x1b[31m${errMsg(e)}\x1b[0m\r\n`))

    const ro = new ResizeObserver(() => {
      if (!host.current?.offsetHeight) return
      fit.fit()
      api.termResize(term.cols, term.rows)
    })
    ro.observe(host.current!)

    return () => {
      ro.disconnect()
      input.dispose()
      offData()
      term.dispose()
    }
  }, [])

  return <div className="terminal-host" ref={host} />
}
