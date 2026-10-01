import defaultGuestScript from './guest-setup.sh?raw'
import watcher from './watcher.sh?raw'

// Arranque automático de guests nuevos. La app NUNCA ejecuta nada en el nodo por su cuenta: genera un
// instalador que el usuario pega (y revisa) en el shell de Proxmox. Una vez instalado, un temporizador
// de systemd prepara cada VM/LXC nuevo con el script de guest (ver watcher.sh).

export const DEFAULT_GUEST_SCRIPT: string = normalize(defaultGuestScript)

export const UNINSTALL_COMMAND =
  'systemctl disable --now homelab-provision.timer; rm -f /etc/systemd/system/homelab-provision.service /etc/systemd/system/homelab-provision.timer /usr/local/sbin/homelab-provision; systemctl daemon-reload; rm -rf /etc/homelab /var/lib/homelab-provision'

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n'
}

// Delimitadores de los heredocs del instalador: el script del usuario no puede contener ninguno
const DELIMITERS = ['HL_GUEST_SCRIPT', 'HL_WATCHER', 'HL_SERVICE', 'HL_TIMER', 'HL_INSTALLER']

export function validateGuestScript(script: string): string | null {
  if (!script.trim()) return 'El script está vacío'
  if (script.length > 20000) return 'El script es demasiado largo (máx. 20000 caracteres)'
  if (script.includes('\0')) return 'El script contiene caracteres no válidos'
  for (const d of DELIMITERS) {
    if (script.split('\n').some((l) => l.trim() === d)) return `El script no puede tener una línea que sea solo «${d}»`
  }
  return null
}

// Instalador para pegar en el shell del nodo (root). Es idempotente: volver a ejecutarlo actualiza el
// script de guest y el vigilante sin tocar el estado (los guests ya vistos siguen sin tocarse).
export function buildHostInstaller(guestScript: string): string {
  const guest = normalize(guestScript)
  const w = normalize(watcher)
  return `bash -s <<'HL_INSTALLER'
set -eu
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta esto como root en el shell del nodo Proxmox"; exit 1; }
command -v pct >/dev/null && command -v qm >/dev/null || { echo "Esto no parece un nodo Proxmox VE"; exit 1; }
install -d -m 755 /etc/homelab /var/lib/homelab-provision /var/log/homelab-provision

cat > /etc/homelab/guest-setup.sh <<'HL_GUEST_SCRIPT'
${guest}HL_GUEST_SCRIPT
chmod 644 /etc/homelab/guest-setup.sh

cat > /usr/local/sbin/homelab-provision <<'HL_WATCHER'
${w}HL_WATCHER
chmod 755 /usr/local/sbin/homelab-provision

cat > /etc/systemd/system/homelab-provision.service <<'HL_SERVICE'
[Unit]
Description=HomeLab: preparar VMs y LXC nuevos

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/homelab-provision
HL_SERVICE

cat > /etc/systemd/system/homelab-provision.timer <<'HL_TIMER'
[Unit]
Description=HomeLab: buscar VMs y LXC nuevos cada minuto

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
HL_TIMER

systemctl daemon-reload
systemctl enable --now homelab-provision.timer
/usr/local/sbin/homelab-provision </dev/null
echo "Listo: cada VM/LXC NUEVO se preparará solo (log: /var/log/homelab-provision/). Los que ya existían no se tocan."
HL_INSTALLER
`
}
