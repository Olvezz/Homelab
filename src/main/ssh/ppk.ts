import {
  argon2Sync,
  createDecipheriv,
  createECDH,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'

// Lector de claves de PuTTY (.ppk v2 y v3, con o sin frase de paso) que las convierte, en memoria, al
// formato OpenSSH que entiende ssh2. ssh2 solo lee .ppk v2 de tipo RSA/DSA: aquí se añaden v3,
// ed25519 y ECDSA. Nada se escribe en disco.

export type PpkErrorCode = 'NEEDS_PASSPHRASE' | 'BAD_PASSPHRASE' | 'UNSUPPORTED' | 'INVALID'

export class PpkError extends Error {
  constructor(
    public code: PpkErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PpkError'
  }
}

export function isPpk(text: string): boolean {
  return /^PuTTY-User-Key-File-[123]:/.test(text.trimStart())
}

// ---- formato de red de SSH ----

class Reader {
  private pos = 0
  constructor(private buf: Buffer) {}
  bytes(n: number): Buffer {
    if (n < 0 || this.pos + n > this.buf.length) throw new PpkError('INVALID', 'Clave .ppk dañada')
    const out = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  string(): Buffer {
    return this.bytes(this.bytes(4).readUInt32BE(0))
  }
  // mpint sin ceros a la izquierda
  mpint(): Buffer {
    const raw = this.string()
    let i = 0
    while (i < raw.length - 1 && raw[i] === 0) i++
    return raw.subarray(i)
  }
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const str = (b: Buffer | string): Buffer => {
  const buf = typeof b === 'string' ? Buffer.from(b) : b
  return Buffer.concat([u32(buf.length), buf])
}
const mpint = (value: Buffer): Buffer => {
  let i = 0
  while (i < value.length && value[i] === 0) i++
  const v = value.subarray(i)
  return str(v.length > 0 && v[0] & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v)
}
const padLeft = (b: Buffer, len: number): Buffer =>
  b.length >= len ? b : Buffer.concat([Buffer.alloc(len - b.length), b])

// ---- lectura del archivo .ppk ----

interface Parsed {
  version: 2 | 3
  algo: string
  encryption: string
  comment: string
  pub: Buffer
  priv: Buffer
  mac: string
  argon?: { flavor: string; memory: number; passes: number; parallelism: number; salt: Buffer }
}

function parseFile(text: string): Parsed {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const head = /^PuTTY-User-Key-File-(\d+): (\S+)$/.exec(lines[0] ?? '')
  if (!head) throw new PpkError('INVALID', 'No es una clave .ppk')
  const version = Number(head[1])
  if (version !== 2 && version !== 3) throw new PpkError('UNSUPPORTED', 'Versión de .ppk no soportada (usa v2 o v3)')

  const fields = new Map<string, string>()
  let pub = ''
  let priv = ''
  for (let i = 1; i < lines.length; i++) {
    const m = /^([A-Za-z0-9-]+): ?(.*)$/.exec(lines[i])
    if (!m) continue
    const [, key, value] = m
    if (key === 'Public-Lines' || key === 'Private-Lines') {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw new PpkError('INVALID', 'Clave .ppk dañada')
      const body = lines.slice(i + 1, i + 1 + n).join('')
      if (key === 'Public-Lines') pub = body
      else priv = body
      i += n
    } else {
      fields.set(key, value.trim())
    }
  }
  if (!pub || !priv || !fields.get('Private-MAC')) throw new PpkError('INVALID', 'Clave .ppk incompleta')

  const parsed: Parsed = {
    version,
    algo: head[2],
    encryption: fields.get('Encryption') ?? 'none',
    comment: fields.get('Comment') ?? '',
    pub: Buffer.from(pub, 'base64'),
    priv: Buffer.from(priv, 'base64'),
    mac: fields.get('Private-MAC')!.toLowerCase()
  }
  if (version === 3 && parsed.encryption !== 'none') {
    const flavor = (fields.get('Key-Derivation') ?? '').toLowerCase()
    const salt = fields.get('Argon2-Salt')
    if (!['argon2id', 'argon2i', 'argon2d'].includes(flavor) || !salt) throw new PpkError('INVALID', 'Clave .ppk dañada')
    parsed.argon = {
      flavor,
      memory: Number(fields.get('Argon2-Memory')),
      passes: Number(fields.get('Argon2-Passes')),
      parallelism: Number(fields.get('Argon2-Parallelism')),
      salt: Buffer.from(salt, 'hex')
    }
    if (![parsed.argon.memory, parsed.argon.passes, parsed.argon.parallelism].every((n) => Number.isInteger(n) && n > 0)) {
      throw new PpkError('INVALID', 'Clave .ppk dañada')
    }
    // Un archivo hostil no debe poder pedir gigas de memoria
    if (parsed.argon.memory > 1024 * 1024 || parsed.argon.passes > 1000) {
      throw new PpkError('UNSUPPORTED', 'Parámetros de cifrado de la clave demasiado grandes')
    }
  }
  return parsed
}

// ---- descifrado y comprobación ----

function sha1(...parts: Buffer[]): Buffer {
  const h = createHash('sha1')
  for (const p of parts) h.update(p)
  return h.digest()
}

function decryptAndVerify(p: Parsed, passphrase: string | undefined): Buffer {
  let priv = p.priv
  let macKey: Buffer
  let macAlgo: 'sha1' | 'sha256'

  if (p.encryption === 'none') {
    macKey = p.version === 2 ? sha1(Buffer.from('putty-private-key-file-mac-key')) : Buffer.alloc(0)
    macAlgo = p.version === 2 ? 'sha1' : 'sha256'
  } else if (p.encryption === 'aes256-cbc') {
    if (passphrase === undefined || passphrase === '') {
      throw new PpkError('NEEDS_PASSPHRASE', 'La clave .ppk está protegida con frase de paso')
    }
    const pass = Buffer.from(passphrase, 'utf8')
    let key: Buffer
    let iv: Buffer
    if (p.version === 2) {
      key = Buffer.concat([sha1(u32(0), pass), sha1(u32(1), pass)]).subarray(0, 32)
      iv = Buffer.alloc(16)
      macKey = sha1(Buffer.from('putty-private-key-file-mac-key'), pass)
      macAlgo = 'sha1'
    } else {
      const a = p.argon!
      const out = argon2Sync(a.flavor as 'argon2id', {
        message: pass,
        nonce: a.salt,
        parallelism: a.parallelism,
        tagLength: 80,
        memory: a.memory,
        passes: a.passes
      })
      key = out.subarray(0, 32)
      iv = out.subarray(32, 48)
      macKey = out.subarray(48, 80)
      macAlgo = 'sha256'
    }
    if (priv.length % 16 !== 0) throw new PpkError('INVALID', 'Clave .ppk dañada')
    const d = createDecipheriv('aes-256-cbc', key, iv)
    d.setAutoPadding(false)
    priv = Buffer.concat([d.update(priv), d.final()])
  } else {
    throw new PpkError('UNSUPPORTED', `Cifrado de .ppk no soportado: ${p.encryption}`)
  }

  const data = Buffer.concat([str(p.algo), str(p.encryption), str(p.comment), str(p.pub), str(priv)])
  const calc = createHmac(macAlgo, macKey).update(data).digest()
  const given = Buffer.from(p.mac, 'hex')
  if (calc.length !== given.length || !timingSafeEqual(calc, given)) {
    throw p.encryption === 'none'
      ? new PpkError('INVALID', 'La clave .ppk está dañada (la firma interna no coincide)')
      : new PpkError('BAD_PASSPHRASE', 'Frase de paso incorrecta')
  }
  return priv
}

// ---- conversión a OpenSSH (openssh-key-v1, sin cifrar) ----

function opensshContainer(algo: string, pubBlob: Buffer, privFields: Buffer, comment: string): string {
  const check = randomBytes(4)
  let section = Buffer.concat([check, check, str(algo), privFields, str(comment)])
  const pad = (8 - (section.length % 8)) % 8
  section = Buffer.concat([section, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))])
  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    str('none'),
    str('none'),
    str(''),
    u32(1),
    str(pubBlob),
    str(section)
  ])
  const b64 = body.toString('base64').replace(/(.{70})/g, '$1\n')
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64.replace(/\n$/, '')}\n-----END OPENSSH PRIVATE KEY-----\n`
}

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

function ed25519Public(seed: Buffer): Buffer {
  const priv = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' })
  const spki = createPublicKey(priv).export({ format: 'der', type: 'spki' })
  return spki.subarray(spki.length - 32)
}

const EC_CURVES: Record<string, { node: string; size: number }> = {
  'ecdsa-sha2-nistp256': { node: 'prime256v1', size: 32 },
  'ecdsa-sha2-nistp384': { node: 'secp384r1', size: 48 },
  'ecdsa-sha2-nistp521': { node: 'secp521r1', size: 66 }
}

export interface ConvertedKey {
  pem: string // clave privada en formato OpenSSH, sin cifrar (solo en memoria)
  type: string
  comment: string
}

export function ppkToOpenSsh(text: string, passphrase?: string): ConvertedKey {
  const p = parseFile(text)
  const priv = decryptAndVerify(p, passphrase)
  const pubR = new Reader(p.pub)
  const privR = new Reader(priv)
  const algo = pubR.string().toString()
  if (algo !== p.algo) throw new PpkError('INVALID', 'Clave .ppk dañada')

  if (algo === 'ssh-rsa') {
    const e = pubR.mpint()
    const n = pubR.mpint()
    const d = privR.mpint()
    const pp = privR.mpint()
    const q = privR.mpint()
    const iqmp = privR.mpint()
    return {
      pem: opensshContainer(algo, p.pub, Buffer.concat([mpint(n), mpint(e), mpint(d), mpint(iqmp), mpint(pp), mpint(q)]), p.comment),
      type: algo,
      comment: p.comment
    }
  }

  if (algo === 'ssh-ed25519') {
    const pub32 = pubR.string()
    const raw = padLeft(privR.mpint(), 32)
    // PuTTY guarda la clave como entero: según la orientación puede venir invertida. Se elige la que
    // reproduce exactamente la clave pública del archivo.
    const candidates = [Buffer.from(raw).reverse(), raw]
    const seed = candidates.find((c) => c.length === 32 && ed25519Public(c).equals(pub32))
    if (!seed) throw new PpkError('INVALID', 'No se pudo validar la clave ed25519 del .ppk')
    return {
      pem: opensshContainer(algo, p.pub, Buffer.concat([str(pub32), str(Buffer.concat([seed, pub32]))]), p.comment),
      type: algo,
      comment: p.comment
    }
  }

  const curve = EC_CURVES[algo]
  if (curve) {
    const curveName = pubR.string()
    const q = pubR.string()
    const d = padLeft(privR.mpint(), curve.size)
    const ecdh = createECDH(curve.node)
    ecdh.setPrivateKey(d)
    if (!ecdh.getPublicKey(null, 'uncompressed').equals(q)) throw new PpkError('INVALID', 'No se pudo validar la clave ECDSA del .ppk')
    return {
      pem: opensshContainer(algo, p.pub, Buffer.concat([str(curveName), str(q), mpint(d)]), p.comment),
      type: algo,
      comment: p.comment
    }
  }

  throw new PpkError('UNSUPPORTED', `Tipo de clave no soportado en .ppk: ${algo} (las claves DSA no se admiten)`)
}
