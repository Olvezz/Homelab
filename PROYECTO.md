# HomeLab Desktop — Contexto completo y especificación para Claude Code

> **Cómo usar este archivo:** crea una carpeta vacía en tu PC (ej. `C:\Proyectos\homelab-desktop`), guarda este archivo dentro como `PROYECTO.md`, abre una terminal ahí y ejecuta:
>
> ```
> claude "Lee PROYECTO.md completo. Ejecuta la Fase 1 y detente a que yo pruebe. No avances de fase sin que te lo pida."
> ```
>
> Opcional: copia las secciones 1, 2, 9 y 10 a un `CLAUDE.md` para que el contexto persista entre sesiones.

---

## 1. Objetivo

Aplicación de escritorio para **Windows** (que luego pueda compilarse a macOS/Linux) que unifica en **una sola ventana**:

1. Un **árbol lateral** con los nodos, VMs y LXC de mi Proxmox (como el panel izquierdo de la web de Proxmox), con estado en vivo.
2. Los **paneles web** de mis servicios (Proxmox, AdGuard Home, Portainer, y los que vengan) dentro de la misma app, sin abrir el navegador ni usar marcadores.
3. **Descubrimiento automático**: cuando cree una VM/LXC nueva en Proxmox y le ponga su URL de panel en las notas, debe aparecer sola en la app, sin tocar código ni configuración.
4. Acciones básicas desde la app: iniciar, apagar, reiniciar, abrir consola.

No se busca reemplazar la UI de Proxmox: se **embebe** (la web de Proxmox sigue siendo la fuente para configuración avanzada). La app es un "shell" unificado + capa de descubrimiento vía API.

## 2. Entorno real del usuario (datos fijos)

| Elemento | Valor |
|---|---|
| Proxmox VE | versión 9.2.x, nodo único llamado `proxmox`, UI en `https://10.0.0.50:8006` |
| Certificado | autofirmado (el navegador muestra "No es seguro") |
| Acceso remoto | Tailscale. El LXC `101 (tailscale-router)` anuncia la subred `10.0.0.0/24`, así que las IPs `10.0.0.x` se alcanzan igual en casa o fuera |
| LXC 100 | `adguard` — AdGuard Home (la IP/puerto exacto lo configura el usuario; la app lo leerá de las notas) |
| LXC 101 | `tailscale-router` |
| VM 102 | `docker-server` — Docker + Portainer en `http://10.0.0.53:9000` |
| VM 103 | `ubuntu-base` — plantilla/VM apagada |
| Storage | `local`, `local-zfs`, `almacenamiento-extra` |
| Red | `10.0.0.50`–`10.0.0.53` hoy; **crecerá** (más VMs/LXC/dashboards) |
| Idioma | UI **en español** (preparar i18n simple por si luego se quiere inglés) |
| SO del usuario | Windows (principal) |

El usuario es técnico-intermedio, hace homelab; prefiere explicaciones claras en español. Los comentarios del código y el README en español; nombres de variables/funciones en inglés.

## 3. Stack decidido

- **Electron** (≥ 33, usar `WebContentsView`; `BrowserView` está deprecado) + **TypeScript**.
- **electron-vite** como plantilla/bundler, **React + Vite** para la UI de la barra lateral y ajustes.
- **electron-builder** para generar instalador NSIS (`npm run dist`).
- Estado UI: Zustand (o React state simple). Estilos: CSS modules o Tailwind, tema **oscuro** por defecto acorde a Proxmox (con opción claro).
- Sin dependencias pesadas innecesarias. Para HTTP al API de Proxmox usar `node:https` con agente propio (ver §6).

Por qué Electron y no Tauri: manejo sencillo de certificados autofirmados por host, múltiples webviews con sesiones aisladas y cookies persistentes. Si luego se quiere ligereza, se puede migrar.

## 4. Arquitectura

```
┌────────────────────────────── BrowserWindow ───────────────────────────────┐
│ ┌───────────────┐ ┌──────────────────────────────────────────────────────┐ │
│ │  Sidebar (UI) │ │   Área de contenido: WebContentsView activo          │ │
│ │  React        │ │   (Proxmox / AdGuard / Portainer / consola VM...)    │ │
│ │               │ │                                                      │ │
│ │ ▸ Proxmox     │ │   Una vista por servicio, creada perezosamente y     │ │
│ │ ▾ Nodo proxmox│ │   mantenida viva (no recargar al cambiar de pestaña) │ │
│ │   ● 100 adguard│ │                                                     │ │
│ │   ● 101 tail..│ │                                                      │ │
│ │   ● 102 docker│ │                                                      │ │
│ │   ○ 103 ubuntu│ │                                                      │ │
│ │ ▾ Paneles     │ │                                                      │ │
│ │   AdGuard     │ │                                                      │ │
│ │   Portainer   │ │                                                      │ │
│ │ ⚙ Ajustes     │ │                                                      │ │
│ └───────────────┘ └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

**Procesos**
- **Main**: ventana, `ViewManager` (crea/muestra/oculta `WebContentsView`s), `PveClient` (API Proxmox), `ConfigStore` (config + secretos cifrados), `CertTrust` (confianza de certificados por huella), polling.
- **Preload**: expone una API mínima y tipada por `contextBridge` (`window.api`). `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **Renderer (UI propia)**: solo la barra lateral y la pantalla de ajustes. **Nunca** carga contenido remoto.
- **Vistas de servicios**: cada una es un `WebContentsView` con su propia `partition: "persist:svc-<id>"` (cookies/sesión aisladas y persistentes), sin preload propio, `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.

> No usar `<iframe>` ni `<webview>` tag: Proxmox/Portainer/AdGuard envían `X-Frame-Options`/CSP que lo bloquean, y `<webview>` está desaconsejado.

### Estructura de carpetas sugerida

```
homelab-desktop/
├─ PROYECTO.md
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ src/
│  ├─ main/
│  │  ├─ index.ts            # arranque, ventana, menú, tray
│  │  ├─ viewManager.ts      # WebContentsViews + layout
│  │  ├─ pve/
│  │  │  ├─ client.ts        # cliente API Proxmox
│  │  │  ├─ types.ts
│  │  │  ├─ discovery.ts     # parseo de notas/tags → paneles
│  │  │  └─ poller.ts        # polling + eventos
│  │  ├─ config/store.ts     # config.json + safeStorage
│  │  ├─ security/certTrust.ts
│  │  └─ ipc.ts              # handlers IPC
│  ├─ preload/index.ts
│  └─ renderer/
│     ├─ App.tsx
│     ├─ components/ (Sidebar, TreeNode, StatusDot, ContextMenu, Settings, FirstRunWizard)
│     └─ store.ts
└─ resources/ (iconos)
```

## 5. Modelo de datos

```ts
// Config persistida (userData/config.json). El secreto NO va aquí en claro.
interface AppConfig {
  pve: {
    host: string;              // "10.0.0.50"
    port: number;              // 8006
    tokenId: string;           // "labapp@pve!desktop"
    tokenSecretEnc: string;    // base64 de safeStorage.encryptString(...)
    trustedCertSha256: string; // huella aceptada (TOFU)
    pollIntervalSec: number;   // 10
  } | null;
  manualPanels: Panel[];       // paneles añadidos a mano (no vienen de Proxmox)
  ui: { theme: "dark" | "light" | "system"; sidebarWidth: number; lastActiveId?: string };
}

interface Panel {
  id: string;                  // estable: `pve-<vmid>-<slug>` o `manual-<uuid>`
  name: string;
  url: string;                 // http(s)://ip:puerto
  icon?: string;               // emoji o nombre de icono
  source: "proxmox-notes" | "proxmox-tag" | "manual";
  vmid?: number;               // si viene de un guest
  allowInsecureCert?: boolean; // solo https con cert propio, ligado a huella
}

type GuestType = "qemu" | "lxc";
interface Guest {
  vmid: number; name: string; node: string; type: GuestType;
  status: "running" | "stopped" | "paused" | "unknown";
  template: boolean;
  cpu: number; maxcpu: number; mem: number; maxmem: number; uptime: number;
  tags: string[];
  description: string;         // notas
  ips: string[];               // detectadas
  panels: Panel[];             // descubiertos para este guest
}
```

## 6. Integración con la API de Proxmox

Base: `https://<host>:8006/api2/json`
Cabecera de auth: `Authorization: PVEAPIToken=<tokenId>=<secret>` (ej. `PVEAPIToken=labapp@pve!desktop=xxxxxxxx-...`).
El **API Token solo sirve para la API**, no para iniciar sesión en la UI web (ver §8).

### Endpoints a usar

| Para | Método y ruta |
|---|---|
| Versión / test de conexión | `GET /version` |
| Lista de guests + nodos en una llamada | `GET /cluster/resources` (filtrar `type` = `qemu`, `lxc`, `node`, `storage`) |
| Config de un LXC (notas, tags, `net0`) | `GET /nodes/{node}/lxc/{vmid}/config` |
| Config de una VM (notas, tags, `ipconfigN`) | `GET /nodes/{node}/qemu/{vmid}/config` |
| IPs de un LXC | `GET /nodes/{node}/lxc/{vmid}/interfaces` |
| IPs de una VM (requiere qemu-guest-agent) | `GET /nodes/{node}/qemu/{vmid}/agent/network-get-interfaces` |
| Iniciar / apagar limpio / forzar / reiniciar | `POST /nodes/{node}/{qemu\|lxc}/{vmid}/status/{start\|shutdown\|stop\|reboot}` |
| Seguir una tarea (UPID) | `GET /nodes/{node}/tasks/{upid}/status` |

Respuestas vienen en `{ "data": ... }`. Los POST de estado devuelven un UPID (string).

### Cliente con certificado autofirmado (TOFU + pinning)

No desactivar la verificación TLS de forma global. Flujo **Trust On First Use**:

1. En el asistente de primer uso, conectar con `tls.connect({ rejectUnauthorized: false })`, leer `getPeerCertificate(true)`, mostrar al usuario **la huella SHA-256** y pedir confirmación.
2. Guardar el certificado (PEM) y su huella. A partir de ahí, las peticiones usan `ca: [pem]` (pinning real: solo ese certificado es válido).
3. Si la huella cambia → bloquear y avisar claramente ("el certificado de Proxmox cambió"), con opción explícita de re-confiar.

```ts
// src/main/pve/client.ts (esqueleto)
import https from "node:https";

export class PveClient {
  private agent: https.Agent;
  constructor(private cfg: { host: string; port: number; tokenId: string; tokenSecret: string; certPem: string }) {
    this.agent = new https.Agent({
      ca: [cfg.certPem],              // pinning: solo este certificado
      checkServerIdentity: () => undefined, // el cert autofirmado puede no tener SAN con la IP; el pin ya garantiza identidad
      keepAlive: true,
    });
  }

  private request<T>(method: "GET" | "POST", path: string, body?: Record<string, string>): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = body ? new URLSearchParams(body).toString() : undefined;
      const req = https.request(
        {
          host: this.cfg.host, port: this.cfg.port, method,
          path: `/api2/json${path}`, agent: this.agent, timeout: 8000,
          headers: {
            Authorization: `PVEAPIToken=${this.cfg.tokenId}=${this.cfg.tokenSecret}`,
            ...(payload ? { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400)
              return reject(Object.assign(new Error(`PVE ${res.statusCode}`), { status: res.statusCode, raw }));
            try { resolve(JSON.parse(raw).data as T); } catch (e) { reject(e); }
          });
        }
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  resources() { return this.request<any[]>("GET", "/cluster/resources"); }
  guestConfig(node: string, type: "qemu" | "lxc", vmid: number) {
    return this.request<any>("GET", `/nodes/${node}/${type}/${vmid}/config`);
  }
  power(node: string, type: "qemu" | "lxc", vmid: number, action: "start" | "shutdown" | "stop" | "reboot") {
    return this.request<string>("POST", `/nodes/${node}/${type}/${vmid}/status/${action}`);
  }
}
```

### Polling

- `GET /cluster/resources` cada `pollIntervalSec` (10 s por defecto) → estado/CPU/RAM de todo en **una** llamada.
- Las **notas/tags/IP** (config por guest) cambian poco: leerlas al inicio, al detectar guest nuevo y cada ~60 s (o con botón "Refrescar"). Hacer estas llamadas en paralelo con límite de concurrencia (ej. 4).
- Pausar el polling cuando la ventana está minimizada/oculta. Backoff exponencial si falla.
- Estados de conexión visibles en la UI: `Conectado` / `Sin conexión (¿Tailscale activo?)` / `Token inválido (401)` / `Certificado cambió`.
- Si una acción devuelve **403**, deshabilitar esos botones y mostrar tooltip "El token no tiene permiso de energía" (la app debe funcionar también con un token de solo lectura).

## 7. Descubrimiento automático de paneles

Convención que el usuario aplicará en Proxmox, en el campo **Notas (Description)** de cada VM/LXC. Una línea por panel:

```
panel: Portainer | http://10.0.0.53:9000 | 🐳
panel: AdGuard Home | http://10.0.0.52:3000 | 🛡️
```

Formato: `panel: <nombre> | <url> [| <icono>]`. Icono opcional (emoji).

**Atajo por tag** (opcional, como respaldo): los tags de Proxmox solo permiten `[a-zA-Z0-9_.+-]`, **no** admiten `:` ni `/`, así que no se puede poner una URL en un tag. Alternativa: tag `web-9000` (o `web-9000-https`) → la app arma `http(s)://<IP detectada del guest>:9000` y usa el nombre del guest como nombre del panel.

Reglas del parser (`discovery.ts`):
- Ignorar líneas mal formadas sin romper nada (mostrar un aviso discreto en Ajustes → "Diagnóstico").
- Validar URL: solo `http:` y `https:`. **Rechazar** cualquier otro esquema (`file:`, `javascript:`, etc.).
- Aviso (no bloqueo) si el host de la URL está fuera de rangos privados (`10/8`, `172.16/12`, `192.168/16`, `100.64/10` Tailscale) — evita que unas notas manipuladas abran sitios externos sin que el usuario lo note. Para hosts públicos pedir confirmación la primera vez.
- `id` estable = `pve-<vmid>-<hash corto de la url>` para que la vista y su sesión persistan entre refrescos.
- Si un panel desaparece de las notas, ocultarlo (y destruir su vista) pero conservar su sesión en disco.
- Los **paneles manuales** (en Ajustes) cubren servicios que no están en Proxmox (router, NAS, etc.).

Además, el guest `proxmox` (UI web de Proxmox) se añade siempre como panel fijo `Proxmox` apuntando a `https://<host>:8006`.

## 8. Vistas web, sesiones y certificados de los paneles

**Layout (`viewManager.ts`)**
- Un `WebContentsView` por panel, creado al primer uso (lazy), y **mantenido en memoria** al cambiar de panel (se oculta con `setVisible(false)`; no se destruye) para conservar estado.
- Los bounds se ajustan en cada `resize` de la ventana y al cambiar el ancho de la barra lateral: `x = sidebarWidth`, `y = 0`, `width = winWidth - sidebarWidth`, `height = winHeight`.
- Límite de vistas vivas (ej. 8): descartar la menos usada si se supera.
- Botones en una barra fina superior del contenido: ← → ↻, abrir en navegador externo, copiar URL, zoom ±.
- `setWindowOpenHandler`: los `window.open` y enlaces `target=_blank` hacia el mismo origen se abren en la misma vista; hacia otros orígenes → `shell.openExternal` (con validación `http/https`). Nunca crear ventanas Electron con contenido remoto.
- `will-navigate`: permitir navegación dentro del mismo origen; otros orígenes → externo.

**Certificados autofirmados en las vistas**
- Por sesión (`session.fromPartition`), usar `setCertificateVerifyProc((req, cb) => ...)`:
  - Si `req.hostname` + huella SHA-256 del certificado coinciden con una entrada confiable guardada → `cb(0)`.
  - Si es un host https nuevo con certificado inválido → mostrar diálogo en la UI propia con la huella y pedir confirmación; si acepta, guardar (TOFU) y recargar. Si no → `cb(-3)`.
- Nunca un `ignore-certificate-errors` global.

**Login en la UI de Proxmox**
- El token API no inicia sesión en la web. **Fase 1–3:** el usuario inicia sesión una vez en la vista de Proxmox (usuario/contraseña/2FA como siempre) y la sesión queda en la partición persistente. La cookie `PVEAuthCookie` puede ser de sesión; para que sobreviva a reiniciar la app, escuchar `session.cookies.on("changed")` y re-guardarla con `expirationDate` ≈ +2 h.
- **Nunca** guardar la contraseña del usuario en la app. (Auto-login por ticket queda fuera de alcance.)

**Consola de VM/LXC** (abre en una vista/pestaña nueva dentro de la app, requiere sesión web iniciada):
- LXC: `https://<host>:8006/?console=lxc&xtermjs=1&vmid=<id>&vmname=<nombre>&node=<nodo>&cmd=`
- VM (noVNC): `https://<host>:8006/?console=kvm&novnc=1&vmid=<id>&vmname=<nombre>&node=<nodo>&resize=off`

**Ver el guest en la web de Proxmox** (clic derecho → "Abrir en Proxmox"): `https://<host>:8006/#v1:0:=<type>%2F<vmid>:4:::::::`  (formato `qemu/102`, `lxc/100`). Si el formato cambia en versiones futuras, degradar a abrir la raíz.

## 9. Interfaz de usuario (barra lateral)

- **Árbol**: `Proxmox (nodo)` → guests ordenados por `vmid`. Cada fila: punto de estado (verde corriendo, gris apagado, ámbar pausado/desconocido), icono LXC/VM, `vmid`, nombre, y mini-barras CPU/RAM (aparecen al pasar el ratón o en modo expandido).
- Si el guest tiene paneles descubiertos, aparecen como **hijos** de esa fila (clic → abre el panel). Si tiene uno solo, clic en la fila abre ese panel directo; clic en la flecha expande.
- Sección **"Paneles"** plana aparte con todos los paneles (para acceso rápido) + los manuales.
- **Menú contextual** en cada guest: Iniciar · Apagar · Reiniciar · Forzar apagado (con confirmación) · Abrir consola · Abrir en Proxmox · Copiar IP · Refrescar.
- **Confirmación** antes de apagar, forzar apagado y reiniciar. Iniciar no requiere confirmación.
- **Búsqueda** rápida (Ctrl+K) por nombre/vmid/IP/panel.
- **Pie**: estado de conexión a Proxmox + botón Ajustes.
- Atajos: `Ctrl+1..9` paneles, `Ctrl+R` recargar vista, `Ctrl+Shift+R` refrescar datos de Proxmox, `Ctrl+B` colapsar barra, `F11` pantalla completa.
- Barra lateral colapsable a solo iconos y redimensionable (persistir ancho).
- Tray: icono con menú (Mostrar, Refrescar, Salir). Cerrar ventana = minimizar a bandeja (configurable). Opción "Iniciar con Windows".

**Asistente de primer uso** (si no hay config):
1. Pedir host/puerto (prefill `10.0.0.50:8006`).
2. Mostrar huella del certificado → confirmar.
3. Pedir Token ID y Secret (campo tipo contraseña) + instrucciones desplegables para crearlos (ver §10). Botón "Probar conexión" (`GET /version`).
4. Guardar y cargar el árbol.

**Ajustes**: conexión Proxmox (editar/re-confiar certificado), intervalo de polling, tema, paneles manuales (CRUD), "Diagnóstico" (líneas de notas inválidas, guests sin IP detectada, permisos faltantes), iniciar con Windows, cerrar a bandeja.

## 10. Seguridad (requisitos obligatorios)

1. **Token con mínimo privilegio.** Nada de `root@pam`. Crear usuario y token dedicados. En el shell de Proxmox:
   ```
   pveum user add labapp@pve --comment "HomeLab Desktop"
   pveum acl modify / --users labapp@pve --roles PVEVMUser      # ver + energía + consola
   pveum user token add labapp@pve desktop --privsep 0           # muestra el secreto UNA vez
   ```
   Versión solo lectura: usar rol `PVEAuditor` en lugar de `PVEVMUser`. Si la detección de IP por qemu-guest-agent da 403 en PVE 9, añadir el permiso `VM.GuestAgent.Audit` a un rol custom.
2. **Secreto cifrado** con `safeStorage` de Electron (DPAPI en Windows). Si `safeStorage.isEncryptionAvailable()` es `false`, **no** guardar en claro: pedir el secreto en cada arranque. No usar `keytar` (obsoleto). No loguear nunca el secreto ni cabeceras `Authorization`.
3. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` en **todas** las vistas. El preload solo expone funciones concretas y valida argumentos (nada de `ipcRenderer` crudo).
4. **CSP estricta** en la UI propia (`default-src 'self'`; sin `unsafe-eval`).
5. **IPC validado**: cada handler verifica `event.senderFrame` pertenece a la UI propia (no a una vista remota) y valida tipos/rangos (`vmid` entero, `action` en lista blanca, etc.).
6. Contenido de las notas de Proxmox = **dato no confiable**: se parsea con whitelist, nunca se evalúa ni se inyecta como HTML (escapar en React; no usar `dangerouslySetInnerHTML`).
7. Solo `http(s)` en URLs de paneles. Permisos de Electron (cámara, micrófono, geolocalización, notificaciones…) **denegados** por defecto en las vistas (`setPermissionRequestHandler`).
8. Actualizaciones: sin auto-update remoto en v1 (evita superficie de ataque). Se actualiza reinstalando.
9. Un solo proceso de la app (`app.requestSingleInstanceLock()`).

## 11. Fases de desarrollo (detenerse al final de cada una para que el usuario pruebe)

**Fase 1 — Shell con paneles manuales (MVP usable)**
- Proyecto electron-vite + React + TS funcionando; ventana con barra lateral y área de contenido.
- `ViewManager` con `WebContentsView` por panel, sesiones persistentes, manejo de `window.open`, barra de navegación.
- Config en disco; Ajustes con CRUD de paneles manuales. Precargar `Proxmox`, `Portainer http://10.0.0.53:9000` como ejemplo editable.
- Confianza de certificado por huella (TOFU) en las vistas.
- Empaquetado: `npm run dev` y `npm run dist` generan instalador.
- **Aceptación:** abro la app, veo Proxmox y Portainer en una ventana, inicio sesión una vez, cierro y reabro y sigo logueado; sin avisos de certificado tras confiar una vez.

**Fase 2 — Conexión API y árbol en vivo**
- Asistente de primer uso, `PveClient`, `safeStorage`, polling de `/cluster/resources`.
- Árbol de guests con estado y mini-métricas; estados de conexión; manejo de errores (timeout, 401, 403, cert cambiado).
- **Aceptación:** el árbol replica el de la UI de Proxmox y se actualiza solo (apago una VM desde Proxmox y la app lo refleja en ≤ 15 s); si desactivo Tailscale, la app muestra "Sin conexión" sin congelarse.

**Fase 3 — Descubrimiento de paneles**
- Parser de notas (`panel: nombre | url | icono`) y tags `web-<puerto>`.
- Detección de IP (LXC `interfaces`, VM guest-agent, fallback `net0`/`ipconfig0`).
- Paneles descubiertos aparecen bajo cada guest y en "Paneles"; diagnóstico en Ajustes.
- **Aceptación:** añado una línea `panel:` en las notas de un LXC nuevo y en ≤ 60 s (o con refrescar) aparece en la app; si borro la línea, desaparece.

**Fase 4 — Acciones y consola**
- Menú contextual: iniciar/apagar/reiniciar/forzar, con confirmaciones, seguimiento de la tarea (UPID) y toast de resultado.
- Abrir consola xterm.js/noVNC en vista propia; "Abrir en Proxmox".
- Degradación elegante con token de solo lectura (403 → botones deshabilitados).
- **Aceptación:** inicio y apago la VM 103 desde la app; abro consola del LXC 100.

**Fase 5 — Pulido**
- Ctrl+K, atajos, tray, iniciar con Windows, tema claro/oscuro, colapsar barra, iconos de servicios, logs a archivo rotativo (sin secretos), README en español con capturas y guía de instalación.

## 12. Casos límite a cubrir

- Proxmox inaccesible al arrancar: la app abre igual con los paneles manuales; la sección Proxmox muestra reintento.
- Guest sin qemu-guest-agent → IP "desconocida"; el panel sigue funcionando si la URL está en las notas.
- Múltiples nodos / clúster en el futuro: agrupar por nodo (el código no debe asumir un único nodo; usar el campo `node` de cada recurso).
- VMs que son plantillas (`template: 1`): ocultas por defecto o con icono distinto y sin acciones de energía.
- IDs de vmid repetidos entre nodos no ocurren en un clúster, pero usar `node+vmid` como clave interna.
- Tokens revocados/expirados: 401 → pedir re-ingreso del token sin borrar el resto de la config.
- El usuario cambia la IP de Proxmox: Ajustes permite editarla y re-confiar el certificado.
- Pantallas HiDPI y múltiples monitores: los bounds de las vistas deben recalcularse en `resize`, `maximize`, `enter-full-screen`, `display-metrics-changed`.

## 13. Criterios de calidad

- TypeScript estricto (`strict: true`), ESLint + Prettier.
- Tests unitarios con Vitest para: parser de notas/tags, validación de URLs, mapeo de `/cluster/resources` → `Guest`, validación de IPC. Cliente de Proxmox testeado con servidor HTTPS falso local (certificado autofirmado de prueba).
- Sin `any` salvo en el borde de las respuestas del API, que se validan con `zod` antes de usarse.
- README con: requisitos, `npm i`, `npm run dev`, `npm run dist`, cómo crear el token, convención de notas.
- Commits pequeños por funcionalidad.

## 14. Fuera de alcance (v1)

Auto-login a Proxmox con contraseña/ticket, gestión de backups/almacenamiento/red desde la app nativa, auto-update remoto, soporte multi-clúster, app móvil. Quedan anotados para futuras versiones.

## 15. Instrucciones de trabajo para Claude Code

- Trabaja **por fases** (§11) y espera mi confirmación entre fases.
- Antes de escribir código en la Fase 1, **muéstrame un plan corto** (archivos que vas a crear y comandos) y espera mi OK.
- Si algo de este documento choca con la realidad (versión de Electron, API de Proxmox, formato de URLs), **verifica y dímelo** en vez de asumir; no inventes endpoints. Si puedes consultar la documentación oficial de Proxmox VE API (`pve.proxmox.com/pve-docs/api-viewer`) y la de Electron, hazlo.
- No instales dependencias globales sin avisar. No toques nada fuera de la carpeta del proyecto.
- Nunca pidas ni escribas mi contraseña de Proxmox. El token se introduce solo en el asistente de la app.
- Al terminar cada fase: resume qué hiciste, cómo probarlo (comandos exactos) y qué falta.
