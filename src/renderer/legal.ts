// Documentos legales que se muestran en Ajustes → General → Legal. La fuente es la carpeta `legal/` del repositorio
// (y THIRD_PARTY_NOTICES.md); se empaquetan dentro de la interfaz y también viajan con el instalador.
import privacidad from '../../legal/privacidad.md?raw'
import cookies from '../../legal/cookies.md?raw'
import rembolso from '../../legal/rembolso.md?raw'
import terminos from '../../legal/terminos.md?raw'
import licencias from '../../THIRD_PARTY_NOTICES.md?raw'

export type LegalId = 'terminos' | 'privacidad' | 'cookies' | 'rembolso' | 'licencias'

export const LEGAL_DOCS: { id: LegalId; title: string; body: string }[] = [
  { id: 'terminos', title: 'Términos y condiciones', body: terminos },
  { id: 'privacidad', title: 'Política de privacidad', body: privacidad },
  { id: 'cookies', title: 'Política de cookies', body: cookies },
  { id: 'rembolso', title: 'Política de rembolso', body: rembolso },
  { id: 'licencias', title: 'Licencias de terceros', body: licencias }
]
