/**
 * Host half of the Wolfram MCP plugin.
 *
 * On activation the runtime copies the bundled Wolfram agent skills, registers
 * MCP servers from the persisted kernel-generated configuration (or performs
 * the one initial fetch when no state exists), and serves the owner-only
 * settings API. On disposal it removes only its own registrations and skill
 * copies; the persisted configuration intentionally survives.
 *
 * @module @local/dsh-wolfram-mcp
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_PREFIX, PLUGIN_ID } from './lib/constants.js'
import { WolframMcpRuntime } from './lib/runtime.js'

/** Stable Loader entry id; equals the bundle patch id. */
export { PLUGIN_ID }

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-wolfram-mcp'

/** Host services required before activation. */
export const inject = ['mcpManager', 'webServer', 'connection']

const pluginDirectory = dirname(fileURLToPath(import.meta.url))

/**
 * Mount the plugin.
 * @param {object} ctx - Cordis Host context.
 * @returns {void}
 */
export function apply(ctx) {
  const runtime = new WolframMcpRuntime(ctx, {
    skillsSource: join(pluginDirectory, 'src', 'Skills'),
  })

  // The route owns no state of its own; unloading the plugin removes it.
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (req, res) => runtime.handleRequest(req, res),
  }), 'wolfram-mcp: settings api')

  ctx.effect(() => {
    runtime.start()
    return () => runtime.dispose()
  }, 'wolfram-mcp: lifecycle')
}
