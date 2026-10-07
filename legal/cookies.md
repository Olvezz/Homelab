# Política de Cookies

**Última actualización:** 6 de octubre de 2026

HomeLab Desktop es una aplicación de escritorio. **La aplicación en sí no usa cookies de seguimiento, publicidad ni analítica.** Sin embargo, los paneles que abres dentro de ella son páginas web (tus propios servicios), y esas páginas pueden guardar cookies como cualquier navegador.

## 1. ¿Qué son las cookies?

Pequeños archivos que una página web guarda en tu dispositivo para recordar preferencias o mantener tu sesión iniciada.

## 2. Cookies que pueden existir

| Cookie | Tipo | Propósito | Duración |
|---|---|---|---|
| Cookies de cada panel (las que defina el servicio que abres, ej. Portainer, Jellyfin) | Estrictamente necesaria | Mantener tu sesión iniciada en ese servicio | Las que fije ese servicio |
| PVEAuthCookie (Proxmox) | Estrictamente necesaria | Mantener tu sesión de Proxmox al reiniciar la aplicación. Nunca se guarda tu contraseña | Hasta 2 horas |
| PVEThemeCookie (Proxmox) | Preferencia | Leer el tema visual de Proxmox para igualar los colores de la aplicación | Según Proxmox |

La aplicación **no** instala cookies analíticas, de marketing ni de terceros por su cuenta. Si el servicio que abres en un panel usa las suyas, se rigen por la política de ese servicio.

## 3. Cookies necesarias vs. opcionales

- **Necesarias**: no requieren consentimiento; sin ellas los paneles no mantienen tu sesión.
- **Opcionales**: la aplicación no tiene ninguna, por eso no muestra un banner de consentimiento.

## 4. Cómo controlar las cookies

Cada panel guarda sus cookies en un perfil aislado dentro de tu equipo. Puedes borrarlas desde el menú del panel con "Cerrar sesión del sitio…", o eliminando la carpeta `%APPDATA%\homelab-desktop`.
