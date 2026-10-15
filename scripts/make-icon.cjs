// Gera build/icon.ico (16–256 px) e build/icon.png (512 px) a partir de build/icon.svg.
// Uso: node_modules/electron/dist/electron.exe scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'build/icon.svg'), 'utf8')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function render(win, size) {
  win.setContentSize(size, size)
  const html = `<style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 150))
  let img = await win.webContents.capturePage()
  if (img.getSize().width !== size) img = img.resize({ width: size, height: size, quality: 'best' })
  return img.toPNG()
}

function buildIco(pngs) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2) // tipo: ícone
  head.writeUInt16LE(pngs.length, 4)
  let offset = 6 + 16 * pngs.length
  const dir = pngs.map(({ size, png }) => {
    const e = Buffer.alloc(16)
    e[0] = size === 256 ? 0 : size
    e[1] = size === 256 ? 0 : size
    e.writeUInt16LE(1, 4) // planos
    e.writeUInt16LE(32, 6) // bits por pixel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    return e
  })
  return Buffer.concat([head, ...dir, ...pngs.map((p) => p.png)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, width: 256, height: 256, useContentSize: true })
  const pngs = []
  for (const size of SIZES) pngs.push({ size, png: await render(win, size) })
  fs.writeFileSync(path.join(root, 'build/icon.ico'), buildIco(pngs))
  fs.writeFileSync(path.join(root, 'build/icon.png'), await render(win, 512))
  app.quit()
})
