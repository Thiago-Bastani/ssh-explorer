export type FileKind = 'image' | 'pdf' | 'text'

/** Acima disso o leitor/editor recusa e sugere baixar (nada é lido do servidor). */
export const VIEW_MAX = 20 * 1024 * 1024
export const EDIT_MAX = 1024 * 1024

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  pdf: 'application/pdf'
}

const TEXT_EXT = new Set(
  ('txt md json jsonc yml yaml toml ini cfg conf env log sh bash zsh py js mjs cjs ts jsx tsx css scss html xml ' +
    'csv sql php rb go rs java c h cpp hpp service timer properties gitignore dockerignore editorconfig').split(' ')
)
const TEXT_NAMES = new Set(['dockerfile', 'makefile', 'readme', 'license', 'hosts', 'fstab', 'crontab', 'exports'])

const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Como abrir um arquivo ao dar duplo clique; null = só baixar. */
export function fileKind(name: string): FileKind | null {
  const n = name.toLowerCase()
  if (n === '.env' || n.startsWith('.env.') || n.endsWith('.env')) return 'text'
  const ext = extOf(n)
  if (ext === 'pdf') return 'pdf'
  if (MIME[ext]) return 'image'
  if (TEXT_EXT.has(ext) || TEXT_NAMES.has(n)) return 'text'
  // Dotfiles sem extensão: .bashrc, .profile, .gitignore…
  if (n.startsWith('.') && !n.slice(1).includes('.')) return 'text'
  return null
}

export const mimeOf = (name: string): string => MIME[extOf(name)] ?? 'application/octet-stream'
