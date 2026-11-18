/**
 * Unit tests for persisted state handling.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defaultState, normalizeState, readState, writeStateAtomic } from '../lib/state.js'

const config = { mcpServers: { WolframLanguage: { type: 'stdio', command: '/bin/true' } } }

test('round-trips a state document atomically', () => {
  const root = mkdtempSync(join(tmpdir(), 'dwm-state-'))
  try {
    const path = join(root, 'nested', 'state.json')
    const state = {
      ...defaultState(),
      config,
      fetchedAt: '2026-11-18T00:00:00.000Z',
      lastAttemptAt: '2026-11-18T00:00:00.000Z',
      lastSource: 'initial',
      wolframscript: '/usr/local/bin/wolframscript',
    }
    assert.equal(writeStateAtomic(path, state), true)
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).schemaVersion, 1)
    const loaded = readState(path)
    assert.deepEqual(loaded, state)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects unknown schema versions and empty records', () => {
  assert.equal(normalizeState({ schemaVersion: 2, config }), null)
  assert.equal(normalizeState({ schemaVersion: 1 }), null)
  assert.equal(normalizeState(null), null)
})

test('keeps a failed attempt without a configuration', () => {
  const state = normalizeState({
    schemaVersion: 1,
    config: null,
    lastAttemptAt: '2026-11-18T00:00:00.000Z',
    lastError: 'wolframscript not found',
  })
  assert.equal(state.config, null)
  assert.equal(state.lastError, 'wolframscript not found')
  assert.equal(state.lastAttemptAt, '2026-11-18T00:00:00.000Z')
})

test('reads a missing file as null', () => {
  assert.equal(readState(join(tmpdir(), 'dwm-state-does-not-exist', 'state.json')), null)
})
