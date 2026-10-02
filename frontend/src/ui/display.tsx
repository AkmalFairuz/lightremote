import { translateMessage } from '../i18n'
import { useLocale } from '../i18n/useLocale'
import {
  Alert as MuiAlert,
  CircularProgress as MuiCircularProgress,
  Paper as MuiPaper,
  Tooltip as MuiTooltip,
  Typography as MuiTypography,
} from '@mui/material'
import type {
  AlertProps,
  CircularProgressProps,
  PaperProps,
  TooltipProps,
  TypographyProps,
} from '@mui/material'

/** Renders a Material UI surface. */
export function Paper({ className = '', ...props }: PaperProps) {
  return <MuiPaper className={`ui-paper ${className}`} elevation={0} {...props} />
}

/** Renders text using the application theme. */
export function Typography(props: TypographyProps) {
  return <MuiTypography {...props} />
}

/** Shows loading progress. */
export function CircularProgress(props: CircularProgressProps) {
  return <MuiCircularProgress {...props} />
}

/** Shows an inline status or error message. */
export function Alert({ className = '', children, ...props }: AlertProps) {
  const locale = useLocale()
  return (
    <MuiAlert className={`ui-alert ${className}`} {...props}>
      {typeof children === 'string' ? translateMessage(children, locale) : children}
    </MuiAlert>
  )
}

/** Explains an action on hover or keyboard focus. */
export function Tooltip(props: TooltipProps) {
  return <MuiTooltip {...props} />
}
