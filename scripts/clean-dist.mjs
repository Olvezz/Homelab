// Borra dist antes de empaquetar: así solo queda el instalador de la versión actual
// (electron-builder no elimina los de versiones anteriores).
import { rmSync } from 'node:fs'

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true })
