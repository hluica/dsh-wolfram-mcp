/**
 * Host runtime: persisted state, MCP registration, Wolfram discovery/generation,
 * skill copying, and the owner-only settings API.
 *
 * @module lib/runtime
 */
import { randomUUID } from 'node:crypto'
import { API_PREFIX, PLUGIN_VERSION } from './constants.js'
import { commandExists, findWolframInstallation } from './detect.js'
import { admitOwner, apiPath, sendJson } from './http.js'
import { resolveSkillsRoot, resolveStatePath } from './paths.js'
import { installSkills, removeSkills } from './skills.js'
import { defaultState, readState, writeStateAtomic } from './state.js'
import { convertWolframConfiguration, generateWolframConfiguration, sameJson } from './wolfram.js'

/**
 * One plugin activation's runtime state.
 */
export class WolframMcpRuntime {
  /**
   * @param {object} ctx - Cordis Host context with `mcpManager`, `webServer`,
   *   `connection`, and `logger`.
   * @param {{ env?: Record<string, string | undefined>, statePath?: string, skillsRoot?: string, skillsSource?: string, state?: Record<string, unknown> | null }} [options]
   *   test seams and resolved paths.
   */
  constructor(ctx, { env = process.env, statePath, skillsRoot, skillsSource, state } = {}) {
    this.ctx = ctx
    this.env = env
    this.statePath = statePath ?? resolveStatePath(env)
    this.skillsRoot = skillsRoot ?? resolveSkillsRoot(env)
    this.skillsSource = skillsSource
    const loaded = state !== undefined ? state : readState(this.statePath)
    this.state = loaded ?? defaultState()
    this.persisted = state !== undefined ? state !== null : loaded !== null
    this.disposed = false
    this.refreshing = false
    /** @type {Promise<Record<string, unknown>> | null} */
    this.refreshPromise = null
    /** @type {Map<string, () => void>} */
    this.registrations = new Map()
    /** @type {Record<string, unknown> | null} */
    this.appliedConfig = null
    /** @type {string[]} */
    this.registrationErrors = []
    /** @type {string | null} */
    this.lastRegisteredAt = null
    this.skills = { root: this.skillsRoot, installed: [], skipped: [], error: null }
    this.abort = new AbortController()
  }

  /**
   * Best-effort logger.
   * @param {'debug' | 'info' | 'warn' | 'error'} level - logger level.
   * @param {string} message - message.
   */
  log(level, message) {
    try {
      this.ctx.logger?.[level]?.(message)
    } catch {
      // Logging must never affect lifecycle.
    }
  }

  /**
   * Copy bundled skills and either register the persisted configuration or
   * perform the one initial fetch.
   */
  start() {
    this.copySkills()
    if (this.state.config !== null) {
      this.applyConfig(this.state.config)
      if (this.registrations.size > 0) {
        this.log('info', `dsh-wolfram-mcp: registered ${this.registrations.size} MCP server(s) from ${this.statePath}`)
      } else if (this.registrationErrors.length > 0) {
        this.log('warn', `dsh-wolfram-mcp: persisted configuration could not be registered: ${this.registrationErrors.join('; ')}`)
      }
      return
    }
    if (this.state.lastAttemptAt !== null && this.state.lastError !== null) {
      this.log('warn', `dsh-wolfram-mcp: the last configuration fetch failed; use Settings → Wolfram MCP to retry: ${this.state.lastError}`)
      return
    }
    void this.refresh('initial').catch((error) => {
      this.log('warn', `dsh-wolfram-mcp: initial configuration fetch failed: ${String(error?.message ?? error)}`)
    })
  }

  /**
   * Copy the bundled skills and record their ownership token.
   */
  copySkills() {
    const token = randomUUID()
    const result = installSkills({
      sourceDir: this.skillsSource,
      targetRoot: this.skillsRoot,
      token,
      logger: this.ctx.logger,
    })
    this.skills = result
    if (result.installed.length > 0) {
      this.log('info', `dsh-wolfram-mcp: copied ${result.installed.length} skill(s) to ${this.skillsRoot}`)
    }
    if (result.error !== null) {
      this.log('debug', `dsh-wolfram-mcp: skill copy skipped: ${result.error}`)
    }
  }

  /**
   * Split converted entries into registrable ones and command diagnostics.
   * @param {Array<{ name: string, entry: Record<string, unknown> }>} entries - converted entries.
   * @returns {{ registrable: Array<{ name: string, entry: Record<string, unknown> }>, errors: string[] }} split result.
   */
  partitionEntries(entries) {
    /** @type {Array<{ name: string, entry: Record<string, unknown> }>} */
    const registrable = []
    /** @type {string[]} */
    const errors = []
    for (const item of entries) {
      if (item.entry.transport === 'stdio' && !commandExists(/** @type {string} */ (item.entry.command))) {
        errors.push(`server "${item.name}": command not found or not executable: ${String(item.entry.command)}`)
        continue
      }
      registrable.push(item)
    }
    return { registrable, errors }
  }

  /**
   * Register one generated configuration.
   *
   * A configuration with no usable server leaves existing registrations in
   * place; a manual refresh keeps the last working server rather than dropping
   * it for a broken newer document.
   *
   * @param {Record<string, unknown>} config - generated document.
   * @param {{ force?: boolean }} [options] - force re-registration.
   */
  applyConfig(config, { force = false } = {}) {
    if (this.disposed) return
    const converted = convertWolframConfiguration(config)
    const { registrable, errors } = this.partitionEntries(converted.entries)
    const diagnostics = [...converted.errors, ...errors]
    if (registrable.length === 0) {
      this.registrationErrors = diagnostics.length > 0 ? diagnostics : ['configuration contains no registerable MCP servers']
      return
    }
    if (!force && this.appliedConfig !== null && sameJson(config, this.appliedConfig) && this.registrations.size > 0) {
      this.registrationErrors = diagnostics
      return
    }
    this.disposeRegistrations()
    for (const { name, entry } of registrable) {
      try {
        const dispose = this.ctx.mcpManager.register(name, entry)
        this.registrations.set(name, dispose)
      } catch (error) {
        diagnostics.push(`server "${name}": ${String(error?.message ?? error)}`)
      }
    }
    this.appliedConfig = config
    this.registrationErrors = diagnostics
    this.lastRegisteredAt = new Date().toISOString()
  }

  /**
   * Dispose every registration this runtime owns.
   */
  disposeRegistrations() {
    for (const dispose of this.registrations.values()) {
      try {
        dispose()
      } catch {
        // The manager may already be disposed.
      }
    }
    this.registrations.clear()
    this.appliedConfig = null
    this.lastRegisteredAt = null
  }

  /**
   * Fetch a fresh configuration. Concurrent callers share one operation.
   * @param {'initial' | 'manual'} source - why the fetch started.
   * @returns {Promise<Record<string, unknown>>} client-safe snapshot.
   */
  refresh(source = 'manual') {
    if (this.refreshPromise !== null) return this.refreshPromise
    this.refreshing = true
    const operation = this.performRefresh(source)
    this.refreshPromise = operation.finally(() => {
      this.refreshing = false
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  /**
   * Run one generation, persist the result, and re-register when needed.
   * @param {'initial' | 'manual'} source - fetch trigger.
   * @returns {Promise<Record<string, unknown>>} snapshot after the attempt.
   */
  async performRefresh(source) {
    const attemptAt = new Date().toISOString()
    this.state.lastAttemptAt = attemptAt
    this.state.lastSource = source
    this.state.lastError = null
    const installation = findWolframInstallation({ env: this.env })
    this.state.wolframscript = installation.wolframscript ?? null
    this.state.wolframApp = installation.app?.appPath ?? null
    if (installation.wolframscript === undefined) {
      this.state.lastError = '未找到可执行的 wolframscript'
      this.persist()
      return this.snapshot()
    }
    try {
      const generated = await generateWolframConfiguration({
        wolframscript: installation.wolframscript,
        signal: this.abort.signal,
      })
      if (this.abort.signal.aborted || this.disposed) return this.snapshot()
      const converted = convertWolframConfiguration(generated.config)
      const { registrable, errors } = this.partitionEntries(converted.entries)
      const diagnostics = [...converted.errors, ...errors]
      if (registrable.length === 0) {
        this.state.lastError = diagnostics.length > 0 ? diagnostics.join('; ') : '生成的配置中没有可注册的 MCP 服务器'
        this.persist()
        return this.snapshot()
      }
      const changed = this.state.config === null || !sameJson(generated.config, this.state.config)
      const force = changed || this.registrationErrors.length > 0
      this.state.config = generated.config
      this.state.fetchedAt = new Date().toISOString()
      this.state.lastSource = source
      this.state.lastError = diagnostics.length > 0 ? diagnostics.join('; ') : null
      this.state.wolframscript = generated.wolframscript ?? installation.wolframscript
      this.state.wolframApp = installation.app?.appPath ?? null
      this.persist()
      if (!this.disposed) this.applyConfig(generated.config, { force })
      return this.snapshot()
    } catch (error) {
      if (error?.name === 'AbortError' || this.abort.signal.aborted) return this.snapshot()
      this.state.lastError = String(error?.message ?? error)
      this.persist()
      return this.snapshot()
    }
  }

  /**
   * Persist the current state.
   * @returns {boolean} true when the file was replaced.
   */
  persist() {
    const ok = writeStateAtomic(this.statePath, this.state)
    this.persisted = ok
    if (!ok) this.log('warn', `dsh-wolfram-mcp: could not persist state to ${this.statePath}`)
    return ok
  }

  /**
   * Build the client-visible snapshot.
   * @returns {Record<string, unknown>} JSON-safe state.
   */
  snapshot() {
    /** @type {Array<{ name: string, status: unknown }>} */
    let mcpServers = []
    try {
      const names = new Set(this.registrations.keys())
      mcpServers = this.ctx.mcpManager
        .list()
        .filter((server) => names.has(server.name))
        .map((server) => ({ name: server.name, status: server.status }))
    } catch {
      // A disposed manager has no live statuses.
    }
    return {
      schemaVersion: 1,
      version: PLUGIN_VERSION,
      config: this.state.config,
      fetchedAt: this.state.fetchedAt,
      lastAttemptAt: this.state.lastAttemptAt,
      lastSource: this.state.lastSource,
      lastError: this.state.lastError,
      wolframscript: this.state.wolframscript,
      wolframApp: this.state.wolframApp,
      refreshing: this.refreshing,
      persisted: this.persisted,
      statePath: this.statePath,
      skills: {
        root: this.skills.root,
        installed: this.skills.installed.map((item) => item.name),
        skipped: this.skills.skipped,
        error: this.skills.error,
      },
      registrationErrors: this.registrationErrors,
      mcpServers,
      lastRegisteredAt: this.lastRegisteredAt,
    }
  }

  /**
   * Handle one owner-only API request.
   * @param {import('node:http').IncomingMessage} req - request.
   * @param {import('node:http').ServerResponse} res - response.
   * @returns {Promise<void>} completion.
   */
  async handleRequest(req, res) {
    if (this.disposed) {
      sendJson(res, 503, { ok: false, error: 'plugin is unloading' })
      return
    }
    const admission = admitOwner(this.ctx, req)
    if (admission.ok !== true) {
      sendJson(res, admission.status, { ok: false, error: admission.status === 401 ? 'unauthorized' : 'forbidden' })
      return
    }
    try {
      const path = apiPath(req, API_PREFIX)
      if (req.method === 'GET' && path === '/state') {
        sendJson(res, 200, { ok: true, result: this.snapshot() })
        return
      }
      if (req.method === 'POST' && path === '/refresh') {
        await this.refresh('manual')
        sendJson(res, 200, { ok: true, result: this.snapshot() })
        return
      }
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
    }
  }

  /**
   * Abort generation, unregister MCP servers, and remove this activation's
   * skill copies. The persisted state intentionally survives.
   */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.abort.abort()
    this.disposeRegistrations()
    const removed = removeSkills({ installed: this.skills.installed, logger: this.ctx.logger })
    if (removed > 0) this.log('info', `dsh-wolfram-mcp: removed ${removed} skill copy/copies`)
    this.skills = { ...this.skills, installed: [] }
  }
}
