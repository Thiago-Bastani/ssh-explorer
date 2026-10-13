# SSH Explorer

Explorador de arquivos + terminal sobre **uma única conexão SSH** (porta 22).

- Navegação de pastas, upload (arrastar do Windows Explorer ou botão), download, renomear, excluir, nova pasta
- Terminal embutido (xterm.js) com opção de sincronizar `cd` com a pasta aberta
- Transferências via SFTP; se o servidor não tiver o subsistema sftp, cai automaticamente para `scp` pelo canal exec
- Verificação de host key (fingerprint SHA256), salva em `%APPDATA%/ssh-explorer/known_hosts.json`
- Autenticação por senha, chave privada ou ssh-agent do Windows

## Rodar

```bash
npm install
npm run dev        # desenvolvimento com hot reload
npm run dist       # gera instalador .exe em dist/
```

## Estrutura

```
src/
  shared/types.ts        contrato IPC entre UI e Node
  main/index.ts          janela Electron, IPC, known_hosts
  main/session.ts        conexão ssh2, terminal, transferências recursivas
  main/backends.ts       SftpBackend e ScpBackend (fallback)
  preload/index.ts       expõe window.api (contextIsolation)
  renderer/src/          React: ConnectForm, Explorer, Terminal, Transfers
```

## Atalhos

| Tecla | Ação |
|---|---|
| Enter / duplo clique | Abrir pasta / baixar arquivo |
| Backspace | Pasta acima |
| Alt+← / Alt+→ | Voltar / avançar |
| F2 | Renomear |
| Delete | Excluir |
| F5 | Atualizar |
| Ctrl+A | Selecionar tudo |
| Ctrl+Shift+C / V | Copiar / colar no terminal |
