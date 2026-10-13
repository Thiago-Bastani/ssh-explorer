import { useEffect, useState } from 'react'
import type { ConnectOptions, ConnectResult, HostKeyPrompt } from '@shared/types'
import { ConnectForm } from './components/ConnectForm'
import { Workspace } from './components/Workspace'
import { Modal } from './components/Modal'
import { api } from './util'

interface Connection {
  opts: ConnectOptions
  result: ConnectResult
}

export function App(): React.JSX.Element {
  const [conn, setConn] = useState<Connection | null>(null)
  const [hostKey, setHostKey] = useState<HostKeyPrompt | null>(null)
  const [dropped, setDropped] = useState<string | null>(null)

  useEffect(() => api.onHostKey(setHostKey), [])
  useEffect(
    () =>
      api.onDisconnected((reason) => {
        setConn(null)
        setDropped(reason)
      }),
    []
  )

  const answer = (accept: boolean): void => {
    if (hostKey) api.answerHostKey(hostKey.requestId, accept)
    setHostKey(null)
  }

  return (
    <>
      {conn ? (
        <Workspace
          opts={conn.opts}
          result={conn.result}
          onDisconnect={() => {
            api.disconnect()
            setConn(null)
          }}
        />
      ) : (
        <ConnectForm
          notice={dropped}
          onConnected={(opts, result) => {
            setDropped(null)
            setConn({ opts, result })
          }}
        />
      )}

      {hostKey && (
        <Modal
          title={hostKey.previous ? '⚠ O host key MUDOU' : 'Host desconhecido'}
          onClose={() => answer(false)}
          actions={
            <>
              <button onClick={() => answer(false)}>Cancelar</button>
              <button className={hostKey.previous ? 'danger' : 'primary'} onClick={() => answer(true)} autoFocus>
                {hostKey.previous ? 'Confiar mesmo assim' : 'Confiar e conectar'}
              </button>
            </>
          }
        >
          {hostKey.previous ? (
            <p>
              A identidade de <b>{hostKey.host}</b> é diferente da que foi salva. Pode ser uma reinstalação do
              servidor — ou alguém interceptando a conexão. Só continue se souber o motivo.
            </p>
          ) : (
            <p>
              Primeira conexão com <b>{hostKey.host}:{hostKey.port}</b>. Confira se o fingerprint bate com o do servidor
              (<code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>).
            </p>
          )}
          {hostKey.previous && (
            <p className="fp">
              Antes: <code>{hostKey.previous}</code>
            </p>
          )}
          <p className="fp">
            {hostKey.previous ? 'Agora: ' : ''}
            <code>{hostKey.fingerprint}</code>
          </p>
        </Modal>
      )}
    </>
  )
}
