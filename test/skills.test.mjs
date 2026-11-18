/**
 * Unit tests for skill copying and ownership-scoped removal.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installSkills, listSkillDirectories, readMarker, removeSkills } from '../lib/skills.js'

function makeSource(root) {
  const source = join(root, 'Skills')
  mkdirSync(join(source, 'skill-a', 'references'), { recursive: true })
  mkdirSync(join(source, 'skill-b'), { recursive: true })
  writeFileSync(join(source, 'skill-a', 'SKILL.md'), '---\nname: skill-a\n---\nA\n')
  writeFileSync(join(source, 'skill-a', 'references', 'note.md'), 'note\n')
  writeFileSync(join(source, 'skill-b', 'SKILL.md'), '---\nname: skill-b\n---\nB\n')
  writeFileSync(join(source, '.DS_Store'), 'junk')
  writeFileSync(join(source, 'skill-a', '.DS_Store'), 'junk')
  return source
}

test('lists only direct skill bundles', () => {
  const root = mkdtempSync(join(tmpdir(), 'dwm-skills-'))
  try {
    const source = makeSource(root)
    assert.deepEqual(listSkillDirectories(source), ['skill-a', 'skill-b'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('copies skills, skips sidecars, and removes only its own token', () => {
  const root = mkdtempSync(join(tmpdir(), 'dwm-skills-'))
  try {
    const source = makeSource(root)
    const target = join(root, 'global', 'skills')
    const first = installSkills({ sourceDir: source, targetRoot: target, token: 'token-1' })
    assert.deepEqual(first.installed.map((item) => item.name), ['skill-a', 'skill-b'])
    assert.equal(readFileSync(join(target, 'skill-a', 'references', 'note.md'), 'utf8'), 'note\n')
    assert.equal(existsSync(join(target, 'skill-a', '.DS_Store')), false)
    assert.equal(readMarker(join(target, 'skill-a')).token, 'token-1')

    const second = installSkills({ sourceDir: source, targetRoot: target, token: 'token-2' })
    assert.equal(second.installed.length, 2)
    assert.equal(readMarker(join(target, 'skill-a')).token, 'token-2')

    assert.equal(removeSkills({ installed: first.installed }), 0)
    assert.equal(existsSync(join(target, 'skill-a')), true)

    assert.equal(removeSkills({ installed: second.installed }), 2)
    assert.equal(existsSync(join(target, 'skill-a')), false)
    assert.equal(existsSync(join(target, 'skill-b')), false)
    assert.equal(existsSync(target), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('never overwrites or removes a user-owned skill directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'dwm-skills-'))
  try {
    const source = makeSource(root)
    const target = join(root, 'global', 'skills')
    mkdirSync(join(target, 'skill-a'), { recursive: true })
    writeFileSync(join(target, 'skill-a', 'SKILL.md'), 'user copy\n')

    const result = installSkills({ sourceDir: source, targetRoot: target, token: 'token-1' })
    assert.deepEqual(result.installed.map((item) => item.name), ['skill-b'])
    assert.deepEqual(result.skipped, [{ name: 'skill-a', reason: 'occupied' }])
    assert.equal(readFileSync(join(target, 'skill-a', 'SKILL.md'), 'utf8'), 'user copy\n')

    assert.equal(removeSkills({ installed: result.installed }), 1)
    assert.equal(readFileSync(join(target, 'skill-a', 'SKILL.md'), 'utf8'), 'user copy\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('silently gives up when the target root cannot be created', () => {
  const root = mkdtempSync(join(tmpdir(), 'dwm-skills-'))
  try {
    const source = makeSource(root)
    const blocked = join(root, 'blocked')
    writeFileSync(blocked, 'not a directory\n')
    const result = installSkills({ sourceDir: source, targetRoot: blocked, token: 'token-1' })
    assert.equal(result.installed.length, 0)
    assert.equal(typeof result.error, 'string')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
