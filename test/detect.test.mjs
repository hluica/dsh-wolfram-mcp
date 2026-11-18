/**
 * Unit tests for DSH home and Wolfram installation discovery.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { commandExists, findWolframApp, findWolframScript } from '../lib/detect.js'
import { resolveDshHome, resolveSkillsRoot, resolveStateDir } from '../lib/paths.js'

test('resolves DSH home precedence', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '/tmp/dsh-home' }), '/tmp/dsh-home')
  assert.equal(resolveDshHome({ DSH_HOME: '   ' }), join(homedir(), '.dsh'))
  assert.equal(resolveDshHome({ DSH_HOME: '~/custom-dsh' }), join(homedir(), 'custom-dsh'))
  assert.equal(resolveStateDir({ DSH_HOME: '/tmp/dsh-home' }), join('/tmp/dsh-home', 'dsh-wolfram-mcp'))
  assert.equal(resolveSkillsRoot({ DSH_HOME: '/tmp/dsh-home' }), join('/tmp/dsh-home', 'skills'))
})

test('finds wolframscript on PATH and among candidates', () => {
  const root = mkdtempSync(join(tmpdir(), 'dwm-detect-'))
  try {
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const executable = join(bin, 'wolframscript')
    writeFileSync(executable, '#!/bin/sh\nexit 0\n')
    chmodSync(executable, 0o755)

    assert.equal(findWolframScript({ env: { PATH: bin }, candidates: [] }), executable)
    assert.equal(findWolframScript({ env: { PATH: '' }, candidates: [executable] }), executable)
    assert.equal(findWolframScript({ env: { PATH: '' }, candidates: [join(root, 'missing')] }), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('finds a Wolfram app bundle and ignores helper-only bundles', () => {
  const root = mkdtempSync(join(tmpdir(), 'dwm-detect-'))
  try {
    const wolfram = join(root, 'Wolfram.app', 'Contents', 'MacOS')
    mkdirSync(wolfram, { recursive: true })
    const command = join(wolfram, 'wolfram')
    writeFileSync(command, '#!/bin/sh\nexit 0\n')
    chmodSync(command, 0o755)

    const script = join(root, 'WolframScript.app', 'Contents', 'MacOS')
    mkdirSync(script, { recursive: true })
    const scriptCommand = join(script, 'wolframscript')
    writeFileSync(scriptCommand, '#!/bin/sh\nexit 0\n')
    chmodSync(scriptCommand, 0o755)

    assert.deepEqual(findWolframApp({ appDirs: [root] }), { appPath: join(root, 'Wolfram.app'), command })
    assert.equal(commandExists(command), true)
    assert.equal(commandExists(join(root, 'missing')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
