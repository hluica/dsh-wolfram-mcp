/**
 * Persisted MCP configuration state.
 *
 * The state file records the last successful kernel document, the last attempt,
 * and the last error. It is deliberately separate from DSH configuration: it
 * belongs to this plugin and survives disable/re-enable so the kernel is not
 * queried again on every start.
 *
 * @module lib/state
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isMcpConfiguration } from './wolfram.js'

/** Current state document version. */
export const STATE_SCHEMA_VERSION = 1

/**
 * Create an empty state document.
 * @returns {Record<string, unknown>} default state.
 */
export function defaultState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    config: null,
    fetchedAt: null,
    lastAttemptAt: null,
    lastSource: null,
    lastError: null,
    wolframscript: null,
    wolframApp: null,
    mcpReadyAt: null,
  }
}

/**
 * Normalize one string-or-null field.
 * @param {unknown} value - raw value.
 * @returns {string | null} accepted string or null.
 */
function stringOrNull(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Validate a persisted state document.
 *
 * A document with no configuration and no recorded attempt is treated as
 * absent, so a truncated file causes one fresh generation rather than silent
 * inactivity.
 *
 * @param {unknown} value - parsed file value.
 * @returns {Record<string, unknown> | null} normalized state or null.
 */
export function normalizeState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.schemaVersion !== STATE_SCHEMA_VERSION) return null
  const state = defaultState()
  state.config = isMcpConfiguration(value.config) ? value.config : null
  state.fetchedAt = stringOrNull(value.fetchedAt)
  state.lastAttemptAt = stringOrNull(value.lastAttemptAt)
  state.lastSource = value.lastSource === 'initial' || value.lastSource === 'manual' ? value.lastSource : null
  state.lastError = stringOrNull(value.lastError)
  state.wolframscript = stringOrNull(value.wolframscript)
  state.wolframApp = stringOrNull(value.wolframApp)
  state.mcpReadyAt = stringOrNull(value.mcpReadyAt)
  if (state.config === null && state.lastAttemptAt === null && state.lastError === null) return null
  return state
}

/**
 * Read the persisted state file.
 * @param {string} path - state file path.
 * @returns {Record<string, unknown> | null} normalized state or null when absent/invalid.
 */
export function readState(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return normalizeState(parsed)
  } catch {
    return null
  }
}

/**
 * Write a state document atomically (same-directory temp file + rename).
 * @param {string} path - state file path.
 * @param {Record<string, unknown>} state - state document.
 * @returns {boolean} true when the file was replaced.
 */
export function writeStateAtomic(path, state) {
  /** @type {string | undefined} */
  let temporary
  try {
    mkdirSync(dirname(path), { recursive: true })
    temporary = `${path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(temporary, path)
    return true
  } catch {
    if (temporary !== undefined) {
      try {
        rmSync(temporary, { force: true })
      } catch {
        // Cleanup is best-effort.
      }
    }
    return false
  }
}
