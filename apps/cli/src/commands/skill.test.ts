import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { learnerCapabilities } from '@panshi/contracts'
import { runSkillCommand } from './skill.js'

const repoRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
const skillRoot = join(repoRoot, 'skills/panshi-camp')

describe('panshi-camp learner Skill package', () => {
  it('contains one non-admin index entry for every learner capability', async () => {
    const skill = await readFile(join(skillRoot, 'SKILL.md'), 'utf8')
    const capabilities = JSON.parse(await readFile(join(skillRoot, 'capabilities.json'), 'utf8')) as Array<{ id: string }>
    expect(skill).toMatch(/^---\nname: panshi-camp\n/mu)
    expect(capabilities.map(({ id }) => id)).toEqual(learnerCapabilities.map(({ id }) => id))
    expect(new Set(capabilities.map(({ id }) => id)).size).toBe(capabilities.length)
    expect(JSON.stringify(capabilities)).not.toContain('admin.')
  })

  it('references CLI commands without copied endpoints, fixed event data, or secrets', async () => {
    const files = ['SKILL.md', 'examples/register-and-apply.md', 'examples/check-status-and-check-in.md']
    const content = (await Promise.all(files.map((file) => readFile(join(skillRoot, file), 'utf8')))).join('\n')
    expect(content).toContain('panshi-camp --json')
    expect(content).not.toMatch(/\/api\/|https?:\/\/|20\d{2}[年/-]|1[3-9]\d{9}|演讲嘉宾|password|cookie|bearer token|qrPayload/iu)
    expect(content).toContain('不得根据此前对话推定用户已确认')
  })

  it('previews installation, refuses broad or symlink targets, and installs only with the bound token', async () => {
    const home = await mkdtemp(join(tmpdir(), 'panshi-skill-home-')); const previews: unknown[] = []
    const error = await runSkillCommand(['install', '--agent', 'codex'], { homeDirectory: home, sourceDirectory: skillRoot, onPreview: (value) => previews.push(value) }).catch((caught) => caught)
    expect(error).toMatchObject({ code: 'CONFIRMATION_REQUIRED', details: { source: skillRoot, target: join(home, '.codex/skills/panshi-camp') } })
    expect(previews).toHaveLength(1)
    const token = error.details.confirmationToken as string
    await expect(runSkillCommand(['install', '--agent', 'codex', '--confirm', token], { homeDirectory: home, sourceDirectory: skillRoot })).resolves.toMatchObject({ installed: true })
    await expect(readFile(join(home, '.codex/skills/panshi-camp/SKILL.md'), 'utf8')).resolves.toContain('name: panshi-camp')

    const linkedHome = await mkdtemp(join(tmpdir(), 'panshi-skill-link-')); const elsewhere = await mkdtemp(join(tmpdir(), 'panshi-skill-target-'))
    await mkdir(join(linkedHome, '.codex')); await writeFile(join(elsewhere, 'sentinel'), 'safe');
    await import('node:fs/promises').then(({ symlink }) => symlink(elsewhere, join(linkedHome, '.codex/skills')))
    await expect(runSkillCommand(['install', '--agent', 'codex'], { homeDirectory: linkedHome, sourceDirectory: skillRoot })).rejects.toMatchObject({ code: 'INPUT_INVALID' })
  })

  it('rejects unsupported agents and bypass flags', async () => {
    const home = await mkdtemp(join(tmpdir(), 'panshi-skill-invalid-'))
    await expect(runSkillCommand(['install', '--agent', 'unknown'], { homeDirectory: home, sourceDirectory: skillRoot })).rejects.toMatchObject({ code: 'INPUT_INVALID' })
    await expect(runSkillCommand(['install', '--agent', 'codex', '--yes'], { homeDirectory: home, sourceDirectory: skillRoot })).rejects.toMatchObject({ code: 'INPUT_INVALID' })
  })
})
