import { utils } from 'ssh2'
import { describe, expect, it } from 'vitest'
import { isPpk, PpkError, ppkToOpenSsh } from '../src/main/ssh/ppk'
import { ecdsaKey, ed25519Key, rsaKey, writePpk, type KeyParts } from './helpers/ppk-writer'

// La clave convertida debe ser válida para ssh2, tener la misma parte pública y poder firmar/verificar
function expectValid(pem: string, key: KeyParts): void {
  const parsed = utils.parseKey(pem)
  expect(parsed instanceof Error ? parsed.message : 'ok').toBe('ok')
  const k = Array.isArray(parsed) ? parsed[0] : parsed
  expect(k.getPublicSSH().equals(key.pub)).toBe(true)
  const data = Buffer.from('mensaje de prueba')
  const sig = k.sign(data)
  expect(sig instanceof Error).toBe(false)
  expect(k.verify(data, sig as Buffer)).toBeTruthy()
}

const keys: Record<string, KeyParts> = {
  rsa: rsaKey(),
  ed25519: ed25519Key(true),
  'ed25519 (orientación directa)': ed25519Key(false),
  'ecdsa P-256': ecdsaKey('P-256'),
  'ecdsa P-384': ecdsaKey('P-384'),
  'ecdsa P-521': ecdsaKey('P-521')
}

describe('.ppk -> OpenSSH', () => {
  for (const [name, key] of Object.entries(keys)) {
    for (const version of [2, 3] as const) {
      it(`${name}, v${version}, sin frase de paso`, () => {
        expectValid(ppkToOpenSsh(writePpk(key, { version })).pem, key)
      })
      it(`${name}, v${version}, con frase de paso`, () => {
        expectValid(ppkToOpenSsh(writePpk(key, { version, passphrase: 'frase secreta ñ' }), 'frase secreta ñ').pem, key)
      })
    }
  }

  it('el .ppk v2 RSA que escribo lo entiende también el lector de ssh2 (valida el formato)', () => {
    const text = writePpk(keys.rsa, { version: 2 })
    const theirs = utils.parseKey(text)
    expect(theirs instanceof Error ? theirs.message : 'ok').toBe('ok')
    const k = Array.isArray(theirs) ? theirs[0] : theirs
    expect(k.getPublicSSH().equals(keys.rsa.pub)).toBe(true)
    expect(utils.parseKey(ppkToOpenSsh(text).pem)).not.toBeInstanceOf(Error)
  })

  it('frase de paso incorrecta o ausente: errores claros', () => {
    const text = writePpk(keys.ed25519, { version: 3, passphrase: 'buena' })
    expect(() => ppkToOpenSsh(text, 'mala')).toThrowError(expect.objectContaining({ code: 'BAD_PASSPHRASE' }))
    expect(() => ppkToOpenSsh(text)).toThrowError(expect.objectContaining({ code: 'NEEDS_PASSPHRASE' }))
    const v2 = writePpk(keys.rsa, { version: 2, passphrase: 'buena' })
    expect(() => ppkToOpenSsh(v2, 'mala')).toThrowError(expect.objectContaining({ code: 'BAD_PASSPHRASE' }))
  })

  it('un archivo manipulado se rechaza (la firma interna no coincide)', () => {
    const text = writePpk(keys.rsa, { version: 3 }).replace(/Comment: .*/, 'Comment: otra')
    expect(() => ppkToOpenSsh(text)).toThrowError(expect.objectContaining({ code: 'INVALID' }))
  })

  it('DSA, versiones desconocidas y basura no se aceptan', () => {
    const dsa = writePpk({ ...keys.rsa, algo: 'ssh-dss' }, { version: 2 })
    expect(() => ppkToOpenSsh(dsa)).toThrow(PpkError)
    expect(() => ppkToOpenSsh('PuTTY-User-Key-File-9: ssh-rsa\n')).toThrow(PpkError)
    expect(() => ppkToOpenSsh('no soy una clave')).toThrow(PpkError)
    expect(isPpk('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(false)
    expect(isPpk('PuTTY-User-Key-File-3: ssh-ed25519\n')).toBe(true)
  })

  it('un archivo hostil no puede pedir una memoria enorme', () => {
    const text = writePpk(keys.ed25519, { version: 3, passphrase: 'x' }).replace('Argon2-Memory: 256', 'Argon2-Memory: 99999999')
    expect(() => ppkToOpenSsh(text, 'x')).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED' }))
  })
})
