# Checklist de integridad de contenido, analítica y terceros

Correr sobre HomeLab Desktop y sobre su página de descarga o venta (si existe). Reduce el riesgo de reclamos por publicidad engañosa (Ley 358-05) y de protección de datos (Ley 172-13).

## Reseñas y afirmaciones
- [ ] Ninguna reseña o testimonio es inventado: si no hay reseñas reales, no mostrar ninguna.
- [ ] Ninguna cifra o afirmación ("el más rápido", "el mejor") aparece sin poder respaldarla con datos reales.
- [ ] Si se citan clientes o casos reales, hay autorización de esa persona o negocio.
- [ ] No se afirma compatibilidad, certificación ni respaldo de Proxmox, Portainer u otras marcas que la aplicación muestra: se indica que son marcas de sus titulares y que no hay afiliación.

## Datos y consentimiento
- [ ] La aplicación no pide ningún dato que no necesite (minimización). *(Hoy no hay cuentas ni formularios que envíen datos.)*
- [ ] Si se añade algún envío de datos a un servidor (licencias, telemetría, soporte), hay consentimiento explícito antes de enviar y está declarado en la Política de Privacidad.
- [ ] Ningún dato sensible (credenciales) sale del equipo ni se guarda sin cifrar. *(Secretos cifrados con DPAPI.)*

## Analítica
- [x] No hay analítica ni telemetría en la aplicación: está declarado en la Política de Privacidad y en la de Cookies.
- [ ] Si se añade, se declara en la Política de Cookies/Privacidad y solo se activa tras consentimiento.

## Integraciones de terceros
- [x] Lista de servicios de terceros que usa la aplicación: **GitHub** (descarga de actualizaciones) y los **sitios oficiales** que el usuario indica (descarga de iconos). Además, los servidores del propio usuario.
- [x] Están mencionados en la Política de Privacidad (apartado 4).
- [ ] Revisar periódicamente que la política de privacidad de GitHub siga siendo compatible y que no se exponga más información de la necesaria.
- [ ] Licencias de componentes de terceros al día (`npm run licenses`).

## Registro

| Producto | Terceros detectados | Analítica | Reseñas revisadas |
|---|---|---|---|
| HomeLab Desktop | GitHub (actualizaciones), sitios oficiales indicados por el usuario (iconos) | Ninguna | No hay reseñas |
