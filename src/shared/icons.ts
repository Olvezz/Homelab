// Asignación automática de iconos. Una clave es el nombre de un logo de marca (Simple Icons, ver
// `src/renderer/brands.json`) o `ui:<nombre>` para un icono genérico de interfaz (Lucide).

export type IconKey = string

// Orden = prioridad: lo más específico primero (nginx-proxy-manager antes que nginx, vaultwarden antes que bitwarden…)
const RULES: [IconKey, RegExp][] = [
  ['portainer', /portainer/],
  ['adguard', /adguard/],
  ['pihole', /pi-?hole/],
  ['tailscale', /tailscale/],
  ['vaultwarden', /vaultwarden/],
  ['bitwarden', /bitwarden/],
  ['nginxproxymanager', /nginx[\s_-]?proxy[\s_-]?manager/],
  ['nginx', /nginx/],
  ['traefikproxy', /traefik/],
  ['caddy', /\bcaddy\b/],
  ['homeassistant', /home[\s_-]?assistant|\bhass\b|\bhaos\b/],
  ['proxmox', /proxmox|\bpve\b/],
  ['docker', /docker/],
  ['kubernetes', /kubernetes|\bk8s\b|\bk3s\b/],
  ['grafana', /grafana/],
  ['prometheus', /prometheus/],
  ['influxdb', /influx/],
  ['plex', /\bplex\b/],
  ['jellyfin', /jellyfin/],
  ['ui:clapperboard', /jellyseerr|overseerr/], // Simple Icons no tiene su logo
  ['emby', /\bemby\b/],
  ['nextcloud', /nextcloud/],
  ['truenas', /truenas|freenas/],
  ['synology', /synology|\bdsm\b/],
  ['ubiquiti', /unifi|ubiquiti/],
  ['wireguard', /wireguard|wg-easy/],
  ['openvpn', /openvpn/],
  ['gitea', /gitea|forgejo/],
  ['gitlab', /gitlab/],
  ['github', /github/],
  ['immich', /immich/],
  ['sonarr', /sonarr/],
  ['radarr', /radarr/],
  ['qbittorrent', /qbittorrent/],
  ['transmission', /transmission/],
  ['nodered', /node-?red/],
  ['mqtt', /mosquitto|\bmqtt\b/],
  ['postgresql', /postgres/],
  ['mariadb', /mariadb/],
  ['mysql', /mysql/],
  ['mongodb', /mongo/],
  ['redis', /\bredis\b/],
  ['minio', /minio/],
  ['paperlessngx', /paperless/],
  ['syncthing', /syncthing/],
  ['uptimekuma', /uptime[\s_-]?kuma/],
  ['cloudflare', /cloudflare/],
  ['openwrt', /openwrt/],
  ['opnsense', /opnsense/],
  ['pfsense', /pfsense/],
  ['mealie', /mealie/],
  ['audiobookshelf', /audiobookshelf/],
  ['frigate', /frigate/],
  ['zigbee2mqtt', /zigbee2mqtt/],
  ['esphome', /esphome/],
  ['n8n', /\bn8n\b/],
  ['ollama', /ollama/],
  ['ansible', /ansible/],
  ['terraform', /terraform/],
  ['jenkins', /jenkins/],
  // Sistemas operativos
  ['ubuntu', /ubuntu/],
  ['debian', /debian/],
  ['fedora', /fedora/],
  ['archlinux', /\barch(\s?linux)?\b/],
  ['alpinelinux', /alpine/],
  ['rockylinux', /rocky/],
  ['almalinux', /alma[\s_-]?linux/],
  ['centos', /centos/],
  ['opensuse', /opensuse|\bsuse\b/],
  ['nixos', /nixos/],
  ['gentoo', /gentoo/],
  ['raspberrypi', /raspberry|raspbian|\brpi\b/],
  ['ui:windows', /windows|\bwin(10|11|\d{4})\b|\bwsl\b/],
  ['apple', /macos|\bosx\b/]
]

// Servicios identificables por su puerto habitual (solo los que no admiten dudas)
const PORT_HINTS: Record<string, IconKey> = {
  '8006': 'proxmox',
  '8123': 'homeassistant',
  '32400': 'plex',
  '8096': 'jellyfin',
  '8384': 'syncthing',
  '9000': 'portainer'
}

// `ostype` de Proxmox: LXC (ubuntu, debian, alpine…) y QEMU (l26, win11…)
const OSTYPE: Record<string, IconKey> = {
  ubuntu: 'ubuntu',
  debian: 'debian',
  devuan: 'debian',
  alpine: 'alpinelinux',
  archlinux: 'archlinux',
  centos: 'centos',
  fedora: 'fedora',
  opensuse: 'opensuse',
  nixos: 'nixos',
  gentoo: 'gentoo',
  l24: 'linux',
  l26: 'linux',
  solaris: 'ui:server',
  other: 'ui:monitor'
}

// Identificador de sistema que informa el qemu-guest-agent (/etc/os-release `ID`, o mswindows)
function osIdIcon(osId: string | undefined): IconKey | null {
  if (!osId) return null
  if (osId === 'mswindows' || osId.startsWith('windows')) return 'ui:windows'
  const map: Record<string, IconKey> = {
    ubuntu: 'ubuntu',
    debian: 'debian',
    raspbian: 'raspberrypi',
    fedora: 'fedora',
    arch: 'archlinux',
    archlinux: 'archlinux',
    alpine: 'alpinelinux',
    centos: 'centos',
    rocky: 'rockylinux',
    almalinux: 'almalinux',
    nixos: 'nixos',
    gentoo: 'gentoo',
    opensuse: 'opensuse',
    'opensuse-leap': 'opensuse',
    'opensuse-tumbleweed': 'opensuse',
    sles: 'opensuse',
    macos: 'apple'
  }
  return map[osId] ?? null
}

function osTypeIcon(osType: string | undefined): IconKey | null {
  if (!osType) return null
  if (/^w(2k|xp|vista|\d)/.test(osType) || osType.startsWith('win')) return 'ui:windows'
  return OSTYPE[osType] ?? null
}

function firstMatch(text: string): IconKey | null {
  const t = text.toLowerCase()
  if (!t) return null
  for (const [key, re] of RULES) if (re.test(t)) return key
  return null
}

export interface GuestIconInfo {
  name: string
  type: 'qemu' | 'lxc'
  tags?: string[]
  description?: string
  osType?: string // `ostype` de la configuración (LXC: distro exacta; VM: l26, win11…)
  osId?: string // sistema real informado por el qemu-guest-agent
  panelIcons?: IconKey[] // iconos de los paneles que sirve el guest (descubiertos por notas/tags)
}

// Un guest que sirve Portainer es, a efectos prácticos, un host Docker
const SERVICE_AS_GUEST: Record<string, IconKey> = { portainer: 'docker' }

// El icono muestra la FUNCIÓN del guest (varios Ubuntu Server pueden hacer cosas distintas), no el SO:
// tags -> servicios que sirve (iconos de sus paneles) -> nombre -> notas (sin las líneas `panel:`)
// -> sistema real (guest-agent / `ostype`) -> genérico. El SO queda como último recurso y en el tooltip.
export function iconForGuest(g: GuestIconInfo): IconKey {
  const byTags = firstMatch((g.tags ?? []).join(' '))
  if (byTags) return byTags
  const service = (g.panelIcons ?? []).find((k) => !k.startsWith('ui:'))
  if (service) return SERVICE_AS_GUEST[service] ?? service
  const byName = firstMatch(g.name)
  if (byName) return byName
  const notes = (g.description ?? '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*panel\s*:/i.test(l))
    .join(' ')
    .slice(0, 400)
  const byNotes = firstMatch(notes)
  if (byNotes) return byNotes
  const real = osIdIcon(g.osId)
  if (real) return real
  const os = osTypeIcon(g.osType)
  if (os) return os
  return g.type === 'lxc' ? 'ui:box' : 'ui:monitor'
}

export interface PanelIconInfo {
  name: string
  url: string
  icon?: string
  siteUrl?: string
}

// Icono explícito (si es válido) -> nombre/URL del panel -> puerto -> el del guest -> globo
export function iconForPanel(
  p: PanelIconInfo,
  guest: GuestIconInfo | undefined,
  isKnown: (key: string) => boolean
): IconKey {
  const explicit = p.icon?.trim().toLowerCase()
  if (explicit && isKnown(explicit)) return explicit

  let host = ''
  let port = ''
  let path = ''
  try {
    const u = new URL(p.url)
    host = u.hostname
    port = u.port
    path = u.pathname
  } catch {
    // URL ilegible: solo cuenta el nombre
  }
  const byName = firstMatch(p.name)
  if (byName) return byName
  // El nombre del host cuenta (vault.bitwarden.com, portainer.casa.lan), una IP no
  if (!/^[\d.:[\]]+$/.test(host)) {
    const byHost = firstMatch(`${host} ${path}`)
    if (byHost) return byHost
  }
  // El sitio oficial (nginxproxymanager.com, adguard.com…) delata el servicio aunque el nombre sea una sigla
  if (p.siteUrl) {
    try {
      const bySite = firstMatch(new URL(p.siteUrl).hostname.replace(/\./g, ' '))
      if (bySite) return bySite
    } catch {
      // siteUrl ilegible: se ignora
    }
  }
  if (port && PORT_HINTS[port]) return PORT_HINTS[port]
  if (guest) return iconForGuest(guest)
  return 'ui:globe'
}
