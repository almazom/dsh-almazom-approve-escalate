// Build verifier: the plugin ships hand-written artifacts (lib/*.js are the
// source of truth, following the dsh-answer-reviewer pattern). This script
// syntax-checks both faces and confirms the manifest contract files exist.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const files = ['lib/index.js', 'lib/client.js']
for (const file of files) {
  if (!existsSync(file)) { console.error(`build failed: ${file} missing`); process.exit(1) }
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (check.status !== 0) { console.error(`build failed: ${file} syntax:\n${check.stderr}`); process.exit(1) }
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (pkg.dsh?.client?.platform !== 'web') { console.error('build failed: dsh.client.platform'); process.exit(1) }
console.log('build complete: lib/index.js, lib/client.js')
