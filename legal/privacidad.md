# Política de Privacidad

**Última actualización:** 6 de octubre de 2026

Esta Política de Privacidad describe cómo **HomeLab Desktop** ("nosotros", "la aplicación") trata los datos personales de quienes la usan, de conformidad con la **Ley No. 172-13 sobre Protección Integral de Datos Personales** de la República Dominicana.

## 1. Responsable del tratamiento de datos

- **Razón social / nombre:** [COMPLETAR]
- **RNC:** [COMPLETAR]
- **Dirección:** [COMPLETAR]
- **Correo de contacto:** [COMPLETAR]
- **Teléfono:** [COMPLETAR]

## 2. En resumen

- La aplicación **no tiene cuentas de usuario** y **no envía tus datos a servidores nuestros**: no hay telemetría ni analítica.
- Todo lo que configuras se guarda **solo en tu equipo**.
- Los secretos (token de API de Proxmox, contraseñas SSH) se guardan **cifrados** con la protección de tu usuario de Windows y nunca se transmiten a terceros.

## 3. Qué datos se guardan en tu equipo

Solo los necesarios para que la aplicación funcione, en la carpeta `%APPDATA%\homelab-desktop`:

- **Configuración:** paneles (nombre, dirección, icono, relaciones del mapa), carpetas y orden, ajustes, notas y comandos que guardas.
- **Conexiones:** dirección y puerto de Proxmox, identificador del token, conexiones SSH (servidor, usuario, ruta de la clave privada).
- **Secretos cifrados:** secreto del token de Proxmox y contraseñas o frases de paso SSH, cifrados con DPAPI (protección de Windows). Si el cifrado no está disponible, no se guardan y se te piden al conectar.
- **Huellas de confianza:** huellas de certificados y de servidores SSH que aceptaste.
- **Sesiones de los paneles web:** cookies y almacenamiento de las páginas que abres en cada panel (ver la Política de Cookies).
- **Registros de funcionamiento** (`logs\app.log`): eventos técnicos, sin secretos.

> Principio de minimización: no pedimos ni almacenamos ningún dato que no sea necesario para el funcionamiento de la aplicación.

## 4. Conexiones de red que realiza la aplicación

- **A tus propios servidores y servicios**, en las direcciones que configuras (Proxmox, paneles, SSH).
- **Comprobación de estado:** la aplicación abre brevemente una conexión TCP al puerto de cada panel para saber si está encendido (no envía contenido).
- **Actualizaciones:** consulta y descarga versiones desde **GitHub** por HTTPS. GitHub puede registrar tu dirección IP y la versión de la aplicación, según su propia política de privacidad.
- **Iconos:** si indicas el "sitio oficial" de un panel, la aplicación descarga el icono directamente de ese sitio. Ese sitio puede registrar tu dirección IP.

## 5. Para qué usamos los datos

- Mostrar y gestionar tus paneles, tu mapa de red, tus conexiones y tus notas.
- Mantener tu sesión en los paneles para que no tengas que iniciar sesión cada vez.
- Comprobar e instalar actualizaciones.

No vendemos tus datos ni los usamos para publicidad.

## 6. Con quién se comparten los datos

No compartimos datos contigo con terceros desde la aplicación. Las comunicaciones del apartado 4 se hacen entre tu equipo y esos servicios (tus servidores, GitHub y los sitios oficiales que indiques), no a través de nosotros. Solo divulgaremos información si la ley lo exige.

## 7. Tus derechos (Ley 172-13)

Tienes derecho a:

- **Acceso**: ver qué datos tuyos guarda la aplicación (están en tu equipo, en Ajustes y en `%APPDATA%\homelab-desktop`).
- **Rectificación y actualización**: editar paneles, conexiones y notas desde la propia aplicación.
- **Supresión**: eliminar elementos desde la aplicación o borrar la carpeta `%APPDATA%\homelab-desktop`.

Como no almacenamos tus datos, puedes ejercer estos derechos directamente. Para cualquier consulta, escribe a [COMPLETAR: correo de contacto].

## 8. Archivo de exportación

La función "Exportar configuración" genera un archivo con tus paneles, ajustes, conexiones y notas **sin secretos**. Ese archivo contiene direcciones y nombres de tu infraestructura: guárdalo en un lugar seguro y no lo compartas con quien no debas.

## 9. Seguridad

Aplicamos medidas técnicas razonables: aislamiento de procesos y política de seguridad de contenido en la interfaz, validación de los mensajes internos, confianza explícita para certificados y servidores SSH, cifrado de secretos con DPAPI y comunicaciones de actualización por HTTPS verificadas con huella (hash). Ningún sistema es completamente seguro: protege también tu equipo y tus credenciales.

## 10. Conservación de datos

Los datos permanecen en tu equipo hasta que los elimines. **Desinstalar la aplicación no borra** `%APPDATA%\homelab-desktop`: elimina esa carpeta si quieres borrar todo.

## 11. Menores

La aplicación no está dirigida a menores de [COMPLETAR: edad mínima] años.

## 12. Cambios a esta política

Podemos actualizar esta política. Los cambios importantes se indicarán en la aplicación o en la página de descarga, con la fecha de la última actualización.

## 13. Contacto

[COMPLETAR: correo/teléfono de contacto para temas de privacidad]
