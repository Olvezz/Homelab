# Checklist de accesibilidad (WCAG 2.1 AA)

Correr sobre la interfaz de HomeLab Desktop antes de darla por cumplida. Marcar y anotar hallazgos aquí.

## Imágenes e iconos
- [ ] Todo icono que es un botón tiene `aria-label` o texto visible equivalente. *(Los iconos decorativos ya llevan `aria-hidden`.)*
- [ ] El mapa de red (canvas) tiene una alternativa para quien no puede usar el ratón: lista de servicios del panel lateral y teclado (Esc, /, 1-4, Intro). **Pendiente de revisar con lector de pantalla.**

## Contraste de color
- [ ] Texto normal: relación de contraste ≥ 4.5:1 contra el fondo, en **todos los temas** (oscuro, claro y los de Proxmox).
- [ ] Texto grande (≥18pt o ≥14pt bold): relación de contraste ≥ 3:1.
- [ ] Texto pequeño del mapa (etiquetas de IP:puerto de 10.5 px) y color de los nodos apagados: verificar con una herramienta, no a ojo.
- [ ] El estado de un servicio no depende solo del color (hay texto "Encendido/Apagado" en el panel lateral).

## Formularios
- [ ] Todo `<input>`/`<select>` tiene un `<label>` asociado (no solo placeholder).
- [ ] Todos los formularios (añadir panel, conexión SSH, carpeta) son navegables con Tab, en orden lógico, sin trampas de foco.
- [ ] Los mensajes de error se anuncian (`aria-live` o foco en el campo con error), no solo color rojo.

## Botones y enlaces
- [ ] Cada botón tiene un texto/`aria-label` que describe la acción.
- [ ] Los estados de foco (`:focus-visible`) son visibles al navegar con teclado.
- [ ] Nada depende solo de "hover" o de arrastrar para funcionar: reordenar y mover a carpeta también se puede desde el menú contextual.
- [ ] Los menús y ventanas se cierran con `Esc` y devuelven el foco. *(Atajos documentados en F1.)*

## Estructura
- [ ] Jerarquía de encabezados lógica (un `h1` por pantalla, luego `h2`, `h3`… sin saltos).
- [ ] El idioma del documento está declarado (`<html lang="es">`).

## Resultado

| Producto | Alt text | Contraste | Teclado | Botones | Notas |
|---|---|---|---|---|---|
| HomeLab Desktop | Pendiente | Pendiente | Parcial (atajos F1) | Pendiente | Auditoría completa por hacer |
