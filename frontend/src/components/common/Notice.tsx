import { translateMessage } from '../../i18n'
import { useLocale } from '../../i18n/useLocale'
import { Alert } from '../../ui'

export function Notice({ message }: { message: string | null }) {
  const locale = useLocale()
  return message ? (
    <Alert severity="error" className="form-notice">
      {translateMessage(message, locale)}
    </Alert>
  ) : null
}
