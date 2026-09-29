import { Alert } from '../../ui'

export function Notice({ message }: { message: string | null }) {
  return message ? (
    <Alert severity="error" className="form-notice">
      {message}
    </Alert>
  ) : null
}
