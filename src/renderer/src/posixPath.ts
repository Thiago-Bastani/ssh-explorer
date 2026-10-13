// Mini path.posix para o renderer (que não tem acesso a módulos do Node).
function normalize(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.')
}

export default {
  join: (...parts: string[]): string => normalize(parts.filter(Boolean).join('/')),
  dirname: (p: string): string => normalize(p + '/..'),
  basename: (p: string): string => normalize(p).split('/').pop() || '/',
  normalize
}
