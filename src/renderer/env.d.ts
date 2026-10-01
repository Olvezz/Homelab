import type { Api } from '../shared/types'

declare global {
  interface Window {
    api: Api
  }
  // Inyectadas en la compilación (electron.vite.config.ts)
  const __APP_VERSION__: string
  const __BUILD_TIME__: string
}
