/**
 * Integration tests for the Host runtime with a stubbed Cordis context.
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { WolframMcpRuntime } from '../lib/runtime.js'
import { defaultState, writeStateAtomic } from '../lib/state.js'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const skillsSource = join(pluginRoot, 'src', 'Skills')

function makeContext(overrides = {}) {
  const registered = new Map()
  const effects = []
  const routes = []
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    mcpManager: {
      register(name, entry) {
        registered.set(name, entry)
        return () => registered.delete(name)
      },
      list() {
        return [...registered.keys()].map((name) => ({
          name,
          configured: false,
          status: { state: 'connected', toolCount: 7, connectedAt: 1 },
        }))
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => routes.splice(routes.indexOf(route), 1)
      },
    },
    connection: {
      admit() {
        return { peer: { principal: { kind: 'owner' } } }
      },
    },
    effect(callback) {
      const cleanup = callback()
      effects.push(cleanup)
      return () => {
        if (typeof cleanup === 'function') cleanup()
      }
    },
  }
  return { ctx: { ...ctx, ...overrides }, registered, effects, routes }
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body) {
      this.body = body
    },
  }
}

function readBody(response) {
  return JSON.parse(response.body)
}

test('registers the persisted configuration, serves state, and removes its own copies', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dwm-runtime-'))
  try {
    const statePath = join(home, 'dsh-wolfram-mcp', 'state.json')
    const skillsRoot = join(home, 'skills')
    const bin = join(home, 'bin')
    mkdirSync(bin, { recursive: true })
    const command = join(bin, 'wolfram')
    writeFileSync(command, '#!/bin/sh\nexit 0\n')
    chmodSync(command, 0o755)

    const config = {
      mcpServers: {
        WolframLanguage: {
          type: 'stdio',
          command,
          args: ['-run', 'PacletSymbol["Wolfram/AgentTools","Wolfram`AgentTools`StartMCPServer"][]'],
          env: { MCP_SERVER_NAME: 'WolframLanguage' },
        },
      },
    }
    writeStateAtomic(statePath, {
      ...defaultState(),
      config,
      fetchedAt: '2026-11-18T00:00:00.000Z',
      lastAttemptAt: '2026-11-18T00:00:00.000Z',
      lastSource: 'initial',
      wolframscript: '/usr/local/bin/wolframscript',
    })

    const { ctx, registered } = makeContext()
    const runtime = new WolframMcpRuntime(ctx, { env: {}, statePath, skillsRoot, skillsSource })
    runtime.start()

    assert.equal(registered.size, 1)
    assert.equal(registered.get('WolframLanguage').command, command)
    assert.equal(runtime.snapshot().skills.installed.length, 4)

    const response = fakeResponse()
    await runtime.handleRequest({ method: 'GET', url: '/dsh-wolfram-mcp/api/state' }, response)
    assert.equal(response.statusCode, 200)
    const payload = readBody(response)
    assert.equal(payload.ok, true)
    assert.equal(payload.result.config.mcpServers.WolframLanguage.command, command)
    assert.equal(payload.result.mcpServers[0].status.toolCount, 7)
    assert.equal(payload.result.persisted, true)

    const denied = fakeResponse()
    const unauthorized = new WolframMcpRuntime(
      { ...ctx, connection: { admit: () => ({ peer: { principal: { kind: 'user' } } }) } },
      { env: {}, statePath, skillsRoot, skillsSource },
    )
    await unauthorized.handleRequest({ method: 'GET', url: '/dsh-wolfram-mcp/api/state' }, denied)
    assert.equal(denied.statusCode, 403)

    runtime.dispose()
    assert.equal(registered.size, 0)
    assert.equal(existsSync(join(skillsRoot, 'wolfram-language')), false)
    assert.equal(existsSync(statePath), true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('shares one refresh promise and clears the refreshing flag', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dwm-runtime-'))
  try {
    const { ctx } = makeContext()
    const runtime = new WolframMcpRuntime(ctx, {
      env: {},
      statePath: join(home, 'state.json'),
      skillsRoot: join(home, 'skills'),
      skillsSource,
    })
    /** @type {Array<(value: unknown) => void>} */
    const gates = []
    runtime.performRefresh = () => new Promise((resolve) => gates.push(resolve))
    const first = runtime.refresh('manual')
    const second = runtime.refresh('manual')
    assert.equal(first, second)
    assert.equal(runtime.refreshing, true)
    gates[0]({ ok: true })
    await first
    assert.equal(runtime.refreshing, false)
    runtime.dispose()
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
