const leafName = (source) => source.split(/[\\/]/u).at(-1)

export const shouldCopySkillSource = (source) => {
  const leaf = leafName(source)
  return !leaf.endsWith('.test.mjs')
    && leaf !== '.npmignore'
    && leaf !== 'release-manifest.json'
}
