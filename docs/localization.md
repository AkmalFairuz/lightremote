# Localization

LightRemote bundles all translations for offline use. The language selector is available in the app header, login/setup dialogs, and detached windows. “System language” chooses the first supported browser language, falling back to English. Manual choices persist locally and synchronize across windows; accounts and server configuration are unchanged.

## Adding a language

1. Add its BCP 47 code and native name to `languages` in `frontend/src/i18n/index.ts`.
2. Copy the base keys from `frontend/src/i18n/locales/en.json` into a catalog named after that code and translate every message. Keys are semantic and flat; dots do not create nested objects.
3. Preserve interpolation names (`{{name}}`, `{{count, number}}`) and the named tags used by `Trans`. User values are rendered as text; never inject translated HTML.
4. Add all plural categories reported by `Intl.PluralRules(code)`. Pass a numeric `count` to `t`; number formatting happens during interpolation.
5. Update language detection when a regional variant needs a dedicated mapping. For another RTL language, extend the Arabic direction checks in the localized theme and relevant layout components.
6. Run `npm run locales:check`, `npm run lint`, `npm run build`, and `npm run format:check` from `frontend`.

Use `const t = useT()` in React components and `Trans` for sentences with styled values. The bound translator changes with the language so React’s compiler invalidates cached text. Use the global `t` for imperative API errors or long-lived event handlers, and `useLocale()` for explicit formatting and layout dependencies. Include the locale in any memoized formatting or sorting operation. Do not translate module-level constants at import time: keep a key, resolve it when rendering, or use `translateMessage` for existing option labels.

Known API errors receive localized summaries. Specific server and remote diagnostics remain available; terminal output, remote desktops, connection names, and file contents are never translated. OS-owned menus and file dialogs use the operating system language; app-owned macOS menus follow the selected language.

## Manual review

Without restarting the app, change languages while a connection, form, file search, and editor are open. Confirm session state survives, choices persist after reload, and detached windows synchronize. Review Arabic menus, column and sidebar resizing, mobile navigation, light/dark modes, and long labels. Native speakers should review translation wording before release. Static checks do not verify visual layout.
