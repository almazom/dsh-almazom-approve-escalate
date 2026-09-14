// Behavior tests over the bundle's __test seam: the escalate → verify → answer
// decision logic, exercised without a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

import { readFileSync as _rfs } from 'node:fs'
const source = _rfs(new URL('../lib/client.js', import.meta.url), 'utf8')

let exportsObject
const requireStub = (name) => {
  if (name === 'react') return { useState: (v) => [v, () => {}], useCallback: (fn) => fn, useEffect: () => {} }
  throw new Error('unexpected require: ' + name)
}

function loadBundle() {
  const windowStub = { __ModuleLoader__: { load: (def) => { exportsObject = def.factory(requireStub) } } }
  const fn = new Function('window', source + '\n;')
  fn(windowStub)
}
test('bundle parses and exposes the plugin contract', () => {
  execFileSync(process.execPath, ['--check', 'lib/client.js'])
  loadBundle()
  assert.equal(typeof exportsObject.apply, 'function')
  assert.deepEqual(exportsObject.inject, ['slots', 'sessions'])
  assert.ok(exportsObject.__test)
})

const { escalate, verifyPreset, answerAllowedOnce, compactArgs } = (() => {
  loadBundle()
  return exportsObject.__test
})()

function fakeCtx(commandImpl) {
  const live = {
    command: commandImpl,
    projections: { faceOf: (k) => (k === 'permissions' ? { getSnapshot: () => ({ currentValue: 'workspace-write' }) } : {}) },
  }
  const ctx = { get: () => ({ binding: (id) => (id === 'sess-1' ? { session: live } : undefined) }) }
  return { ctx, live }
}

test('escalate resolves with the live session face and passes the command line', async () => {
  const seen = []
  const { ctx } = fakeCtx(async (line) => { seen.push(line); return { value: { matched: true } } })
  const live = await escalate(ctx, 'sess-1', 'workspace-write')
  assert.deepEqual(seen, ['/permission workspace-write'])
  assert.ok(live && typeof live.command === 'function')
})

test('escalate rejects on matched:false (no /permission command) — never answers', async () => {
  const { ctx } = fakeCtx(async () => ({ value: { matched: false } }))
  await assert.rejects(escalate(ctx, 'sess-1', 'workspace-write'), /no \/permission command/)
})

test('escalate rejects on ok:false with the transport error', async () => {
  const { ctx } = fakeCtx(async () => ({ ok: false, error: { code: 'X', message: 'boom' } }))
  await assert.rejects(escalate(ctx, 'sess-1', 'workspace-write'), /X: boom/)
})

test('verifyPreset true when the projection reflects the preset', async () => {
  const live = { projections: { faceOf: (k) => k === 'permissions' ? { getSnapshot: () => ({ currentValue: 'workspace-write' }) } : {} } }
  assert.equal(await verifyPreset(live, 'workspace-write', 2, 1), true)
})

test('verifyPreset false when the projection never reflects the preset (unknown preset case)', async () => {
  const live = { projections: { faceOf: () => ({ getSnapshot: () => ({ currentValue: 'read-only' }) }) } }
  assert.equal(await verifyPreset(live, 'wrkspace-write', 2, 1), false)
})

test('answerAllowedOnce resolves allowed-once and surfaces settlement rejection', async () => {
  const seen = []
  await answerAllowedOnce({ answer: async (o) => { seen.push(o) } })
  assert.deepEqual(seen, ['allowed-once'])
  await assert.rejects(answerAllowedOnce({ answer: () => Promise.reject(new Error('already settled')) }), /already settled/)
  await assert.rejects(answerAllowedOnce(undefined), /unavailable/)
})

test('compactArgs flattens and truncates raw args', () => {
  assert.equal(compactArgs('{"content":"hello\\n"}'), '{"content":"hello\\n"}')
  const truncated = compactArgs('x'.repeat(200))
  assert.equal(truncated.length, 158)
  assert.ok(truncated.endsWith('…'))
  assert.equal(compactArgs(''), undefined)
})
