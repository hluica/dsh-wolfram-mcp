/**
 * Wolfram kernel configuration generation and DSH registration conversion.
 *
 * The kernel's own `JSONConfiguration` output is the only source of transport
 * parameters: command, arguments, environment, and server name all come from
 * that document. This module never substitutes a hand-written command.
 *
 * @module lib/wolfram
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  GENERATION_TIMEOUT_MS,
  GENERATION_TOTAL_BUDGET_MS,
  JSON_CONFIGURATION_EXPRESSION,
  MCP_SERVER_STARTUP_TIMEOUT_MS,
} from './constants.js'

/** Server-key grammar accepted by `dsh-mcp-manager`. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Quote a string as a Wolfram Language string literal.
 * @param {string} value - raw string.
 * @returns {string} WL literal including quotes.
 */
export function toWolframString(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Build the ordered generation attempts.
 *
 * `WriteString["stdout", …]` is primary because the local WolframScript build
 * does not print a bare `-code` expression's result. The direct expression is
 * the documented command and the `Export` form sidesteps stdout entirely.
 *
 * @param {{ tempFile: string }} options - scratch path for the Export fallback.
 * @returns {Array<{ kind: 'write-string' | 'direct' | 'export', code: string }>} attempts.
 */
export function buildGenerationCommands({ tempFile }) {
  return [
    { kind: 'write-string', code: `WriteString["stdout", ${JSON_CONFIGURATION_EXPRESSION}]` },
    { kind: 'direct', code: JSON_CONFIGURATION_EXPRESSION },
    { kind: 'export', code: `Export[${toWolframString(tempFile)}, ${JSON_CONFIGURATION_EXPRESSION}, "Text"]` },
  ]
}

/**
 * Validate the parsed document shape.
 * @param {unknown} value - parsed JSON value.
 * @returns {boolean} true for an object carrying an `mcpServers` object.
 */
export function isMcpConfiguration(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.mcpServers !== null
    && typeof value.mcpServers === 'object'
    && !Array.isArray(value.mcpServers)
}

/**
 * Parse the kernel's MCP configuration output.
 *
 * Tolerates leading/trailing kernel progress noise and a quoted JSON string
 * (the Wolfram `InputForm` of a string result).
 *
 * @param {string} text - stdout or exported file content.
 * @returns {{ mcpServers: Record<string, unknown> }} parsed configuration.
 * @throws {Error} when no usable `mcpServers` document is found.
 */
export function parseGeneratedConfiguration(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Wolfram kernel returned no output')
  }
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  const candidates = [trimmed]
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  }
  for (const candidate of candidates) {
    let value
    try {
      value = JSON.parse(candidate)
    } catch {
      continue
    }
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value)
      } catch {
        continue
      }
    }
    if (isMcpConfiguration(value)) return value
  }
  throw new Error('Wolfram output is not a JSON MCP configuration with an "mcpServers" object')
}

/**
 * Convert one Wolfram `mcpServers` entry to a `mcpManager` registration.
 * @param {unknown} raw - one entry from the generated document.
 * @returns {Record<string, unknown> | undefined} DSH entry, or undefined.
 */
function toRegistration(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = /** @type {Record<string, unknown>} */ (raw)
  const declared = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  const inferred = typeof record.command === 'string' ? 'stdio' : typeof record.url === 'string' ? 'streamable-http' : ''
  const transport = declared === '' ? inferred : declared
  if (transport === 'stdio') {
    if (typeof record.command !== 'string' || record.command.trim() === '') return undefined
    const args = Array.isArray(record.args)
      ? record.args.filter((arg) => typeof arg === 'string')
      : []
    const env = {}
    if (record.env !== null && typeof record.env === 'object' && !Array.isArray(record.env)) {
      for (const [key, value] of Object.entries(record.env)) {
        if (typeof value === 'string') env[key] = value
      }
    }
    const entry = {
      transport: 'stdio',
      command: record.command,
      args,
      env,
      startupTimeoutMs: MCP_SERVER_STARTUP_TIMEOUT_MS,
    }
    if (typeof record.cwd === 'string' && record.cwd !== '') entry.cwd = record.cwd
    return entry
  }
  if (transport === 'streamable-http' || transport === 'streamablehttp' || transport === 'http') {
    if (typeof record.url !== 'string' || record.url.trim() === '') return undefined
    const headers = {}
    if (record.headers !== null && typeof record.headers === 'object' && !Array.isArray(record.headers)) {
      for (const [key, value] of Object.entries(record.headers)) {
        if (typeof value === 'string') headers[key] = value
      }
    }
    return {
      transport: 'streamable-http',
      url: record.url,
      headers,
      startupTimeoutMs: MCP_SERVER_STARTUP_TIMEOUT_MS,
    }
  }
  return undefined
}

/**
 * Convert a generated document into server-name/entry pairs plus diagnostics.
 * @param {{ mcpServers: Record<string, unknown> }} config - generated document.
 * @returns {{ entries: Array<{ name: string, entry: Record<string, unknown> }>, errors: string[] }} conversion result.
 */
export function convertWolframConfiguration(config) {
  /** @type {Array<{ name: string, entry: Record<string, unknown> }>} */
  const entries = []
  /** @type {string[]} */
  const errors = []
  if (!isMcpConfiguration(config)) {
    return { entries, errors: ['configuration has no "mcpServers" object'] }
  }
  for (const [name, raw] of Object.entries(config.mcpServers)) {
    if (!SERVER_NAME_PATTERN.test(name)) {
      errors.push(`server name "${name}" does not match ${String(SERVER_NAME_PATTERN)}`)
      continue
    }
    const entry = toRegistration(raw)
    if (entry === undefined) {
      errors.push(`server "${name}" is not a supported stdio or streamable-http entry`)
      continue
    }
    entries.push({ name, entry })
  }
  return { entries, errors }
}

/**
 * Stable JSON comparison that ignores object key order.
 * @param {unknown} left - first value.
 * @param {unknown} right - second value.
 * @returns {boolean} true when both serialize identically after key sorting.
 */
export function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

/**
 * Recursively sort object keys for stable comparison.
 * @param {unknown} value - JSON value.
 * @returns {unknown} canonical value.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map((item) => canonical(item))
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key])
    return out
  }
  return value
}

/**
 * Create an AbortError-compatible error.
 * @returns {Error} error carrying `name: 'AbortError'`.
 */
function abortError() {
  const error = new Error('Wolfram kernel generation was aborted')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

/**
 * Run one `wolframscript -code` process with a hard timeout and process-group kill.
 *
 * The kernel is started as its own process group so a timed-out wrapper cannot
 * leave a kernel child behind.
 *
 * @param {string} wolframscript - executable path.
 * @param {string} code - WL expression.
 * @param {{ timeoutMs: number, signal?: AbortSignal, maxBuffer?: number }} options - limits.
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }>} process result.
 */
export function runWolframscript(wolframscript, code, { timeoutMs, signal, maxBuffer = 1024 * 1024 }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    let child
    try {
      child = spawn(wolframscript, ['-code', code], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    /** @type {NodeJS.Timeout | undefined} */
    let timer

    /**
     * Complete the promise exactly once.
     * @param {Error | null} error - failure, if any.
     * @param {{ code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }} [result] - process result.
     */
    const finish = (error, result) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error !== null) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve(result)
    }

    /** Kill the wrapper and any kernel in its process group. */
    const kill = () => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // The process may already have exited.
        }
      }
    }

    const onAbort = () => {
      kill()
      finish(abortError())
    }

    timer = setTimeout(() => {
      kill()
      const error = new Error(`wolframscript timed out after ${timeoutMs}ms`)
      error.code = 'ETIMEDOUT'
      finish(error)
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
      if (stdout.length > maxBuffer) {
        kill()
        finish(new Error('wolframscript stdout exceeded the buffer limit'))
      }
    })
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-maxBuffer)
    })
    child.on('error', (error) => finish(error))
    child.on('close', (exitCode, exitSignal) => {
      finish(null, { code: exitCode, signal: exitSignal, stdout, stderr })
    })
  })
}

/**
 * Run the generation attempts until one yields a usable configuration.
 *
 * @param {{ wolframscript: string, signal?: AbortSignal, timeoutMs?: number, totalBudgetMs?: number, tempDir?: string }} options
 *   executable, cancellation, and budgets.
 * @returns {Promise<{ config: { mcpServers: Record<string, unknown> }, raw: string, command: string, wolframscript: string }>} generated document.
 */
export async function generateWolframConfiguration({
  wolframscript,
  signal,
  timeoutMs = GENERATION_TIMEOUT_MS,
  totalBudgetMs = GENERATION_TOTAL_BUDGET_MS,
  tempDir = tmpdir(),
}) {
  if (typeof wolframscript !== 'string' || wolframscript === '') {
    throw new Error('wolframscript was not found')
  }
  if (signal?.aborted) throw abortError()
  const deadline = Date.now() + totalBudgetMs
  const tempFile = join(tempDir, `dsh-wolfram-mcp-${process.pid}-${Date.now()}.json`)
  /** @type {string[]} */
  const failures = []
  try {
    for (const command of buildGenerationCommands({ tempFile })) {
      if (signal?.aborted) throw abortError()
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      const attemptTimeout = Math.min(timeoutMs, remaining)
      if (attemptTimeout <= 0) break
      try {
        const result = await runWolframscript(wolframscript, command.code, { timeoutMs: attemptTimeout, signal })
        const raw = command.kind === 'export'
          ? (existsSync(tempFile) ? readFileSync(tempFile, 'utf8') : '')
          : result.stdout
        if (typeof raw !== 'string' || raw.trim() === '') {
          failures.push(`${command.kind}: no output`)
          continue
        }
        try {
          const config = parseGeneratedConfiguration(raw)
          return { config, raw, command: command.kind, wolframscript }
        } catch (error) {
          failures.push(`${command.kind}: ${String(error?.message ?? error)}`)
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        const message = String(error?.message ?? error)
        failures.push(`${command.kind}: ${message.length > 300 ? `${message.slice(0, 300)}…` : message}`)
      }
    }
    const detail = failures.length === 0 ? '' : ` (${failures.join('; ')})`
    throw new Error(`Wolfram kernel did not return a usable MCP configuration${detail}`)
  } finally {
    try {
      rmSync(tempFile, { force: true })
    } catch {
      // Scratch cleanup is best-effort.
    }
  }
}
