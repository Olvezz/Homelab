// Extrae de Simple Icons (CC0) solo los logos que usa la app y los guarda en src/renderer/brands.json.
// Se ejecuta con `npm run icons` si se añade un logo a la lista.
import { writeFileSync } from 'node:fs'
import * as si from 'simple-icons'

const SLUGS = `ubuntu debian fedora archlinux alpinelinux centos rockylinux almalinux opensuse nixos gentoo linux
raspberrypi apple docker portainer adguard tailscale proxmox bitwarden vaultwarden pihole homeassistant nginx
nginxproxymanager traefikproxy caddy grafana prometheus plex jellyfin emby nextcloud truenas synology wireguard
openvpn gitea github gitlab immich sonarr radarr qbittorrent transmission nodered mqtt influxdb postgresql mysql
mariadb mongodb redis minio paperlessngx syncthing uptimekuma cloudflare openwrt pfsense opnsense kubernetes
ansible terraform jenkins mealie audiobookshelf frigate zigbee2mqtt esphome n8n vscodium ollama ubiquiti`.split(/\s+/)

const out = {}
for (const slug of SLUGS) {
  const icon = si['si' + slug[0].toUpperCase() + slug.slice(1)]
  if (!icon) {
    console.warn('no existe en simple-icons:', slug)
    continue
  }
  out[slug] = { title: icon.title, path: icon.path }
}
writeFileSync(new URL('../src/renderer/brands.json', import.meta.url), JSON.stringify(out) + '\n')
console.log(Object.keys(out).length, 'logos')
