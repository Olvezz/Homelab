#!/bin/bash
# homelab-provision — corre en el nodo Proxmox (temporizador de systemd, cada minuto).
# Aplica /etc/homelab/guest-setup.sh a cada LXC/VM NUEVO, una sola vez.
# Los guests que ya existían al instalar se marcan como "baseline" y no se tocan.
set -u

STATE_DIR="${HL_STATE_DIR:-/var/lib/homelab-provision}"
SETUP="${HL_SETUP_SCRIPT:-/etc/homelab/guest-setup.sh}"
LOG_DIR="${HL_LOG_DIR:-/var/log/homelab-provision}"
MAX_TRIES=5

mkdir -p "$STATE_DIR" "$LOG_DIR"
exec 9>"$STATE_DIR/.lock"
flock -n 9 || exit 0 # ya hay una pasada en curso

log() { echo "$(date '+%F %T') $*" >> "$LOG_DIR/watcher.log"; }

# "id estado" de cada guest
lxc_list() { pct list 2>/dev/null | awk 'NR>1 {print $1" "$2}'; }
vm_list() { qm list 2>/dev/null | awk 'NR>1 {print $1" "$3}'; }

ALL_IDS="$( (lxc_list; vm_list) | awk '{print $1}' | sort -u)"

# Primera pasada: todo lo que ya existe queda como baseline (no se modifica nada)
if [ ! -e "$STATE_DIR/.initialized" ]; then
  for id in $ALL_IDS; do echo baseline > "$STATE_DIR/$id"; done
  touch "$STATE_DIR/.initialized"
  log "instalación: $(echo "$ALL_IDS" | wc -w) guests existentes marcados como baseline"
  exit 0
fi

# Guests borrados: se olvida su estado (así un VMID reutilizado cuenta como nuevo)
for f in "$STATE_DIR"/[0-9]*; do
  [ -e "$f" ] || continue
  id="$(basename "$f")"
  echo "$ALL_IDS" | grep -qx "$id" || rm -f "$f"
done

# Devuelve 0 si hay que saltarse este guest
should_skip() {
  local id="$1" s
  [ -e "$STATE_DIR/$id" ] || return 1
  s="$(cat "$STATE_DIR/$id")"
  case "$s" in
    baseline | done) return 0 ;;
    fail:*) [ "${s#fail:}" -ge "$MAX_TRIES" ] && return 0 ;;
  esac
  return 1
}

mark_failure() {
  local id="$1" n=0
  [ -e "$STATE_DIR/$id" ] && n="$(sed -n 's/^fail:\([0-9]*\)$/\1/p' "$STATE_DIR/$id")"
  n=$(( ${n:-0} + 1 ))
  echo "fail:$n" > "$STATE_DIR/$id"
  log "$1: falló (intento $n de $MAX_TRIES); ver $LOG_DIR/$1.log"
}

# --- LXC ---
while read -r id status; do
  [ -n "${id:-}" ] || continue
  should_skip "$id" && continue
  if pct config "$id" 2>/dev/null | grep -q '^template: 1'; then echo baseline > "$STATE_DIR/$id"; continue; fi
  [ "$status" = "running" ] || continue
  log "LXC $id: preparando"
  if pct exec "$id" -- sh -s < "$SETUP" > "$LOG_DIR/$id.log" 2>&1; then
    echo done > "$STATE_DIR/$id"
    log "LXC $id: listo"
  else
    mark_failure "$id"
  fi
done < <(lxc_list)

# --- VM (necesitan qemu-guest-agent ya activo; lo ideal es llevarlo en la plantilla) ---
while read -r id status; do
  [ -n "${id:-}" ] || continue
  should_skip "$id" && continue
  cfg="$(qm config "$id" 2>/dev/null)"
  if echo "$cfg" | grep -q '^template: 1'; then echo baseline > "$STATE_DIR/$id"; continue; fi
  # Windows y similares no ejecutan sh: no se tocan
  if echo "$cfg" | grep -qi '^ostype: w'; then echo baseline > "$STATE_DIR/$id"; continue; fi
  [ "$status" = "running" ] || continue
  # Sin agente no se puede ejecutar nada dentro: se reintenta en la siguiente pasada
  qm agent "$id" ping > /dev/null 2>&1 || continue
  log "VM $id: preparando"
  out="$(qm guest exec "$id" --timeout 1800 --pass-stdin 1 -- sh -s < "$SETUP" 2> "$LOG_DIR/$id.log")"
  echo "$out" >> "$LOG_DIR/$id.log"
  if echo "$out" | grep -Eq '"exitcode"[[:space:]]*:[[:space:]]*0'; then
    echo done > "$STATE_DIR/$id"
    log "VM $id: listo"
  else
    mark_failure "$id"
  fi
done < <(vm_list)

exit 0
