// dsh-almazom-approve-escalate — host face.
//
// Serves the plugin's own config (target preset + button label) to the browser
// half at a fixed same-origin path, so no tunable is hardcoded in the bundle.
// No secrets: the payload mirrors the public patch-row config.

/** @param {string} value */
const nonEmptyString = value => typeof value === 'string' && value.length > 0

/**
 * Host plugin apply. Registers one exact WebRoute serving the config document.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context with
 * the webserver service and the plugin's patch-row config.
 * @returns {() => void} disposer releasing the route seat.
 */
export function apply(ctx) {
  const config = ctx.config && typeof ctx.config === 'object' ? ctx.config : {}
  const body = JSON.stringify({
    preset: nonEmptyString(config.preset) ? config.preset : 'workspace-write',
    label: nonEmptyString(config.label) ? config.label : 'Approve & escalate',
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
