import { CacheProvider } from '@emotion/react'
import createCache from '@emotion/cache'
import rtlPlugin from '@mui/stylis-plugin-rtl'
import { prefixer } from 'stylis'
import { CssBaseline, ThemeProvider } from '@mui/material'
import {
  enUS,
  idID,
  esES,
  frFR,
  deDE,
  ptBR,
  ruRU,
  zhCN,
  jaJP,
  koKR,
  arSA,
  hiIN,
} from '@mui/material/locale'
import { type ReactNode } from 'react'
import { createAppTheme } from '../ui/theme'
import { useLocale } from './useLocale'
import type { Language } from './index'

const ltrCache = createCache({ key: 'lr' })
const rtlCache = createCache({ key: 'lr-rtl', stylisPlugins: [prefixer, rtlPlugin] })
const materialLocales = {
  en: enUS,
  id: idID,
  es: esES,
  fr: frFR,
  de: deDE,
  'pt-BR': ptBR,
  ru: ruRU,
  'zh-CN': zhCN,
  ja: jaJP,
  ko: koKR,
  ar: arSA,
  hi: hiIN,
}
const themes = new Map<Language, ReturnType<typeof createAppTheme>>()

export function LocalizedTheme({ children }: { children: ReactNode }) {
  const language = useLocale()
  const rtl = language === 'ar'
  let theme = themes.get(language)
  if (!theme) {
    theme = createAppTheme(rtl ? 'rtl' : 'ltr', materialLocales[language])
    themes.set(language, theme)
  }
  return (
    <CacheProvider value={rtl ? rtlCache : ltrCache}>
      <ThemeProvider theme={theme} defaultMode="system" noSsr>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  )
}
