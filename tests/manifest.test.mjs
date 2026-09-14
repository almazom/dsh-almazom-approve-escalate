// Manifest-contract tests: the checks `dsh plugin add` and the client-modules
// scanner effectively perform, kept local so drift fails before install.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('package name appears verbatim in the patch row (mount contract)', () => {
  assert.ok(patch.includes(`name: '${pkg.name}'`), 'patch row name must equal the package name')
})

test('dsh manifest blocks satisfy the scanner contract', () => {
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.ok(pkg.files.includes('lib'), 'lib must ship')
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'patch must ship')
})

test('both faces parse (node --check)', () => {
  for (const file of ['lib/index.js', 'lib/client.js']) {
    assert.ok(existsSync(file), `${file} exists`)
    execFileSync(process.execPath, ['--check', file])
  }
})

test('client bundle carries the loader wrapper and the slot key', () => {
  assert.ok(client.includes('window.__ModuleLoader__.load'), 'lazy-CJS loader wrapper')
  assert.ok(client.includes(`id: '${pkg.name}'`), 'loader id equals package name')
  assert.ok(client.includes("conversation.approval.detail"), 'registers the approval detail slot')
  assert.ok(client.includes("'allowed-once'"), 'answers the approval')
  assert.ok(client.includes("'/permission ' +"), 'escalates via the /permission command')
  assert.ok(client.includes("exports.inject = ['slots', 'sessions']"), 'declares its services')
})

test('client bundle uses theme variables, no literal hex colors', () => {
  const css = client.slice(client.indexOf('var CSS'), client.indexOf('function insertStyles'))
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no hardcoded hex in styles')
})
