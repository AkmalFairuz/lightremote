import { useT } from '../../i18n/useT'
import { useState, useSyncExternalStore } from 'react'
import { MenuItem, Select } from '@mui/material'
import { languages, languagePreference, setLanguagePreference } from '../../i18n'
import type { LanguagePreference } from '../../i18n'
import { useLocale } from '../../i18n/useLocale'

function subscribe(listener: () => void) {
  window.addEventListener('lightremote:language-preference', listener)
  return () => window.removeEventListener('lightremote:language-preference', listener)
}

/** Available in the locked shell, native desktop header, and detached windows. */
export function LanguageSelector() {
  const t = useT()

  const locale = useLocale()
  const preference = useSyncExternalStore(subscribe, languagePreference)
  const [open, setOpen] = useState(false)
  return (
    <Select
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      size="small"
      className="language-selector"
      value={preference}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onChange={(event) => setLanguagePreference(event.target.value as LanguagePreference)}
      inputProps={{ 'aria-label': t('language.label') }}
      MenuProps={{ slotProps: { paper: { className: 'language-menu' } } }}
    >
      <MenuItem value="system">{t('language.system')}</MenuItem>
      {languages.map(({ code, name }) => (
        <MenuItem key={code} value={code} lang={code} dir={code === 'ar' ? 'rtl' : 'ltr'}>
          {name}
        </MenuItem>
      ))}
    </Select>
  )
}
