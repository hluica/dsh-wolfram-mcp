/**
 * Copy the bundled Wolfram agent skills into the user-global skills root and
 * remove only the copies this plugin owns.
 *
 * Ownership is recorded per skill directory in a hidden marker carrying this
 * activation's token. An existing directory without our marker belongs to the
 * user or another tool and is never overwritten or removed. Filesystem failures
 * are swallowed: an unwritable global skills root must not break MCP
 * registration.
 *
 * @module lib/skills
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PLUGIN_ID, PLUGIN_VERSION, SKILL_MARKER } from './constants.js'

/**
 * Read this plugin's marker from one skill directory.
 * @param {string} directory - skill directory.
 * @returns {{ plugin?: string, version?: string, token?: string } | null} marker or null.
 */
export function readMarker(directory) {
  try {
    const value = JSON.parse(readFileSync(join(directory, SKILL_MARKER), 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/**
 * List direct child skill directories (only bundles with a `SKILL.md`).
 * @param {string} sourceDir - bundled skills directory.
 * @returns {string[]} skill directory names.
 */
export function listSkillDirectories(sourceDir) {
  /** @type {string[]} */
  const names = []
  let entries
  try {
    entries = readdirSync(sourceDir, { withFileTypes: true })
  } catch {
    return names
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      if (statSync(join(sourceDir, entry.name, 'SKILL.md')).isFile()) names.push(entry.name)
    } catch {
      // Not a skill bundle.
    }
  }
  return names.sort()
}

/**
 * Copy every bundled skill into the global skills root.
 *
 * @param {{ sourceDir: string, targetRoot: string, token: string, logger?: { warn?: Function, debug?: Function } }} options
 *   source root, destination root, and this activation's ownership token.
 * @returns {{ root: string, installed: Array<{ name: string, target: string, token: string }>, skipped: Array<Record<string, unknown>>, error: string | null }}
 *   copy result; `error` is set only when the root itself cannot be prepared.
 */
export function installSkills({ sourceDir, targetRoot, token, logger } = {}) {
  const result = {
    root: targetRoot ?? '',
    installed: [],
    skipped: [],
    error: null,
  }
  if (typeof sourceDir !== 'string' || typeof targetRoot !== 'string' || typeof token !== 'string' || token === '') {
    result.error = 'installSkills requires sourceDir, targetRoot, and token'
    return result
  }
  try {
    if (!existsSync(sourceDir)) {
      result.error = `bundled skills directory not found: ${sourceDir}`
      return result
    }
    mkdirSync(targetRoot, { recursive: true })
  } catch (error) {
    result.error = String(error?.message ?? error)
    try {
      logger?.debug?.(`dsh-wolfram-mcp: global skills directory is not writable: ${String(error?.message ?? error)}`)
    } catch {
      // Logging is best-effort.
    }
    return result
  }

  for (const name of listSkillDirectories(sourceDir)) {
    const source = join(sourceDir, name)
    const target = join(targetRoot, name)
    try {
      if (existsSync(target)) {
        const marker = readMarker(target)
        if (marker?.plugin !== PLUGIN_ID) {
          result.skipped.push({ name, reason: 'occupied' })
          try {
            logger?.warn?.(`dsh-wolfram-mcp: skill "${name}" already exists and is not owned by this plugin; left untouched`)
          } catch {
            // Logging is best-effort.
          }
          continue
        }
        rmSync(target, { recursive: true, force: true })
      }
      cpSync(source, target, {
        recursive: true,
        force: true,
        filter: (sourcePath) => basename(sourcePath) !== '.DS_Store' && basename(sourcePath) !== SKILL_MARKER,
      })
      writeFileSync(
        join(target, SKILL_MARKER),
        `${JSON.stringify({ plugin: PLUGIN_ID, version: PLUGIN_VERSION, token }, null, 2)}\n`,
        'utf8',
      )
      result.installed.push({ name, target, token })
    } catch (error) {
      result.skipped.push({ name, reason: 'copy-failed', error: String(error?.message ?? error) })
      try {
        logger?.debug?.(`dsh-wolfram-mcp: could not copy skill "${name}": ${String(error?.message ?? error)}`)
      } catch {
        // Logging is best-effort.
      }
    }
  }
  return result
}

/**
 * Remove only the skill copies owned by one activation token.
 *
 * @param {{ installed: Array<{ name?: string, target: string, token: string }>, logger?: { debug?: Function } }} options
 *   copies returned by {@link installSkills}.
 * @returns {number} number of directories removed.
 */
export function removeSkills({ installed, logger } = {}) {
  let removed = 0
  if (!Array.isArray(installed)) return removed
  for (const item of installed) {
    if (item === null || typeof item !== 'object' || typeof item.target !== 'string' || typeof item.token !== 'string') continue
    try {
      const marker = readMarker(item.target)
      if (marker?.plugin !== PLUGIN_ID || marker?.token !== item.token) continue
      rmSync(item.target, { recursive: true, force: true })
      removed += 1
    } catch (error) {
      try {
        logger?.debug?.(`dsh-wolfram-mcp: could not remove skill "${String(item.name ?? item.target)}": ${String(error?.message ?? error)}`)
      } catch {
        // Logging is best-effort.
      }
    }
  }
  return removed
}
