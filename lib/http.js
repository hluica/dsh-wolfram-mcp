/**
 * Small owner-only JSON API helpers for the Web server route.
 *
 * @module lib/http
 */

/**
 * Send one JSON response without throwing into the route handler.
 * @param {import('node:http').ServerResponse} res - response object.
 * @param {number} status - HTTP status.
 * @param {unknown} payload - JSON-serializable payload.
 * @returns {void}
 */
export function sendJson(res, status, payload) {
  try {
    res.statusCode = status
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8')
    res.setHeader?.('Cache-Control', 'no-store')
    res.end?.(JSON.stringify(payload))
  } catch {
    // A disconnected browser must not affect plugin lifecycle.
  }
}

/**
 * Admit only the owner principal for this route.
 * @param {{ connection: { admit: (req: unknown) => unknown } }} ctx - Host context.
 * @param {unknown} req - Node request.
 * @returns {{ ok: true } | { ok: false, status: 401 | 403 }} admission result.
 */
export function admitOwner(ctx, req) {
  try {
    const admission = ctx.connection.admit(req)
    if (admission !== null && typeof admission === 'object' && 'rejection' in admission) {
      return { ok: false, status: admission.rejection === 401 ? 401 : 403 }
    }
    if (admission?.peer?.principal?.kind !== 'owner') return { ok: false, status: 403 }
    return { ok: true }
  } catch {
    return { ok: false, status: 401 }
  }
}

/**
 * Parse the path under the API prefix.
 * @param {{ url?: string }} req - Node request.
 * @param {string} prefix - absolute API prefix.
 * @returns {string} path beginning with `/`, or `/` for a mismatch.
 */
export function apiPath(req, prefix) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(prefix)) return '/'
    return url.pathname.slice(prefix.length) || '/'
  } catch {
    return '/'
  }
}
