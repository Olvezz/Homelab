import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { buildHostInstaller, DEFAULT_GUEST_SCRIPT, validateGuestScript } from '../src/main/provision'
import watcherSrc from '../src/main/provision/watcher.sh?raw'

const hasBash = spawnSync('bash', ['-c', 'echo ok']).stdout?.toString().trim() === 'ok'
const fwd = (p: string): string => p.replace(/\\/g, '/')

describe('instalador del nodo', () => {
  it('incluye el script de guest, el vigilante y la unidad de systemd', () => {
    const out = buildHostInstaller('echo hola\n')
    expect(out).toContain("bash -s <<'HL_INSTALLER'")
    expect(out).toContain("<<'HL_GUEST_SCRIPT'\necho hola\nHL_GUEST_SCRIPT")
    expect(out).toContain('homelab-provision.timer')
    expect(out.trimEnd().endsWith('HL_INSTALLER')).toBe(true)
  })
  it('rechaza scripts vacíos o que romperían los heredocs', () => {
    expect(validateGuestScript('')).not.toBeNull()
    expect(validateGuestScript('echo 1\nHL_GUEST_SCRIPT\necho 2')).not.toBeNull()
    expect(validateGuestScript('x'.repeat(20001))).not.toBeNull()
    expect(validateGuestScript(DEFAULT_GUEST_SCRIPT)).toBeNull()
  })
  it.skipIf(!hasBash)('el instalador y el script de guest por defecto son bash/sh válidos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hl-inst-'))
    try {
      const inst = join(dir, 'installer.sh')
      writeFileSync(inst, buildHostInstaller(DEFAULT_GUEST_SCRIPT))
      expect(spawnSync('bash', ['-n', fwd(inst)]).status).toBe(0)
      const guest = join(dir, 'guest.sh')
      writeFileSync(guest, DEFAULT_GUEST_SCRIPT)
      expect(spawnSync('sh', ['-n', fwd(guest)]).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// El vigilante se ejecuta contra `pct`/`qm` simulados: comprueba la lógica sin tocar ningún Proxmox
describe.skipIf(!hasBash)('vigilante (con pct/qm simulados)', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-watch-'))
  const bin = join(root, 'bin')
  const fake = join(root, 'fake')
  const state = join(root, 'state')
  const logs = join(root, 'logs')
  const setup = join(root, 'guest-setup.sh')

  const stub = (name: string, body: string): void => {
    const p = join(bin, name)
    writeFileSync(p, `#!/bin/bash\nFAKE="${fwd(fake)}"\n${body}\n`)
    chmodSync(p, 0o755)
  }

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true })
    for (const d of [bin, fake, state, logs]) mkdirSync(d, { recursive: true })
    writeFileSync(setup, 'echo SETUP\n')
    stub('flock', 'exit 0')
    stub(
      'pct',
      `case "$1" in
  list) { echo "VMID Status Lock Name"; cat "$FAKE/pct-list" 2>/dev/null; } ;;
  config) cat "$FAKE/pct-config-$2" 2>/dev/null; exit 0 ;;
  exec) cat > "$FAKE/exec-$2"; exit "$(cat "$FAKE/pct-exit-$2" 2>/dev/null || echo 0)" ;;
esac`
    )
    stub(
      'qm',
      `case "$1" in
  list) { echo "VMID NAME STATUS MEM BOOTDISK PID"; cat "$FAKE/qm-list" 2>/dev/null; } ;;
  config) cat "$FAKE/qm-config-$2" 2>/dev/null; exit 0 ;;
  agent) [ -e "$FAKE/agent-$2" ] ;;
  guest) cat > "$FAKE/exec-$3"; echo '{"exitcode" : 0, "exited" : 1}' ;;
esac`
    )
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const fakeFile = (name: string, content: string): void => writeFileSync(join(fake, name), content)
  const run = (): void => {
    const r = spawnSync('bash', [fwd(join(root, 'watcher.sh'))], {
      env: {
        ...process.env,
        PATH: `${bin};${process.env.PATH}`,
        HL_STATE_DIR: fwd(state),
        HL_SETUP_SCRIPT: fwd(setup),
        HL_LOG_DIR: fwd(logs)
      },
      encoding: 'utf8'
    })
    expect(r.status, r.stderr).toBe(0)
  }
  const ran = (id: number): boolean => existsSync(join(fake, `exec-${id}`))
  const st = (id: number): string | null =>
    existsSync(join(state, String(id))) ? readFileSync(join(state, String(id)), 'utf8').trim() : null

  beforeEach(() => writeFileSync(join(root, 'watcher.sh'), watcherSrc))

  it('la primera pasada marca lo existente como baseline y no ejecuta nada', () => {
    fakeFile('pct-list', '100 running  adguard\n101 stopped  otro\n')
    fakeFile('qm-list', '102 docker-server running 4096 32 123\n')
    run()
    expect([st(100), st(101), st(102)]).toEqual(['baseline', 'baseline', 'baseline'])
    expect(ran(100) || ran(102)).toBe(false)
  })

  it('un LXC nuevo se prepara una sola vez, con el script de guest', () => {
    fakeFile('pct-list', '100 running adguard\n')
    run()
    fakeFile('pct-list', '100 running adguard\n110 running nuevo\n')
    run()
    expect(readFileSync(join(fake, 'exec-110'), 'utf8')).toBe('echo SETUP\n')
    expect(st(110)).toBe('done')
    expect(ran(100)).toBe(false)
    rmSync(join(fake, 'exec-110'))
    run()
    expect(ran(110)).toBe(false) // no se repite
  })

  it('un guest parado se prepara cuando arranca', () => {
    run()
    fakeFile('pct-list', '110 stopped nuevo\n')
    run()
    expect(st(110)).toBeNull()
    fakeFile('pct-list', '110 running nuevo\n')
    run()
    expect(st(110)).toBe('done')
  })

  it('una VM nueva espera a tener qemu-guest-agent', () => {
    run()
    fakeFile('qm-list', '120 web running 2048 32 55\n')
    run()
    expect(st(120)).toBeNull()
    fakeFile('agent-120', '')
    run()
    expect(readFileSync(join(fake, 'exec-120'), 'utf8')).toBe('echo SETUP\n')
    expect(st(120)).toBe('done')
  })

  it('reintenta los fallos y se rinde tras 5 intentos', () => {
    run()
    fakeFile('pct-list', '111 running roto\n')
    fakeFile('pct-exit-111', '1')
    for (let i = 1; i <= 5; i++) {
      run()
      expect(st(111)).toBe(`fail:${i}`)
    }
    rmSync(join(fake, 'exec-111'))
    run()
    expect(ran(111)).toBe(false)
  }, 60_000)

  it('no toca plantillas ni VMs Windows', () => {
    run()
    fakeFile('pct-list', '130 running plantilla\n')
    fakeFile('pct-config-130', 'template: 1\n')
    fakeFile('qm-list', '131 win running 8192 64 77\n')
    fakeFile('qm-config-131', 'ostype: win11\n')
    fakeFile('agent-131', '')
    run()
    expect([st(130), st(131)]).toEqual(['baseline', 'baseline'])
    expect(ran(130) || ran(131)).toBe(false)
  })

  it('un VMID reutilizado tras borrar el guest cuenta como nuevo', () => {
    fakeFile('pct-list', '100 running viejo\n')
    run()
    expect(st(100)).toBe('baseline')
    fakeFile('pct-list', '') // borrado
    run()
    expect(st(100)).toBeNull()
    fakeFile('pct-list', '100 running recreado\n')
    run()
    expect(st(100)).toBe('done')
  })
})
