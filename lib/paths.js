/**
 * DSH home and plugin-owned path resolution.
 *
 * Mirrors `@deepseek-ai/dsh-home-paths` precedence: `$DSH_HOME` (trimmed, blank
 * treated as unset) wins over `~/.dsh`, and a leading `~` is expanded.
 *
 * @module lib/paths
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { SKILLS_DIR_NAME, STATE_DIR_NAME, STATE_FILE_NAME } from './constants.js'

/** Environment variable naming the DSH config root. */
export const DSH_HOME_ENV = 'DSH_HOME'

/**
 * Expand a leading `~` and resolve a path.
 * @param {string} value - raw path.
 * @returns {string} absolute path.
 */
function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return resolve(value)
}

/**
 * Resolve the DSH config root.
 * @param {Record<string, string | undefined>} env - environment mapping.
 * @returns {string} absolute DSH home.
 */
export function resolveDshHome(env = process.env) {
  const raw = typeof env?.[DSH_HOME_ENV] === 'string' ? env[DSH_HOME_ENV].trim() : ''
  return raw === '' ? join(homedir(), '.dsh') : expandHome(raw)
}

/**
 * Plugin-owned state directory (`$DSH_HOME/dsh-wolfram-mcp`).
 * @param {Record<string, string | undefined>} env - environment mapping.
 * @returns {string} absolute directory.
 */
export function resolveStateDir(env = process.env) {
  return join(resolveDshHome(env), STATE_DIR_NAME)
}

/**
 * Persisted MCP configuration path.
 * @param {Record<string, string | undefined>} env - environment mapping.
 * @returns {string} absolute file path.
 */
export function resolveStatePath(env = process.env) {
  return join(resolveStateDir(env), STATE_FILE_NAME)
}

/**
 * User-global skills root (`$DSH_HOME/skills`).
 * @param {Record<string, string | undefined>} env - environment mapping.
 * @returns {string} absolute directory.
 */
export function resolveSkillsRoot(env = process.env) {
  return join(resolveDshHome(env), SKILLS_DIR_NAME)
}
