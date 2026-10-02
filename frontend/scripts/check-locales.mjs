import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('../src/i18n/locales/', import.meta.url))
const english = JSON.parse(readFileSync(directory + 'en.json', 'utf8'))
const pluralSuffix = /_(zero|one|two|few|many|other)$/
const baseKeys = Object.keys(english).filter((key) => !pluralSuffix.test(key))
const tokens = (value) =>
  [...value.matchAll(/{{\s*([^},\s]+)/g)]
    .map((match) => match[1])
    .sort()
    .join(',')
const tags = (value) =>
  [...value.matchAll(/<\/?([a-z]+)>/g)]
    .map((match) => match[0])
    .sort()
    .join(',')
const problems = []
const files = readdirSync(directory).filter((name) => name.endsWith('.json'))
const registry = readFileSync(new URL('../src/i18n/index.ts', import.meta.url), 'utf8')
for (const [, locale] of registry.matchAll(/\{ code: '([^']+)'/g)) {
  if (!files.includes(`${locale}.json`)) problems.push(`${locale}: missing catalog`)
}
for (const file of files) {
  const locale = file.slice(0, -5)
  const catalog = JSON.parse(readFileSync(directory + file, 'utf8'))
  for (const key of baseKeys) {
    if (typeof catalog[key] !== 'string' || !catalog[key].trim())
      problems.push(`${locale}: missing ${key}`)
  }
  for (const [key, value] of Object.entries(catalog)) {
    const base = key.replace(pluralSuffix, '')
    if (!baseKeys.includes(base)) problems.push(`${locale}: unknown ${key}`)
    else if (
      typeof value !== 'string' ||
      tokens(value) !== tokens(english[base]) ||
      tags(value) !== tags(english[base])
    )
      problems.push(`${locale}: placeholders or tags differ for ${key}`)
  }
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
  for (const key of baseKeys.filter((key) => Object.hasOwn(english, key + '_other'))) {
    for (const category of categories) {
      if (!catalog[key + '_' + category]) problems.push(`${locale}: missing ${key}_${category}`)
    }
  }
}
if (problems.length) {
  process.stderr.write(problems.join('\n') + '\n')
  process.exitCode = 1
} else {
  process.stdout.write(
    `All catalogs cover ${baseKeys.length} keys, interpolation, rich text, and plural categories.\n`,
  )
}
