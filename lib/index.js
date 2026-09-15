// dsh-almazom-approve-escalate — host face.
//
// Serves the plugin's own config (target preset + button label) to the browser
// half at a fixed same-origin path, so no tunable is hardcoded in the bundle.
// No secrets: the payload mirrors the public patch-row config.
//
// Bundle-family plugin shape: `inject` lists services required before apply()
// runs; `apply(ctx, config)` receives the patch-row config as its second
// argument.

/** @param {unknown} value */
const nonEmptyString = value => typeof value === 'string' && value.length > 0

/** Services this plugin requires before apply runs. */
export const inject = ['webServer']

/**
 * Mount the plugin onto the host cordis context.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {unknown} rawConfig - untrusted configuration from the cordis entry.
 * @returns {() => void} disposer releasing the route seat.
 */
export function apply(ctx, rawConfig) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}
  // Operator order 2026-09-15: fallback stays the YOLO mode even without
  // patch config — the button must never downgrade to a weaker preset.
  const body = JSON.stringify({
    preset: nonEmptyString(config.preset) ? config.preset : 'danger-full-access',
    label: nonEmptyString(config.label) ? config.label : 'Approve & full access',
  })
  const disposeRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/almazom-approve-escalate/config.json',
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(body)
    },
  })
  return disposeRoute
}
