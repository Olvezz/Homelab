import { argon2Sync, createCipheriv, createHash, createHmac, generateKeyPairSync, randomBytes } from 'node:crypto'

// Generador de .ppk según la especificación del formato de PuTTY, solo para las pruebas.

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
export const str = (b: Buffer | string): Buffer => {
  const buf = typeof b === 'string' ? Buffer.from(b) : b
  return Buffer.concat([u32(buf.length), buf])
}
export const mpint = (value: Buffer): Buffer => {
  let i = 0
  while (i < value.length && value[i] === 0) i++
  const v = value.subarray(i)
  return str(v.length > 0 && v[0] & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v)
}
const sha1 = (...p: Buffer[]): Buffer => {
  const h = createHash('sha1')
  for (const x of p) h.update(x)
  return h.digest()
}
const b64u = (s: string | undefined): Buffer => Buffer.from(s ?? '', 'base64url')

export interface KeyParts {
  algo: string
  pub: Buffer // blob público
  priv: Buffer // blob privado en claro (formato PPK)
}

export function rsaKey(): KeyParts {
  const jwk = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' })
  return {
    algo: 'ssh-rsa',
    pub: Buffer.concat([str('ssh-rsa'), mpint(b64u(jwk.e)), mpint(b64u(jwk.n))]),
    priv: Buffer.concat([mpint(b64u(jwk.d)), mpint(b64u(jwk.p)), mpint(b64u(jwk.q)), mpint(b64u(jwk.qi))])
  }
}

// `reversed`: la clave se guarda como entero little-endian (lo habitual en PuTTY) o tal cual
export function ed25519Key(reversed = true): KeyParts {
  const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
  const seed = b64u(jwk.d)
  return {
    algo: 'ssh-ed25519',
    pub: Buffer.concat([str('ssh-ed25519'), str(b64u(jwk.x))]),
    priv: mpint(reversed ? Buffer.from(seed).reverse() : seed)
  }
}

export function ecdsaKey(curve: 'P-256' | 'P-384' | 'P-521' = 'P-256'): KeyParts {
  const jwk = generateKeyPairSync('ec', { namedCurve: curve }).privateKey.export({ format: 'jwk' })
  const algo = { 'P-256': 'ecdsa-sha2-nistp256', 'P-384': 'ecdsa-sha2-nistp384', 'P-521': 'ecdsa-sha2-nistp521' }[curve]
  const name = algo.slice('ecdsa-sha2-'.length)
  const q = Buffer.concat([Buffer.from([4]), b64u(jwk.x), b64u(jwk.y)])
  return { algo, pub: Buffer.concat([str(algo), str(name), str(q)]), priv: mpint(b64u(jwk.d)) }
}

const wrap = (b: Buffer): string[] => (b.toString('base64').match(/.{1,64}/g) ?? [])

export function writePpk(key: KeyParts, opts: { version: 2 | 3; passphrase?: string; comment?: string }): string {
  const { version, passphrase } = opts
  const comment = opts.comment ?? 'prueba'
  const enc = passphrase ? 'aes256-cbc' : 'none'
  let plain = key.priv
  let privOut = plain
  let macKey: Buffer
  let macAlgo: 'sha1' | 'sha256'
  const extra: string[] = []

  if (passphrase) {
    const pass = Buffer.from(passphrase)
    plain = Buffer.concat([key.priv, randomBytes((16 - (key.priv.length % 16)) % 16)])
    let aesKey: Buffer
    let iv: Buffer
    if (version === 2) {
      aesKey = Buffer.concat([sha1(u32(0), pass), sha1(u32(1), pass)]).subarray(0, 32)
      iv = Buffer.alloc(16)
      macKey = sha1(Buffer.from('putty-private-key-file-mac-key'), pass)
      macAlgo = 'sha1'
    } else {
      const salt = randomBytes(16)
      const out = argon2Sync('argon2id', { message: pass, nonce: salt, parallelism: 1, tagLength: 80, memory: 256, passes: 2 })
      aesKey = out.subarray(0, 32)
      iv = out.subarray(32, 48)
      macKey = out.subarray(48, 80)
      macAlgo = 'sha256'
      extra.push('Key-Derivation: Argon2id', 'Argon2-Memory: 256', 'Argon2-Passes: 2', 'Argon2-Parallelism: 1', `Argon2-Salt: ${salt.toString('hex')}`)
    }
    const c = createCipheriv('aes-256-cbc', aesKey, iv)
    c.setAutoPadding(false)
    privOut = Buffer.concat([c.update(plain), c.final()])
  } else {
    macKey = version === 2 ? sha1(Buffer.from('putty-private-key-file-mac-key')) : Buffer.alloc(0)
    macAlgo = version === 2 ? 'sha1' : 'sha256'
  }

  const mac = createHmac(macAlgo, macKey)
    .update(Buffer.concat([str(key.algo), str(enc), str(comment), str(key.pub), str(plain)]))
    .digest('hex')
  const pubLines = wrap(key.pub)
  const privLines = wrap(privOut)
  return [
    `PuTTY-User-Key-File-${version}: ${key.algo}`,
    `Encryption: ${enc}`,
    `Comment: ${comment}`,
    `Public-Lines: ${pubLines.length}`,
    ...pubLines,
    ...extra,
    `Private-Lines: ${privLines.length}`,
    ...privLines,
    `Private-MAC: ${mac}`,
    ''
  ].join('\n')
}
