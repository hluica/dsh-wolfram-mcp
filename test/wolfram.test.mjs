/**
 * Unit tests for Wolfram output parsing and DSH registration conversion.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildGenerationCommands,
  convertWolframConfiguration,
  parseGeneratedConfiguration,
  sameJson,
  toWolframString,
} from '../lib/wolfram.js'
import { MCP_SERVER_STARTUP_TIMEOUT_MS } from '../lib/constants.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sample = JSON.parse(readFileSync(join(root, 'src', 'wolframlanguage_mcp.json'), 'utf8'))

test('parses the captured Wolfram JSONConfiguration', () => {
  const parsed = parseGeneratedConfiguration(JSON.stringify(sample))
  assert.equal(parsed.mcpServers.WolframLanguage.command, '/Applications/Wolfram.app/Contents/MacOS/wolfram')
})

test('tolerates kernel progress noise and quoted JSON', () => {
  const noisy = `Loading from Wolfram Research server… (92%)\n${JSON.stringify(sample)}\nDone`
  assert.equal(parseGeneratedConfiguration(noisy).mcpServers.WolframLanguage.type, 'stdio')
  assert.equal(parseGeneratedConfiguration(JSON.stringify(JSON.stringify(sample))).mcpServers.WolframLanguage.type, 'stdio')
})

test('rejects empty and malformed output', () => {
  assert.throws(() => parseGeneratedConfiguration(''))
  assert.throws(() => parseGeneratedConfiguration('{"notMcp":true}'))
  assert.throws(() => parseGeneratedConfiguration('not json at all'))
})

test('converts the sample into one stdio registration', () => {
  const { entries, errors } = convertWolframConfiguration(sample)
  assert.deepEqual(errors, [])
  assert.equal(entries.length, 1)
  const [{ name, entry }] = entries
  assert.equal(name, 'WolframLanguage')
  assert.equal(entry.transport, 'stdio')
  assert.equal(entry.command, '/Applications/Wolfram.app/Contents/MacOS/wolfram')
  assert.deepEqual(entry.args, [
    '-run',
    'PacletSymbol["Wolfram/AgentTools","Wolfram`AgentTools`StartMCPServer"][]',
    '-noinit',
    '-noprompt',
  ])
  assert.equal(entry.env.MCP_SERVER_NAME, 'WolframLanguage')
  assert.equal(entry.startupTimeoutMs, MCP_SERVER_STARTUP_TIMEOUT_MS)
})

test('reports invalid names, missing commands, and unsupported transports', () => {
  const { entries, errors } = convertWolframConfiguration({
    mcpServers: {
      'bad name': { type: 'stdio', command: '/bin/true' },
      missingCommand: { type: 'stdio' },
      unknown: { type: 'websocket', url: 'ws://example.invalid' },
      good: { type: 'stdio', command: '/bin/true' },
    },
  })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].name, 'good')
  assert.equal(errors.length, 3)
})

test('converts a streamable-http entry', () => {
  const { entries } = convertWolframConfiguration({
    mcpServers: {
      cloud: { type: 'http', url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer x' } },
    },
  })
  assert.deepEqual(entries, [{
    name: 'cloud',
    entry: {
      transport: 'streamable-http',
      url: 'https://example.invalid/mcp',
      headers: { Authorization: 'Bearer x' },
      startupTimeoutMs: MCP_SERVER_STARTUP_TIMEOUT_MS,
    },
  }])
})

test('builds three ordered generation attempts', () => {
  const commands = buildGenerationCommands({ tempFile: '/tmp/out.json' })
  assert.deepEqual(commands.map((command) => command.kind), ['write-string', 'direct', 'export'])
  assert.match(commands[0].code, /^WriteString\["stdout", PacletSymbol/)
  assert.match(commands[2].code, /^Export\["\/tmp\/out\.json"/)
})

test('escapes Wolfram string literals', () => {
  assert.equal(toWolframString('/tmp/a"b\\c'), '"/tmp/a\\"b\\\\c"')
})

test('compares JSON independent of key order', () => {
  assert.equal(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 }), true)
  assert.equal(sameJson({ a: 1 }, { a: 2 }), false)
})
