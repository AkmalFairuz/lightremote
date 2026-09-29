import {
  Button as MuiButton,
  FormControlLabel as MuiFormControlLabel,
  IconButton as MuiIconButton,
  Switch as MuiSwitch,
} from '@mui/material'
import type {
  ButtonProps,
  FormControlLabelProps,
  IconButtonProps,
  SwitchProps,
} from '@mui/material'

/** Renders an application button with the shared compact size. */
export function Button({ className = '', size = 'small', ...props }: ButtonProps) {
  return <MuiButton className={`ui-button ${className}`} size={size} {...props} />
}

/** Renders a compact icon action while retaining sidebar and toolbar classes. */
export function IconButton({ className = '', size = 'small', ...props }: IconButtonProps) {
  return <MuiIconButton className={`ui-icon-button ${className}`} size={size} {...props} />
}

/** Renders the Material UI switch used in connection and account forms. */
export function Switch(props: SwitchProps) {
  return <MuiSwitch size="small" {...props} />
}

/** Associates a control with its text label. */
export function FormControlLabel(props: FormControlLabelProps) {
  return <MuiFormControlLabel {...props} />
}
