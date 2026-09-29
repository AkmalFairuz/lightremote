import { useState } from 'react'
import { Icon } from '@iconify/react'
import type { TextFieldProps } from '@mui/material'
import { IconButton } from './controls'
import { InputAdornment, TextField } from './fields'

/** Adds a shared show or hide action to sensitive text fields. */
export function PasswordField({ slotProps, ...props }: Omit<TextFieldProps, 'type'>) {
  const [visible, setVisible] = useState(false)

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      slotProps={{
        ...slotProps,
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                type="button"
                edge="end"
                aria-label={visible ? 'Hide secret' : 'Show secret'}
                aria-pressed={visible}
                onClick={() => setVisible((current) => !current)}
                onMouseDown={(event) => event.preventDefault()}
              >
                <Icon
                  icon={
                    visible
                      ? 'material-symbols:visibility-off-outline'
                      : 'material-symbols:visibility-outline'
                  }
                  width={18}
                  height={18}
                  aria-hidden="true"
                />
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}
