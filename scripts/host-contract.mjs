/**
 * Host-half contract probe for dsh-wolfram-mcp.
 *
 * The probe intentionally does not run `apply()`: activation copies real files
 * into `$DSH_HOME` and may spawn wolframscript. Instead it verifies the Loader
 * identity, required injections, and the pure conversion that the runtime
 * depends on.
 *
 * @module scripts/host-contract
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { runProbe } from './lib/probe-runner.mjs'

/**
 * Assert the Host-half contract.
 * @param {{ root: string, patchId: string, check: (label: string, condition: boolean, detail?: string) => void }} context
 *   probe inputs.
 * @returns {Promise<{ identity: string | undefined }>} declared identity.
 */
export async function probeHost({ root, patchId, check }) {
  const mod = await import(pathToFileURL(join(root, 'index.js')).href)
  const wolfram = await import(pathToFileURL(join(root, 'lib', 'wolfram.js')).href)

  check('exports apply()', typeof mod.apply === 'function')
  const strings = Object.entries(mod).filter(([, value]) => typeof value === 'string')
  const identity = strings.find(([, value]) => value === patchId)?.[1]
  check(`an exported id constant equals the patch id (${patchId})`, identity !== undefined, `exported strings: ${strings.map(([name]) => name).join(', ') || 'none'}`)
  check(
    'injects mcpManager, webServer, and connection',
    Array.isArray(mod.inject) && ['mcpManager', 'webServer', 'connection'].every((name) => mod.inject.includes(name)),
    JSON.stringify(mod.inject),
  )

  const sample = JSON.parse(readFileSync(join(root, 'src', 'wolframlanguage_mcp.json'), 'utf8'))
  const parsed = wolfram.parseGeneratedConfiguration(JSON.stringify(sample))
  const converted = wolfram.convertWolframConfiguration(parsed)
  check('parses one WolframLanguage server', converted.errors.length === 0 && converted.entries.length === 1)
  const entry = converted.entries[0]
  check(
    'converts it to a stdio registration with the long startup budget',
    entry?.name === 'WolframLanguage'
      && entry.entry.transport === 'stdio'
      && entry.entry.command === '/Applications/Wolfram.app/Contents/MacOS/wolfram'
      && entry.entry.startupTimeoutMs === 600000,
    JSON.stringify(entry),
  )

  return { identity }
}

runProbe(import.meta.url, probeHost)
