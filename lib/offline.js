import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { runPython } from './python.js'

export async function memoryRuntime(path = process.env.HMBOT_MEMORY_RUNTIME) {
  if (!isAbsolute(path || '')) throw new Error('Run memory-rsi setup, then set HMBOT_MEMORY_RUNTIME to its runtime.json')
  const value = JSON.parse(await readFile(path, 'utf8'))
  if (value.schemaVersion !== 'hmbot.memory.runtime/1') throw new Error('Unsupported Memory runtime')
  return { ...value, path }
}

export async function invokeOffline(action, { config, output, run, runtime, signal } = {}) {
  const rt = await memoryRuntime(runtime)
  for (const path of action === 'prepare' ? [config, output] : [run]) if (!isAbsolute(path || '')) throw new Error('Offline paths must be absolute')
  const args = [join(rt.pluginRoot, 'runtime/prepare.py'), action, ...(action === 'prepare' ? ['--config', config, '--out', output, '--runtime', rt.path] : ['--run', run])]
  const result = await runPython({ cmd: rt.python, args: [] }, args, { signal, timeoutMs: 900000 })
  if (result.code !== 0) throw new Error(result.stderr.slice(-2000) || 'Offline Memory operation failed')
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1))
}

export const prepareOffline = (config, output, options = {}) => invokeOffline('prepare', { config, output, ...options })
export const checkOffline = (run, options = {}) => invokeOffline('check', { run, ...options })

export function commandTokens(text) {
  return (text.match(/"(?:\\.|[^"\\])*"|'[^']*'|\S+/g) || []).map(token => token.startsWith('"') ? JSON.parse(token) : token.startsWith("'") ? token.slice(1, -1) : token)
}
