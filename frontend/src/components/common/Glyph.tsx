import { LocalIcon } from '../../ui/localIcons'

export function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  return <LocalIcon name={name} size={size} />
}
