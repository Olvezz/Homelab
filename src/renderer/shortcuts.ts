// Lista de atajos de teclado que muestra la ventana de ayuda (F1). Mantenerla al día con src/main/index.ts (hookInput)
// y con el teclado del mapa (components/NetworkMap.tsx).

export interface ShortcutGroup {
  title: string
  items: { keys: string[]; text: string }[]
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'General',
    items: [
      { keys: ['F1', 'Ctrl+/'], text: 'Esta ayuda de atajos' },
      { keys: ['Ctrl+K'], text: 'Buscar paneles, máquinas y comandos' },
      { keys: ['Ctrl+B'], text: 'Mostrar u ocultar la barra lateral' },
      { keys: ['Ctrl+M'], text: 'Ir al mapa' },
      { keys: ['Ctrl+,'], text: 'Abrir Ajustes' },
      { keys: ['Ctrl+N'], text: 'Añadir un panel nuevo' },
      { keys: ['F11'], text: 'Pantalla completa' }
    ]
  },
  {
    title: 'Paneles y pestañas',
    items: [
      { keys: ['Ctrl+1…9'], text: 'Ir al panel número N de la barra lateral' },
      { keys: ['Ctrl+Tab', 'Ctrl+Shift+Tab'], text: 'Panel siguiente / anterior' },
      { keys: ['F5', 'Ctrl+R'], text: 'Recargar el panel (en el mapa: actualizar datos y estado)' },
      { keys: ['Ctrl+Shift+R'], text: 'Volver a leer Proxmox' },
      { keys: ['Alt+←', 'Alt+→'], text: 'Atrás / adelante dentro del panel' },
      { keys: ['Ctrl+W'], text: 'Cerrar la pestaña o la sesión SSH actual' },
      { keys: ['Ctrl+=', 'Ctrl+-', 'Ctrl+0'], text: 'Acercar, alejar y restablecer el zoom del panel' }
    ]
  },
  {
    title: 'Mapa',
    items: [
      { keys: ['Esc'], text: 'Quitar la selección (con el buscador abierto, primero lo limpia)' },
      { keys: ['/', 'Ctrl+F'], text: 'Buscar en el mapa' },
      { keys: ['1', '2', '3', '4'], text: 'Vista: árbol, araña, vertical, bloques' },
      { keys: ['0', 'Inicio'], text: 'Reencuadrar' },
      { keys: ['+', '-'], text: 'Acercar / alejar' },
      { keys: ['R'], text: 'Reiniciar (cada nodo vuelve a su sitio)' },
      { keys: ['E', 'C'], text: 'Expandir todo / colapsar' },
      { keys: ['Intro'], text: 'Abrir el panel del nodo seleccionado' },
      { keys: ['Doble clic'], text: 'Abrir o cerrar una carpeta o máquina' }
    ]
  },
  {
    title: 'Consolas y terminal SSH',
    items: [
      { keys: ['Ctrl+V'], text: 'Pegar' },
      { keys: ['Ctrl+Shift+C', 'Ctrl+Insert'], text: 'Copiar la selección (Ctrl+C sigue siendo la interrupción del terminal)' },
      { keys: ['Clic derecho'], text: 'Menú Copiar / Pegar' }
    ]
  }
]
