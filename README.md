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
- **Estado de los paneles:** cada panel de la barra lateral lleva un punto: verde = **en uso** (su vista está abierta), ámbar = cargando, rojo = no se pudo cargar, hueco = apagado (no abierto en esta sesión). El **candado** indica que hay una sesión guardada (cookies) para ese sitio, es decir, que ya iniciaste sesión; el tooltip añade cuándo lo usaste por última vez. Las vistas se abren al primer uso; con clic derecho → *Apagar vista* se libera su memoria sin perder la sesión.
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

## SSH integrado (reemplazo de PuTTY)

Terminal SSH dentro de la app, con varias sesiones a la vez (barra lateral → *SSH* y *Sesiones SSH*; `Ctrl+K` también las encuentra).

- **Conexiones:** Ajustes → *Conexiones SSH*, o el botón **+** de la barra lateral, o clic derecho en un guest → *Abrir SSH* (rellena la IP). Acceso por **contraseña** (guardada cifrada con Windows, o se pide al conectar), **clave privada** (OpenSSH, PEM o **`.ppk` de PuTTY** v2 y v3 —RSA, ed25519 y ECDSA, con o sin frase de paso—; el `.ppk` se lee directamente, sin convertirlo ni escribir nada en disco) o **agente** (Pageant / agente de OpenSSH de Windows).
- **Importar de PuTTY:** lee tus sesiones guardadas (host, puerto, usuario, clave) del registro de Windows sin modificar nada de PuTTY. Las sesiones que usan Pageant, sin archivo de clave, se importan como contraseña: cámbialas a *Agente* al editarlas.
- **Probar conexión:** en el formulario de la conexión. Comprueba el acceso sin abrir el terminal; si el servidor es desconocido solo muestra su huella y **no envía tu contraseña**.
- **Huella del servidor:** se confirma la primera vez (como el `known_hosts` de OpenSSH) y se avisa con énfasis si cambia.
- **Como PuTTY:** seleccionar copia, clic derecho pega (`Ctrl+Shift+V` también). Con un terminal delante, los atajos de la app (`Ctrl+R`, `Ctrl+K`, `Ctrl+B`, `Ctrl+1..9`) pasan al shell.

## Arranque automático de guests nuevos

Ajustes → *Arranque de guests nuevos*. Cada VM o LXC **nuevo** se actualiza y recibe los paquetes base solo (curl, nano, htop, sudo y, en VM, qemu-guest-agent). Editas el script en la app y lo instalas **una sola vez** en el nodo:

1. Pulsa **Abrir shell del nodo y pegar**: abre el shell de Proxmox (hace falta sesión de root@pam) y pega el instalador sin ejecutarlo. También puedes **Copiar comando de instalación** y pegarlo tú.
2. Revisa lo pegado y pulsa Enter.

Qué instala: un temporizador de systemd (`homelab-provision.timer`, cada minuto) que detecta guests nuevos y les ejecuta el script (`pct exec` en LXC; `qm guest exec` en VM con qemu-guest-agent). Los guests que ya existían al instalar quedan como *baseline* y **no se tocan**; las plantillas y las VM Windows tampoco. Cada guest se prepara una vez (hasta 5 reintentos). Logs: `/var/log/homelab-provision/`. Para quitarlo: *Copiar comando para quitarlo*.

La app nunca ejecuta nada en el nodo por su cuenta: solo genera el comando que tú pegas. Para las VM, lo ideal es llevar qemu-guest-agent ya en tu plantilla y activar *Options → QEMU Guest Agent*.

## Panel de inicio (monitoreo)

Barra lateral → **Inicio** (se abre al arrancar; se puede cambiar en Ajustes → *Inicio y monitoreo*). Es como el *Summary* del datacenter de Proxmox pero con más datos y refresco cada 10 s mientras está abierto:

- **Tarjetas** con minigráfica: tiempo activo, CPU, memoria, carga (1/5/15 min), disco del sistema, red y guests.
- **Gráficas** de CPU (con espera de E/S), memoria, tráfico de red y carga, con periodo de **1 h / 24 h / 7 d**, cruz con tooltip y vista de tabla.
- **Guests: mayores consumidores** (CPU, RAM, red y E/S de disco por guest, ordenable) y **almacenamiento** con medidores (aviso a partir del 80 %, crítico desde el 90 %, con icono y texto).
- **Estado**: servicios de Proxmox caídos, actualizaciones pendientes, salud SMART de los discos y avisos de diagnóstico.
- **Procesos del host**: Proxmox no publica esa lista por su API; elige en Ajustes una conexión SSH al nodo y la app ejecuta solo un comando de lectura fijo (`ps`, ordenado por CPU). Hace falta la huella del servidor ya confirmada y la contraseña guardada.
- **Registros**: tareas (con resultado y duración), registro del clúster y syslog, con filtro de texto y de nivel.
- **AdGuard Home** (opcional): sitios más bloqueados **con qué equipo los pidió**, equipos que más consultan, bloqueos recientes con filtro, consultas/bloqueadas/tiempo medio y estado de la protección. Se configura en Ajustes → *AdGuard Home* con la dirección de su panel web, usuario y contraseña (cifrada); solo lee datos. Los equipos se muestran por **nombre** cuando se conoce, en este orden: el nombre fijo que le pusiste en AdGuard, el del guest de tu Proxmox si la IP es suya (p. ej. `10.0.0.53` → `docker-server`) o de una conexión SSH guardada, y lo que AdGuard averigua solo (DNS inverso, DHCP, ARP). Los demás salen como «sin nombre»; para identificarlos activa en AdGuard el *DNS inverso privado* (con la IP de tu router) o añádelos como clientes.

**Permisos:** con el rol `PVEVMUser` Proxmox no entrega el estado detallado del nodo, los servicios ni los registros (solo lo de los guests). El panel lo detecta, avisa y te da el comando exacto; para ver todo basta añadir solo lectura:

```
pveum acl modify / --users olvezz@pve --roles PVEAuditor
```

El syslog además exige el permiso `Sys.Syslog` (lo trae `PVEAdmin`, no `PVEAuditor`): si no lo tiene, esa pestaña lo indica y el resto funciona igual.

## Asistente de IA

Barra lateral → *IA → Asistente* (o clic derecho en un guest → *Preguntar a la IA*). Un chat que conoce tu homelab: le preguntas por el estado de tus guests y puede **proponer acciones** (iniciar/apagar/reiniciar un guest, ejecutar un comando por SSH).

- **Proveedores:** Claude (Anthropic), Gemini (Google), cualquier servicio compatible con la API de OpenAI (OpenAI, Groq, OpenRouter, DeepSeek…) y **Ollama** (modelo local en tu red: nada sale de ella). Se configuran en Ajustes → *Asistentes de IA*, con botón *Probar*. Puedes tener varias conexiones y cambiar de una a otra en el chat.
- **Hace falta una clave de API** de cada proveedor (se factura aparte, por uso). Las suscripciones de chat (Claude.ai, Gemini Advanced…) **no se pueden conectar** a otras aplicaciones. La clave se cifra con Windows (DPAPI), nunca se guarda en claro y nunca llega a la interfaz: las peticiones salen del proceso principal.
- **Herramientas de lectura** (se usan solas): estado general, lista y detalle de guests (con notas, IPs y paneles), conexiones SSH guardadas (sin contraseñas).
- **Acciones** (`power_action`, `ssh_exec`): cada una aparece en el chat con el comando completo y **solo se ejecuta si pulsas Aprobar**; si pulsas Rechazar o no respondes en 5 minutos, no se ejecuta. `ssh_exec` solo usa conexiones guardadas, con la huella del servidor ya confirmada y la contraseña guardada, y se corta a los 60 s. El interruptor *Permitir acciones* las desactiva del todo (el modelo ni las ve).
- **Privacidad:** lo que escribes y lo que el asistente consulta (nombres, IPs, estado, notas) viaja al proveedor elegido. La conversación vive solo en memoria y se borra con *Nueva conversación* o al cerrar la app. Los datos que devuelven las herramientas se tratan como datos, no como instrucciones (defensa contra textos maliciosos en notas o salidas de comandos), y la aprobación humana es la barrera final.

## Clic derecho

En la barra lateral, clic derecho sobre cualquier elemento abre sus acciones: **paneles** (abrir, recargar, abrir en el navegador, copiar URL, apagar vista, editar/eliminar si es manual, editar las notas en Proxmox si es descubierto, cerrar la sesión del sitio), **conexiones SSH** (conectar, editar, copiar usuario@host, eliminar), **sesiones SSH** (ir, reconectar, cerrar) y **guests** (energía, consola, SSH, abrir en Proxmox, copiar IP).

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
- IA: claves de API cifradas (DPAPI) y solo en el proceso principal; acciones siempre con aprobación explícita.
- SSH: huellas de servidor confirmadas (TOFU), secretos cifrados con DPAPI y nunca en claro; el terminal solo recibe/envía bytes.
- IPC validado con `zod` y limitado al frame principal de la ventana; lista blanca de acciones.
- Las notas y tags de Proxmox son datos no confiables: se parsean con lista blanca y nunca se inyectan como HTML.
- Permisos del navegador (cámara, micrófono, ubicación…) denegados; enlaces a otros orígenes se abren en el navegador externo.
- Una sola instancia. Actualizaciones solo por HTTPS desde el repositorio configurado, con hash verificado.

## Datos y logs

- Configuración: `%APPDATA%\homelab-desktop\config.json`.
- Logs rotativos (sin secretos): `%APPDATA%\homelab-desktop\logs\app.log`.
