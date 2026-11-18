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
  const listeners = new Map()
  const statusRef = { current: { state: 'connected', toolCount: 7, connectedAt: 1 } }
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
          status: statusRef.current,
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
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    effect(callback) {
      const cleanup = callback()
      effects.push(cleanup)
      return () => {
        if (typeof cleanup === 'function') cleanup()
      }
    },
  }
  return { ctx: { ...ctx, ...overrides }, registered, effects, routes, listeners, statusRef }
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
    assert.equal(payload.result.phase, 'ready')
    assert.equal(typeof payload.result.mcpReadyAt, 'string')

    runtime.performRefresh = async () => ({ ok: true })
    const refreshed = fakeResponse()
    await runtime.handleRequest({ method: 'POST', url: '/dsh-wolfram-mcp/api/refresh' }, refreshed)
    assert.equal(refreshed.statusCode, 200)
    assert.equal(readBody(refreshed).ok, true)

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

test('reports mcp-starting until the manager emits a connected status', () => {
  const home = mkdtempSync(join(tmpdir(), 'dwm-runtime-'))
  try {
    const statePath = join(home, 'dsh-wolfram-mcp', 'state.json')
    const skillsRoot = join(home, 'skills')
    writeStateAtomic(statePath, {
      ...defaultState(),
      config: {
        mcpServers: {
          WolframLanguage: {
            type: 'stdio',
            command: '/usr/bin/true',
            args: [],
            env: {},
          },
        },
      },
      fetchedAt: '2026-11-18T00:00:00.000Z',
      lastAttemptAt: '2026-11-18T00:00:00.000Z',
      lastSource: 'initial',
    })
    const { ctx, listeners, statusRef } = makeContext()
    statusRef.current = { state: 'connecting', attempt: 1 }
    const runtime = new WolframMcpRuntime(ctx, { env: {}, statePath, skillsRoot, skillsSource })
    runtime.start()

    assert.equal(runtime.snapshot().phase, 'mcp-starting')
    assert.equal(runtime.snapshot().mcpReadyAt, null)

    const listener = listeners.get('mcp-manager/status')
    assert.equal(typeof listener, 'function')
    listener('WolframLanguage', { state: 'connected', toolCount: 7, connectedAt: 1 })

    const snapshot = runtime.snapshot()
    assert.equal(snapshot.phase, 'ready')
    assert.equal(typeof snapshot.mcpReadyAt, 'string')
    runtime.dispose()
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('reports error when the last fetch failed and no configuration exists', () => {
  const home = mkdtempSync(join(tmpdir(), 'dwm-runtime-'))
  try {
    const statePath = join(home, 'dsh-wolfram-mcp', 'state.json')
    writeStateAtomic(statePath, {
      ...defaultState(),
      lastAttemptAt: '2026-11-18T00:00:00.000Z',
      lastError: 'wolframscript not found',
    })
    const { ctx } = makeContext()
    const runtime = new WolframMcpRuntime(ctx, {
      env: {},
      statePath,
      skillsRoot: join(home, 'skills'),
      skillsSource,
    })
    runtime.start()
    assert.equal(runtime.snapshot().phase, 'error')
    runtime.dispose()
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
    assert.equal(runtime.snapshot().phase, 'fetching')
    gates[0]({ ok: true })
    await first
    assert.equal(runtime.refreshing, false)
    runtime.dispose()
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
