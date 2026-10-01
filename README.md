# HomeLab Desktop

Aplicación de escritorio (Electron + React + TypeScript) que reúne en una sola ventana tu Proxmox y los paneles web de tu homelab (Portainer, AdGuard Home, etc.): árbol de nodos/VMs/LXC en vivo, paneles descubiertos automáticamente desde las notas de Proxmox, acciones de energía y consola.

> Estado: **Fases 1 a 5** implementadas. Diseño y decisiones en `PROYECTO.md`.

## Requisitos

- Windows 10/11
- Node.js 20 o superior (probado con 24)

## Uso

```
npm i
npm run dev       # modo desarrollo
npm test          # pruebas (Vitest)
npm run dist      # genera el instalador NSIS en dist/
```

Si `npm i` avisa de scripts de instalación sin aprobar y Electron no arranca ("Electron uninstall"), ejecuta `node node_modules/electron/install.js` una vez.

El icono se regenera con `node scripts/make-icon.mjs` (`resources/icon.png`).

## Primer uso

1. Crea el usuario y el token en el shell de Proxmox (ver abajo).
2. Abre la app: el asistente pide host/puerto, te muestra la **huella SHA-256** del certificado para que la confirmes, y luego el Token ID y el secreto. "Probar conexión" valida con `GET /version`.
3. El árbol aparece en la barra lateral y se actualiza solo (cada 10 s por defecto).

El asistente se puede omitir: los paneles manuales funcionan igual sin conexión al API.

## Token de Proxmox

Usuario dedicado con mínimo privilegio, nunca `root@pam`:

```
pveum user add olvezz@pve --comment "HomeLab Desktop"
pveum acl modify / --users olvezz@pve --roles PVEVMUser
pveum user token add olvezz@pve desktop --privsep 0
```

- `PVEVMUser`: ver + energía + consola.
- Solo lectura: usa `PVEAuditor`. La app lo detecta (403) y deshabilita las acciones de energía.
- Si la IP de una VM por qemu-guest-agent da 403, añade `VM.GuestAgent.Audit` a un rol propio.

El secreto se cifra con Windows (DPAPI, `safeStorage`) y no se guarda en claro nunca. Si el cifrado no estuviera disponible, se pide en cada arranque.

## Descubrimiento automático de paneles

En el campo **Notas** de cada VM/LXC, una línea por panel:

```
panel: Portainer | http://10.0.0.53:9000
panel: AdGuard Home | http://10.0.0.52:3000
```

Formato: `panel: <nombre> | <url>` (el icono se asigna solo; ver *Iconos*). Alternativa por **tag**: `web-9000` (o `web-9000-https`) crea un panel `http(s)://<IP del guest>:9000` con el nombre del guest (los tags de Proxmox no admiten `:` ni `/`).

- Aparecen bajo su guest y en la sección **Paneles** en ≤ 60 s (o con *Refrescar* / `Ctrl+Shift+R`); si borras la línea, desaparecen (su sesión se conserva en disco).
- Solo se aceptan URLs `http` y `https`. Los hosts **fuera de rangos privados** (10/8, 172.16/12, 192.168/16, 100.64/10 Tailscale) quedan pendientes hasta que los apruebes en Ajustes → Diagnóstico.
- Las líneas mal formadas no rompen nada: se listan en Ajustes → Diagnóstico, junto a los guests sin IP detectada y los permisos que falten.

## Uso diario

- **Clic** en un guest con un solo panel lo abre; con varios, se expande. Un guest sin paneles se abre en la web de Proxmox.
- **Clic derecho**: Iniciar, Apagar, Reiniciar, Forzar apagado (con confirmación), Abrir consola, Abrir en Proxmox, Copiar IP, Refrescar. El resultado de la tarea (UPID) aparece como aviso en la barra superior.
- La consola (xterm.js / noVNC, también con el botón ⌨ de cada guest) se abre en una pestaña que comparte la sesión web de Proxmox: inicia sesión una vez en el panel Proxmox.
- Cada guest encendido tiene un botón de consola (⌨) al pasar el ratón.
- Atajos: `Ctrl+K` buscar, `Ctrl+1..9` paneles, `Ctrl+R` recargar la vista, `Ctrl+Shift+R` refrescar datos de Proxmox, `Ctrl+B` colapsar la barra, `F11` pantalla completa.
- La barra lateral se redimensiona arrastrando su borde y se colapsa a iconos.
- Bandeja del sistema: Mostrar / Refrescar / Salir. Cerrar la ventana la manda a la bandeja (configurable) y se puede iniciar con Windows.

## Tema (ProxMorph)

La app usa los temas de [ProxMorph](https://github.com/IT-BAER/proxmorph), el mismo que tiene instalado el Proxmox (24 temas: GitHub Dark, Dracula, Nord, Catppuccin, Tokyo Night…).

- **Seguir a Proxmox** (por defecto): elige el tema desde la propia web de Proxmox (menú de usuario → *Color Theme*, en el panel Proxmox de la app). Proxmox lo guarda en la cookie `PVEThemeCookie` y la app lo adopta al instante. Sin cookie usa GitHub Dark.
- O fija uno en Ajustes → Apariencia (oscuros, claros, "claro básico" o "del sistema").
- Las paletas salen de las variables `--pwt-*` de cada tema (`src/shared/themes.json`). Cuando ProxMorph publique temas nuevos: `npm run themes`.
- Las vistas web (Portainer, AdGuard…) siguen el claro/oscuro del tema elegido.

## Otras webs como panel

Cualquier URL `http(s)` sirve: Ajustes → Añadir panel (p. ej. `https://vault.bitwarden.com/#/vault`). Cada panel guarda su sesión aparte. Limitaciones: los enlaces a otros orígenes (p. ej. un SSO externo) se abren en el navegador, y solo se permite el permiso de escribir en el portapapeles (copiar contraseñas); cámara, micrófono, ubicación y demás siguen denegados.

## Iconos

Todos los iconos son SVG monocromos que toman el color del tema (logos de [Simple Icons](https://simpleicons.org), CC0, e iconos de interfaz de [Lucide](https://lucide.dev)). Se asignan solos, sin emojis:

- **Guests:** el icono muestra su **función**, no el sistema operativo (varios Ubuntu Server pueden hacer cosas distintas). Orden: tags (p. ej. `adguard`) → servicios que sirve (los paneles de sus notas: con un panel de Portainer sale el logo de Docker, con uno de AdGuard el de AdGuard) → nombre → notas → y solo al final el SO real (`ostype` en LXC; en VM, el que informa el qemu-guest-agent). El SO se ve en el tooltip. Sin ninguna pista: contenedor o equipo genérico.
- **Paneles:** por el nombre, el nombre del host de la URL (`vault.bitwarden.com`), algunos puertos inequívocos (8006, 8123…) o, si no, el icono del guest al que pertenecen.
- Se puede forzar otro al editar un panel manual (Ajustes). Un logo nuevo: añádelo a `scripts/build-icons.mjs`, `npm run icons`, y una regla en `src/shared/icons.ts`.

## Actualizaciones y datos

- La app busca versiones nuevas al arrancar y cada 6 h, las descarga en segundo plano y avisa en la barra lateral: **Reiniciar e instalar**. Se puede desactivar o forzar la búsqueda en Ajustes → Actualizaciones, o desde la bandeja.
- Solo se descargan por HTTPS desde las versiones publicadas del repositorio (`publish` en `electron-builder.yml`) y se valida el sha512 de cada instalador. Solo funciona en la app instalada, no con `npm run dev`.
- **Tus datos no se pierden:** conexión, token cifrado, paneles, ajustes y sesiones viven en `%APPDATA%\homelab-desktop`, fuera de la carpeta de la app; actualizar o reinstalar no los toca ni se borran al desinstalar. Al cambiar de versión se guarda además una copia (`config.backup-v<versión>.json`, las 5 últimas). Un archivo ilegible se aparta como `config.corrupt-….json` en vez de sobrescribirse, y un panel dañado no hace perder los demás.
- Cómo saber qué versión corre: Ajustes (abajo del todo) muestra versión y fecha de compilación.

### Publicar una actualización

1. Sube `version` en `package.json` (p. ej. 0.2.1).
2. Con un token de GitHub con permiso `repo` en la variable `GH_TOKEN`: `npm run release` (compila, genera el instalador y `latest.yml` y los sube como release).
3. Las instalaciones existentes la detectan en ≤ 6 h o al pulsar *Buscar ahora*.

> Nota: el instalador no está firmado con certificado de código. La integridad de las actualizaciones se apoya en HTTPS y en el hash de `latest.yml`; quien controle el repositorio controla las actualizaciones.

## Certificados autofirmados

- **API**: pinning por huella SHA-256. La conexión se verifica antes de enviar nada, así el token nunca viaja a un servidor con otro certificado. Si la huella cambia, el sondeo se detiene y el estado pasa a "El certificado cambió" hasta que lo re-confíes en el asistente.
- **Vistas web**: si un panel https usa un certificado no reconocido, la app muestra su huella y pregunta (confianza en el primer uso). A partir de ahí solo se acepta ese certificado exacto para ese host. No se desactiva nunca la verificación TLS de forma global.

## Seguridad

- `contextIsolation`, `sandbox` y sin `nodeIntegration` en todas las vistas; CSP estricta en la UI propia.
- IPC validado con `zod` y limitado al frame principal de la ventana; lista blanca de acciones.
- Las notas y tags de Proxmox son datos no confiables: se parsean con lista blanca y nunca se inyectan como HTML.
- Permisos del navegador (cámara, micrófono, ubicación…) denegados; enlaces a otros orígenes se abren en el navegador externo.
- Una sola instancia. Actualizaciones solo por HTTPS desde el repositorio configurado, con hash verificado.

## Datos y logs

- Configuración: `%APPDATA%\homelab-desktop\config.json`.
- Logs rotativos (sin secretos): `%APPDATA%\homelab-desktop\logs\app.log`.
