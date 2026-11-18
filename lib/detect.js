/**
 * Local Wolfram installation discovery.
 *
 * The generated configuration carries an absolute kernel command, but finding
 * `wolframscript` first avoids spawning a kernel when Wolfram is not installed.
 * App-bundle discovery is best-effort status information; the command path in
 * the generated JSON remains the authority for whether the server can start.
 *
 * @module lib/detect
 */
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

/** Common `wolframscript` locations checked after PATH. */
export const DEFAULT_WOLFRAMSCRIPT_CANDIDATES = [
  '/usr/local/bin/wolframscript',
  '/opt/homebrew/bin/wolframscript',
  '/usr/bin/wolframscript',
  '/Applications/Wolfram.app/Contents/MacOS/wolframscript',
  '/Applications/WolframScript.app/Contents/MacOS/wolframscript',
  '/Applications/Mathematica.app/Contents/MacOS/wolframscript',
  '/Applications/Wolfram Engine.app/Contents/MacOS/wolframscript',
]

/** Default macOS app directories. */
export const DEFAULT_APP_DIRS = ['/Applications', join(homedir(), 'Applications')]

/**
 * Whether a path is an existing executable file.
 * @param {string} path - candidate path.
 * @returns {boolean} true when it can be executed.
 */
export function isExecutableFile(path) {
  if (typeof path !== 'string' || path === '') return false
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a path is an existing directory.
 * @param {string} path - candidate path.
 * @returns {boolean} true for a directory.
 */
export function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Read PATH from an environment mapping, accepting Windows casing.
 * @param {Record<string, string | undefined>} env - environment mapping.
 * @returns {string[]} non-empty PATH entries.
 */
function pathEntries(env) {
  const raw = env?.PATH ?? env?.Path ?? env?.path ?? ''
  return String(raw).split(delimiter).filter((entry) => entry !== '')
}

/**
 * Find an executable `wolframscript`.
 * @param {{ env?: Record<string, string | undefined>, candidates?: string[] }} [options]
 *   environment and absolute candidates to consider.
 * @returns {string | undefined} resolved executable path.
 */
export function findWolframScript({ env = process.env, candidates = DEFAULT_WOLFRAMSCRIPT_CANDIDATES } = {}) {
  const names = process.platform === 'win32' ? ['wolframscript.exe', 'wolframscript'] : ['wolframscript']
  for (const directory of pathEntries(env)) {
    for (const name of names) {
      const candidate = join(directory, name)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) return candidate
  }
  return undefined
}

/**
 * Rank app bundles so a full Wolfram/Mathematica installation wins over helpers.
 * @param {string} name - app bundle name.
 * @returns {number} sort rank.
 */
function appRank(name) {
  if (name === 'Wolfram.app') return 0
  if (name === 'Mathematica.app') return 1
  if (name === 'Wolfram Engine.app') return 2
  return 3
}

/**
 * Find a local Wolfram app bundle and its kernel command.
 * @param {{ appDirs?: string[] }} [options] - app directories to scan.
 * @returns {{ appPath: string, command: string } | undefined} first usable app.
 */
export function findWolframApp({ appDirs = DEFAULT_APP_DIRS } = {}) {
  /** @type {Array<{ appPath: string, command: string, rank: number }>} */
  const found = []
  for (const directory of appDirs) {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.toLowerCase().endsWith('.app')) continue
      const appPath = join(directory, entry.name)
      const macos = join(appPath, 'Contents', 'MacOS')
      for (const binary of ['wolfram', 'WolframKernel']) {
        const command = join(macos, binary)
        if (isExecutableFile(command)) {
          found.push({ appPath, command, rank: appRank(entry.name) })
          break
        }
      }
    }
  }
  found.sort((left, right) => left.rank - right.rank || left.appPath.localeCompare(right.appPath))
  const best = found[0]
  return best === undefined ? undefined : { appPath: best.appPath, command: best.command }
}

/**
 * Find both the script runner and an app bundle.
 * @param {{ env?: Record<string, string | undefined>, appDirs?: string[], wolframscriptCandidates?: string[] }} [options]
 *   discovery inputs.
 * @returns {{ wolframscript: string | undefined, app: { appPath: string, command: string } | undefined }} installation facts.
 */
export function findWolframInstallation({ env = process.env, appDirs = DEFAULT_APP_DIRS, wolframscriptCandidates = DEFAULT_WOLFRAMSCRIPT_CANDIDATES } = {}) {
  return {
    wolframscript: findWolframScript({ env, candidates: wolframscriptCandidates }),
    app: findWolframApp({ appDirs }),
  }
}

/**
 * Resolve a command to an executable file, searching PATH for a bare name.
 * @param {string} command - command or absolute path.
 * @returns {string | undefined} resolved executable path.
 */
export function resolveCommand(command) {
  if (typeof command !== 'string' || command === '') return undefined
  if (isAbsolute(command)) return isExecutableFile(command) ? command : undefined
  const names = process.platform === 'win32' ? [command, `${command}.exe`] : [command]
  for (const directory of pathEntries(process.env)) {
    for (const name of names) {
      const candidate = join(directory, name)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Whether a command names an executable that exists.
 * @param {string} command - command or absolute path.
 * @returns {boolean} true when it can be executed.
 */
export function commandExists(command) {
  return resolveCommand(command) !== undefined
}

/**
 * Whether a path exists at all (used only for status messages).
 * @param {string} path - candidate path.
 * @returns {boolean} existence.
 */
export function pathExists(path) {
  return typeof path === 'string' && path !== '' && existsSync(path)
}
