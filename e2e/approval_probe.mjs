// E2E: approval card + Approve & escalate button on the isolated stand.
// Flow: login (cookie) → wizard skip → workspace → new session → force
// read-only default via the /permission picker → send a task that needs a tool
// → approval card appears → click our button → assert policy switched +
// approval resolved. One model round total.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'

const BASE = 'http://127.0.0.1:39781'
const SHOTS = '/tmp/dsh-almazom-escalate/shots'
execSync(`mkdir -p ${SHOTS}`)

const TOK = process.argv[2]
if (!TOK) { console.error('usage: node approval_probe.mjs <token>'); process.exit(2) }
const login = execSync(
  `curl -s -X POST ${BASE}/_dsh_login -d "token=${TOK}" -D - -o /dev/null`,
  { encoding: 'utf8' },
)
const cookieLine = login.split('\n').find(l => /^set-cookie/i.test(l))
if (!cookieLine) { console.error('login failed'); process.exit(2) }
const [name, ...rest] = cookieLine.split(':')[1].trim().split(';')[0].split('=')
const cookieValue = rest.join('=')

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addCookies([{ name, value: cookieValue, domain: '127.0.0.1', path: '/' }])
const p = await ctx.newPage()
const log = (...a) => console.log('[probe]', ...a)

try {
  await p.goto(BASE + '/')
  await p.waitForSelector('#root > *', { timeout: 30000 })

  // ── virgin-home wizard ──────────────────────────────────────────────────
  const composer = p.locator("textarea, [contenteditable='true']").first()
  if ((await composer.count()) === 0) {
    const step = async (text, timeout = 5000) => {
      try { await p.getByText(text, { exact: true }).click({ timeout }); return true } catch { return false }
    }
    await step('Configure later')
    await step('Save and continue', 4000)
    if (await step('Choose workspace')) {
      await p.getByText('dsh-escalate-ws', { exact: true }).last().click({ timeout: 10000 }).catch(async () => {
        // fall back to the first folder row in the picker
        await p.locator('[role="dialog"] button, [role="dialog"] [role="row"]').first().click({ timeout: 8000 })
      })
      await p.locator("button:has-text('Open')").last().click({ timeout: 8000 }).catch(() => {})
    }
    await dismiss(p)
  }
  await composer.waitFor({ state: 'visible', timeout: 20000 })
  await dismiss(p)

  // ── force the read-only default so the task raises an approval ─────────
  await composer.click()
  await composer.type('/permission')
  const menuRow = p.getByText('Permission', { exact: false }).first()
  await menuRow.waitFor({ state: 'visible', timeout: 8000 })
  await menuRow.click()
  await p.getByText('Read Only', { exact: true }).first().click({ timeout: 8000 })
  await p.waitForTimeout(1200)
  log('default preset set to read-only')

  // ── send the task (one model round; tool use raises the approval) ──────
  await composer.click()
  await composer.type('List the files in the current workspace directory using the shell.')
  await p.keyboard.press('Enter')
  log('task sent, waiting for the approval card…')

  const card = p.getByText('Waiting for approval', { exact: false }).first()
  await card.waitFor({ state: 'visible', timeout: 180000 })
  log('approval card visible')
  await p.screenshot({ path: SHOTS + '/01-card.png' })

  // ── our button ──────────────────────────────────────────────────────────
  const btn = p.locator("button.almazom-ae-btn").first()
  await btn.waitFor({ state: 'visible', timeout: 15000 })
  const btnText = (await btn.textContent())?.trim()
  log('plugin button visible:', JSON.stringify(btnText))
  if (!/Approve & escalate/i.test(btnText ?? '')) throw new Error('unexpected button label: ' + btnText)

  await btn.click()
  log('clicked — waiting for policy switch + resolution…')

  // ── assertions ──────────────────────────────────────────────────────────
  await p.waitForTimeout(2500)
  const bodyText = await p.evaluate(() => document.body.innerText)
  const policySwitched = /workspace write|workspace-write/i.test(bodyText)
  const cardGone = (await card.count()) === 0 || !(await card.isVisible().catch(() => false))
  await p.screenshot({ path: SHOTS + '/02-after.png' })
  log('POLICY SWITCHED', policySwitched ? '✓' : '✗')
  log('APPROVAL RESOLVED', cardGone ? '✓' : '✗')
  if (!policySwitched || !cardGone) {
    await p.screenshot({ path: SHOTS + '/03-fail.png' })
    process.exit(1)
  }
  log('E2E PASS')
} finally {
  await browser.close()
}

async function dismiss(p) {
  const b = p.getByText('Configure later', { exact: true })
  if (await b.count() && await b.isVisible().catch(() => false)) { await b.click(); await p.waitForTimeout(400) }
}
