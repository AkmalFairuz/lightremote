import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'

export const languages = [
  { code: 'en', name: 'English' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
] as const
export type Language = (typeof languages)[number]['code']
export type LanguagePreference = Language | 'system'
export type TranslationKey = keyof typeof en
const storageKey = 'lightremote.language'
const codes = new Set<string>(languages.map(({ code }) => code))

function validPreference(value: string | null): value is LanguagePreference {
  return value === 'system' || (value !== null && codes.has(value))
}

function readPreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(storageKey)
    if (validPreference(value)) return value
  } catch {
    // The in-memory preference works when browser storage is unavailable.
  }
  return 'system'
}

let preference = readPreference()

export function detectLanguage(candidates: readonly string[] = navigator.languages): Language {
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase().replaceAll('_', '-')
    if (normalized === 'zh' || normalized.startsWith('zh-')) {
      return 'zh-CN'
    }
    if (normalized === 'pt' || normalized.startsWith('pt-')) return 'pt-BR'
    const base = normalized.split('-')[0]
    if (codes.has(base)) return base as Language
  }
  return 'en'
}

const catalogs = import.meta.glob<{ default: Record<string, string> }>('./locales/*.json', {
  eager: true,
})
const resources = Object.fromEntries(
  languages.map(({ code }) => [
    code,
    { translation: catalogs[`./locales/${code}.json`]?.default ?? en },
  ]),
)

export const i18n = i18next.createInstance()
void i18n.use(initReactI18next).init({
  resources,
  lng: preference === 'system' ? detectLanguage() : preference,
  fallbackLng: 'en',
  supportedLngs: languages.map(({ code }) => code),
  load: 'currentOnly',
  keySeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})

export function t(key: TranslationKey, values?: Record<string, unknown>): string {
  return i18n.t(key, values)
}

export function currentLanguage(): Language {
  return (i18n.resolvedLanguage ?? 'en') as Language
}

export function languagePreference(): LanguagePreference {
  return preference
}

export function setLanguagePreference(next: LanguagePreference): void {
  preference = next
  try {
    localStorage.setItem(storageKey, next)
  } catch {
    // Keep the selection for this window when storage is blocked.
  }
  void i18n.changeLanguage(next === 'system' ? detectLanguage() : next)
  window.dispatchEvent(new Event('lightremote:language-preference'))
}

window.addEventListener('storage', (event) => {
  if (event.storageArea !== localStorage) return
  if (event.key !== storageKey && event.key !== null) return
  preference = validPreference(event.newValue) ? event.newValue : 'system'
  void i18n.changeLanguage(preference === 'system' ? detectLanguage() : preference)
  window.dispatchEvent(new Event('lightremote:language-preference'))
})
window.addEventListener('languagechange', () => {
  if (preference === 'system') void i18n.changeLanguage(detectLanguage())
})

function updateDocumentLanguage() {
  document.documentElement.lang = currentLanguage()
  document.documentElement.dir = i18n.dir()
}
i18n.on('languageChanged', updateDocumentLanguage)
updateDocumentLanguage()

// Stored notices and known API messages can change language without altering diagnostics.
const messageKeys = new Map<string, TranslationKey>()
for (const { translation } of Object.values(resources)) {
  for (const [key, value] of Object.entries(translation)) {
    if (!value.includes('{{')) messageKeys.set(value, key as TranslationKey)
  }
}
export function translateMessage(message: string, language = currentLanguage()): string {
  const key = messageKeys.get(message)
  if (key) return t(key, { lng: language })
  return message.includes('\n')
    ? message
        .split('\n')
        .map((line) => translateMessage(line, language))
        .join('\n')
    : message
}
