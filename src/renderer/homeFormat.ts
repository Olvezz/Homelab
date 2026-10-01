// Formatos de números para el panel de inicio (español, base 1024 como en Proxmox)

export const fmtPct = (fraction: number, decimals = 0): string => `${(fraction * 100).toFixed(decimals)} %`

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`
}

export const fmtRate = (n: number): string => `${fmtBytes(n)}/s`

export function fmtUptime(seconds: number): string {
  if (!seconds || seconds < 60) return '< 1 min'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} min`
  return `${m} min`
}

export function fmtClock(epochSeconds: number, withDate = false): string {
  const d = new Date(epochSeconds * 1000)
  const time = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  return withDate ? `${d.toLocaleDateString('es', { day: '2-digit', month: 'short' })} ${time}` : time
}

export function fmtDay(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('es', { weekday: 'short', day: '2-digit' })
}

export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 5) return 'ahora'
  if (s < 60) return `hace ${s} s`
  return `hace ${Math.round(s / 60)} min`
}

// Techo «redondo» para el eje Y: 1, 2, 2.5, 5 × 10^n
export function niceMax(max: number): number {
  if (!(max > 0)) return 1
  const exp = Math.floor(Math.log10(max))
  const f = max / 10 ** exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * 10 ** exp
}

export const TASK_LABEL: Record<string, string> = {
  qmstart: 'Iniciar VM',
  qmstop: 'Detener VM',
  qmshutdown: 'Apagar VM',
  qmreboot: 'Reiniciar VM',
  qmreset: 'Reset de VM',
  qmcreate: 'Crear VM',
  qmdestroy: 'Eliminar VM',
  qmclone: 'Clonar VM',
  qmsnapshot: 'Snapshot de VM',
  qmigrate: 'Migrar VM',
  vzstart: 'Iniciar LXC',
  vzstop: 'Detener LXC',
  vzshutdown: 'Apagar LXC',
  vzreboot: 'Reiniciar LXC',
  vzcreate: 'Crear LXC',
  vzdestroy: 'Eliminar LXC',
  vzdump: 'Copia de seguridad',
  aptupdate: 'Actualizar lista de paquetes',
  vncproxy: 'Consola',
  vncshell: 'Shell',
  termproxy: 'Terminal',
  download: 'Descarga',
  imgcopy: 'Copiar imagen',
  srvstart: 'Iniciar servicio',
  srvstop: 'Detener servicio',
  srvrestart: 'Reiniciar servicio'
}
