#!/bin/sh
# Preparación inicial de un guest NUEVO (LXC o VM). Se ejecuta como root DENTRO del guest.
# Es idempotente: se puede repetir sin problema. Edítalo a tu gusto (Ajustes → Arranque de guests).
set -eu

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a # Ubuntu: no preguntar qué servicios reiniciar

# ¿LXC o VM? (en una VM se instala además el agente que da IP y estado a Proxmox)
if grep -qa 'container=lxc' /proc/1/environ 2>/dev/null; then IS_VM=0; else IS_VM=1; fi

BASE="curl wget ca-certificates nano htop"

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get upgrade -y -o Dpkg::Options::=--force-confold
  apt-get install -y $BASE sudo
  if [ "$IS_VM" = 1 ]; then
    apt-get install -y qemu-guest-agent
    systemctl start qemu-guest-agent 2>/dev/null || true
  fi
elif command -v apk >/dev/null 2>&1; then
  apk update
  apk upgrade
  apk add $BASE sudo
  if [ "$IS_VM" = 1 ]; then
    apk add qemu-guest-agent
    rc-update add qemu-guest-agent default 2>/dev/null || true
    rc-service qemu-guest-agent start 2>/dev/null || true
  fi
elif command -v dnf >/dev/null 2>&1; then
  dnf -y upgrade
  dnf -y install $BASE sudo
  if [ "$IS_VM" = 1 ]; then
    dnf -y install qemu-guest-agent
    systemctl enable --now qemu-guest-agent 2>/dev/null || true
  fi
elif command -v pacman >/dev/null 2>&1; then
  pacman -Syu --noconfirm
  pacman -S --noconfirm --needed $BASE sudo
  if [ "$IS_VM" = 1 ]; then
    pacman -S --noconfirm --needed qemu-guest-agent
    systemctl enable --now qemu-guest-agent 2>/dev/null || true
  fi
else
  echo "Gestor de paquetes no reconocido: no se instaló nada" >&2
  exit 1
fi

# Ejemplos (descomenta lo que quieras que lleve TODO guest nuevo):
# curl -fsSL https://get.docker.com | sh           # Docker
# timedatectl set-timezone America/Santo_Domingo   # zona horaria

echo "Guest preparado."
