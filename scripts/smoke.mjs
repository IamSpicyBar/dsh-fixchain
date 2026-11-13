// Smoke test: install this plugin into a throwaway dsh profile (copied from the shipped `sdk` template), configure it
// through the profile patch, boot the profile, and run /fixchain through the real human-command registry (a test-only
// driver plugin mounted with `--patch` calls `ctx.commands.execute`; the SDK's own query path only dispatches
// built-in commands).
//
//   node scripts/smoke.mjs --dsh <dsh bin.js | dsh> --a2h-memory <checkout> --migration <id> --repair <id>
//        --source <android dir> [--with-cards] [--keep]
//
// Without --with-cards no model is called. With it, the card session runs on the worker profile's model and needs
// that model's credentials in the environment (DEEPSEEK_API_KEY for the shipped headless profile).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const dshBin = opt('--dsh') || 'dsh'
const repo = resolve(opt('--a2h-memory') || process.env.A2H_MEMORY || '')
const migration = opt('--migration')
const repair = opt('--repair')
const source = resolve(opt('--source') || '.')
const withCards = argv.includes('--with-cards')
const keep = argv.includes('--keep')
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const profile = `smoke-fixchain-${Date.now().toString(36)}`
const profileDir = join(home, 'profiles', profile)
const outDir = join(pluginDir, 'smoke-out', profile)
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${String(detail).replace(/\s+/g, ' ').slice(0, 260)}` : ''}`)
}
const yamlString = (s) => `'${String(s).replace(/'/g, "''")}'`
const dshArgs = (args) => (dshBin.endsWith('.js') ? [process.execPath, [dshBin, ...args]] : [dshBin, args])
const shell = !dshBin.endsWith('.js') && process.platform === 'win32'

function dsh(args) {
  const [cmd, full] = dshArgs(args)
  return spawnSync(cmd, full, { encoding: 'utf8', windowsHide: true, shell })
}

async function runDriver(lines, label) {
  const out = join(outDir, `driver-${label}.json`)
  const overlay = join(outDir, `driver-${label}.patch.yml`)
  writeFileSync(overlay, ['- insert:', '    - id: dsh-plugin-smoke-driver',
    `      name: ${yamlString(join(pluginDir, 'scripts', 'smoke-driver.js').replace(/\\/g, '/'))}`,
    '      config:', `        out: ${yamlString(out)}`, `        cwd: ${yamlString(process.cwd())}`,
    '        timeoutMs: 1800000', '        lines:', ...lines.map(l => `          - ${yamlString(l)}`), ''].join('\n'))
  const [cmd, full] = dshArgs(['--profile', profile, '--patch', overlay])
  const child = spawn(cmd, full, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell })
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d })
  child.stdout.on('data', () => {})
  const deadline = Date.now() + 90 * 60 * 1000
  while (Date.now() < deadline && child.exitCode === null && !existsSync(out)) await new Promise(res => setTimeout(res, 1000))
  child.stdin.end()
  await new Promise(res => { if (child.exitCode !== null) res(); else { child.on('close', res); setTimeout(res, 20000) } })
  if (child.exitCode === null) child.kill()
  writeFileSync(join(outDir, `stderr-${label}.txt`), stderr)
  if (!existsSync(out)) throw new Error(`driver produced no results; stderr:\n${stderr.slice(-3000)}`)
  return JSON.parse(readFileSync(out, 'utf8')).results
}

function baseStore() {
  const lib = join(repo, 'tests', 'fixtures', 'library')
  const rev = JSON.parse(readFileSync(join(lib, 'manifest.json'), 'utf8')).memory_revision
  const store = join(outDir, 'start-store')
  mkdirSync(join(store, 'snapshots'), { recursive: true })
  mkdirSync(join(store, 'cases'), { recursive: true })
  writeFileSync(join(store, 'HEAD.json'), JSON.stringify({ revision: rev }))
  writeFileSync(join(store, 'snapshots', `${rev}.json`), JSON.stringify({ revision: rev, lessons: {}, cases: {} }))
  return { store, lib, rev }
}

async function main() {
  if (!migration || !repair) throw new Error('need --migration <id> and --repair <id> of recorded dsh Sessions')
  if (!existsSync(join(repo, 'distill', 'distill.py'))) throw new Error(`--a2h-memory is not an a2h-memory checkout: ${repo}`)
  mkdirSync(outDir, { recursive: true })
  let r = dsh(['--profile', profile, '--from-default-profile', 'sdk', '--dump-config'])
  check('throwaway profile from the sdk template', r.status === 0 && existsSync(profileDir), profileDir)
  r = dsh(['plugin', '--profile', profile, 'add', pluginDir])
  check('dsh plugin add <this package>', r.status === 0, `exit ${r.status}`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), ['- id: dsh-fixchain', '  config:',
    `    a2hMemory: ${yamlString(repo)}`, `    runsDir: ${yamlString(join(outDir, 'runs'))}`, ''].join('\n'))
  r = dsh(['--profile', profile, '--dump-config'])
  check('composed tree has the dsh-fixchain layer and its profile config', r.status === 0 && /# == dsh-fixchain/.test(r.stdout)
    && r.stdout.includes('a2hMemory'))

  const { store, lib, rev } = baseStore()
  const run = join(outDir, 'run')
  const lines = ['/fixchain help', `/fixchain view ${migration} ${repair}`, '@fetch', '/fixchain stop',
    `/fixchain prepare --migration ${migration} --repair ${repair} --source ${source} --base-store ${store} --base-memory ${lib} --out ${run} --app Tally`,
    `/fixchain status ${run}`, `/fixchain check ${run}`]
  const report = await runDriver(lines, 'base')
  const at = (prefix) => report.find(x => x.line.startsWith(prefix))
  check('driver agent created inside dsh', Boolean(at('@agent')), at('@agent')?.sessionId ?? report.at(-1)?.error)
  check('/fixchain help', at('/fixchain help')?.kind === 'success', at('/fixchain help')?.text)
  const viewed = at('/fixchain view')
  check('/fixchain view (trajectory only, no analysis)', viewed?.kind === 'success' && /http:\/\/127\.0\.0\.1:\d+\//.test(viewed.text), viewed?.text)
  const page = report.find(x => x.line.startsWith('@fetch '))
  check('viewer page answers 200', page?.status === 200 && page.bytes > 1000, `${page?.status} ${page?.bytes}B`)
  check('/fixchain stop', at('/fixchain stop')?.kind === 'success' && /已停止 1/.test(at('/fixchain stop').text), at('/fixchain stop')?.text)
  const prepared = at('/fixchain prepare')
  check('/fixchain prepare (distill.py prepare --platform dsh)', prepared?.kind === 'success' && existsSync(join(run, 'job.json')), prepared?.text)
  if (existsSync(join(run, 'job.json'))) {
    const job = JSON.parse(readFileSync(join(run, 'job.json'), 'utf8'))
    check('job.json: dsh platform, dsh worker, start library', job.platform === 'dsh' && job.worker_host === 'dsh'
      && job.memory_library_revision === rev && job.boundary_evidence.final_commit_receipt, JSON.stringify(job.boundary_evidence))
    const man = JSON.parse(readFileSync(join(run, 'materials-manifest.json'), 'utf8'))
    check('frozen pools: migration + sub-agent + repair', man.files.length === 3, man.files.map(f => f.frozen).join(' '))
  }
  check('/fixchain status', at('/fixchain status')?.kind === 'success', at('/fixchain status')?.text)
  check('/fixchain check before delivery reports the gap', at('/fixchain check')?.kind === 'success'
    && /missing_completion_json/.test(at('/fixchain check').text), at('/fixchain check')?.text)

  if (withCards) {
    const cardLines = [`/fixchain cards ${run}`, `@until-done ${join(run, 'dsh-worker-state.json')} 5400000`, `/fixchain status ${run}`]
    const cardReport = await runDriver(cardLines, 'cards')
    const done = cardReport.find(x => x.line.startsWith('@until-done'))
    check('/fixchain cards: worker session ran inside dsh', cardReport.find(x => x.line.startsWith('/fixchain cards'))?.kind === 'success'
      && done?.state?.sessionId, `${done?.status} session ${done?.state?.sessionId}`)
    check('distill.py check after the card session', done?.state?.check?.ok === true, JSON.stringify(done?.state?.check).slice(0, 400))
    check('/fixchain status after cards', cardReport.at(-1)?.kind === 'success', cardReport.at(-1)?.text)
  }
  if (!keep) {
    rmSync(profileDir, { recursive: true, force: true })
    check('throwaway profile removed', !existsSync(profileDir))
  }
  const failed = results.filter(x => !x.ok)
  writeFileSync(join(outDir, 'smoke-summary.json'), JSON.stringify({ profile, results, driver: report }, null, 1))
  console.log(JSON.stringify({ profile, passed: results.length - failed.length, failed: failed.length, out: outDir }, null, 1))
  process.exit(failed.length ? 1 : 0)
}

main().catch((error) => { console.error(error); process.exit(1) })
