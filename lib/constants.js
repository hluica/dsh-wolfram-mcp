/**
 * Shared constants for the Wolfram MCP plugin.
 *
 * @module lib/constants
 */

/** Stable Loader entry id; equals the bundle patch id. */
export const PLUGIN_ID = 'dsh-wolfram-mcp'

/** Plugin version written into skill ownership markers. */
export const PLUGIN_VERSION = '0.1.0'

/** Settings section id and navigation icon id. */
export const SECTION_ID = 'wolfram-mcp'

/** Owner-only HTTP API prefix shared by the Host and Client halves. */
export const API_PREFIX = '/dsh-wolfram-mcp/api'

/** Directory under `$DSH_HOME` holding the persisted state file. */
export const STATE_DIR_NAME = 'dsh-wolfram-mcp'

/** Persisted state file name. */
export const STATE_FILE_NAME = 'state.json'

/** User-global skills directory under `$DSH_HOME`. */
export const SKILLS_DIR_NAME = 'skills'

/** Marker written into every skill directory this plugin copies. */
export const SKILL_MARKER = '.dsh-wolfram-mcp.json'

/** Budget for one MCP server start, including first-run paclet/index loading. */
export const MCP_SERVER_STARTUP_TIMEOUT_MS = 600_000

/** Budget for one wolframscript generation attempt. */
export const GENERATION_TIMEOUT_MS = 150_000

/** Overall budget across the stdout, direct, and Export fallbacks. */
export const GENERATION_TOTAL_BUDGET_MS = 360_000

/** Wolfram toolset whose `JSONConfiguration` is requested. */
export const WOLFRAM_TOOLSET = 'WolframLanguage'

/**
 * Exact PacletSymbol expression from the Wolfram integration guide.
 * It yields the JSON MCP configuration for the `WolframLanguage` toolset.
 */
export const JSON_CONFIGURATION_EXPRESSION = 'PacletSymbol["Wolfram/AgentTools", "Wolfram`AgentTools`MCPServerObject"]["WolframLanguage"]["JSONConfiguration"]'
