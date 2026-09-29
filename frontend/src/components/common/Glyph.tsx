import { Icon } from '@iconify/react'

export function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  return <Icon icon={`material-symbols:${name}`} width={size} height={size} aria-hidden="true" />
}
