# Marco legal de HomeLab Desktop

Adaptación de las plantillas de `C:\Sistemas\_Legal-Templates` a una **aplicación de escritorio**, orientada a **República Dominicana** (Ley 172-13 de Protección de Datos Personales, Ley 358-05 General de Protección al Consumidor o Usuario, Ley 65-00 de Derecho de Autor, Ley 20-00 de Propiedad Industrial) y a buenas prácticas de accesibilidad (WCAG 2.1 AA).

> ⚠️ **Esto no es asesoría legal.** Es un punto de partida bien estructurado. Antes de comercializar la aplicación, hazlo revisar por un abogado dominicano.

## Qué hay

| Archivo | Para qué |
|---|---|
| `terminos.md` | Términos y condiciones de uso (licencia de uso) |
| `privacidad.md` | Política de privacidad (qué se guarda, dónde, qué conexiones hace) |
| `cookies.md` | Política de cookies (la app no usa analítica; los paneles web guardan sus sesiones) |
| `rembolso.md` | Declara que hoy no hay pagos; se completa antes de vender |
| `accesibilidad-checklist.md` | Checklist WCAG 2.1 AA para la interfaz |
| `integridad-contenido-checklist.md` | Reseñas, afirmaciones, datos del negocio, analítica y terceros |
| `../LICENSE` | Licencia del software (todos los derechos reservados) |
| `../THIRD_PARTY_NOTICES.md` | Licencias de los componentes de terceros (se genera con `npm run licenses`) |

Estos documentos también se ven **dentro de la aplicación** (Ajustes → General → Legal) y viajan con el instalador, en la carpeta `legal` junto a la aplicación.

No se incluye `cookie-consent-snippet.html`: es para sitios web, y esta aplicación no usa cookies opcionales ni analítica, así que no necesita banner de consentimiento. Si algún día se añade analítica o telemetría, habrá que añadir consentimiento y actualizar `privacidad.md` y `cookies.md`.

## Datos que faltan por completar

Cada `[COMPLETAR: …]` debe sustituirse por el dato real **antes de comercializar**:

- Razón social o nombre del titular y **RNC**.
- Dirección, correo y teléfono de contacto (privacidad, términos, cookies, rembolso).
- Edad mínima de uso.
- Ciudad o provincia de los tribunales competentes.
- Cláusulas de responsabilidad revisadas por un abogado.
- Condiciones comerciales y política de rembolso, si se vende.

Para localizarlos: `grep -rn "COMPLETAR" legal`.

## Cuando cambie algo

- Si la aplicación empieza a enviar datos a algún servidor (telemetría, cuentas, licencias, pagos): actualizar `privacidad.md`, `cookies.md` y `terminos.md`, y pedir consentimiento.
- Si cambian las dependencias: `npm run licenses` para regenerar `THIRD_PARTY_NOTICES.md`.
- Cambiar la fecha de "Última actualización" en cada documento modificado.
