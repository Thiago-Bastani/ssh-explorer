import { useEffect, useRef, useState, type ReactNode } from 'react'

interface ModalProps {
  title: string
  children: ReactNode
  actions: ReactNode
  onClose(): void
}

export function Modal({ title, children, actions, onClose }: ModalProps): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  )
}

/** Substitui window.prompt, que não existe no Electron. */
export function PromptModal(props: {
  title: string
  label: string
  initial?: string
  /** Campo de senha: sem trim, sem texto visível. */
  password?: boolean
  error?: string
  confirm: string
  onSubmit(value: string): void
  onClose(): void
}): React.JSX.Element {
  const [value, setValue] = useState(props.initial ?? '')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    // Seleciona só o nome, sem a extensão (como o Explorer faz no F2).
    const dot = value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : value.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = (): void => {
    const v = props.password ? value : value.trim()
    if (v) props.onSubmit(v)
  }

  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      actions={
        <>
          <button onClick={props.onClose}>Cancelar</button>
          <button className="primary" onClick={submit}>
            {props.confirm}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{props.label}</span>
        <input
          ref={input}
          type={props.password ? 'password' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      {props.error && <p className="error small">{props.error}</p>}
    </Modal>
  )
}
