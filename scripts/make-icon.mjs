// Genera resources/icon.png (256x256) sin dependencias: un "rack" de servidor con la paleta GitHub Dark.
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const N = 256
const px = new Uint8Array(N * N * 4)
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

// Cobertura de un rectángulo redondeado en (x, y) con supermuestreo 4x4
function inRound(x, y, x0, y0, w, h, r) {
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r)
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r)
  return x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h && (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
function paint(x0, y0, w, h, r, color) {
  const [cr, cg, cb] = hex(color)
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      let hit = 0
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) hit += inRound(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4, x0, y0, w, h, r) ? 1 : 0
      const a = hit / 16
      if (!a) continue
      const i = (y * N + x) * 4
      const ba = px[i + 3] / 255
      const oa = a + ba * (1 - a)
      for (const [k, c] of [cr, cg, cb].entries()) px[i + k] = Math.round((c * a + px[i + k] * ba * (1 - a)) / oa)
      px[i + 3] = Math.round(oa * 255)
    }
  }
}

paint(8, 8, 240, 240, 52, '#0d1117')
paint(8, 8, 240, 240, 52, '#0d1117')
paint(12, 12, 232, 232, 48, '#161b22')
for (let i = 0; i < 3; i++) {
  const y = 52 + i * 52
  paint(44, y, 168, 40, 10, '#0d1117')
  paint(48, y + 4, 160, 32, 8, '#21262d')
  paint(60, y + 14, 12, 12, 6, i === 1 ? '#f47067' : '#3fb950')
  paint(150, y + 16, 44, 8, 4, '#3d444d')
}

const rows = Buffer.alloc((N * 4 + 1) * N)
for (let y = 0; y < N; y++) {
  rows[y * (N * 4 + 1)] = 0
  Buffer.from(px.buffer, y * N * 4, N * 4).copy(rows, y * (N * 4 + 1) + 1)
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0)
ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(rows)),
  chunk('IEND', Buffer.alloc(0))
])
writeFileSync(new URL('../resources/icon.png', import.meta.url), png)
console.log('icon.png', png.length, 'bytes')
