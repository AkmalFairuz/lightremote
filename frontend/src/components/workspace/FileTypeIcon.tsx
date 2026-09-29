import type { FileEntry } from '../../types'
import { Glyph } from '../common/Glyph'

interface FileIconType {
  category: string
  icon: string
  extensions: Set<string>
}

const fileTypes: FileIconType[] = [
  { category: 'pdf', icon: 'picture-as-pdf-outline', extensions: new Set(['pdf']) },
  {
    category: 'document',
    icon: 'description-outline',
    extensions: new Set(['doc', 'docx', 'odt', 'rtf', 'pages']),
  },
  {
    category: 'sheet',
    icon: 'table-chart-outline',
    extensions: new Set(['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers']),
  },
  {
    category: 'slides',
    icon: 'slideshow-outline',
    extensions: new Set(['ppt', 'pptx', 'odp', 'keynote']),
  },
  {
    category: 'data',
    icon: 'data-object',
    extensions: new Set([
      'json',
      'jsonl',
      'yaml',
      'yml',
      'toml',
      'xml',
      'ini',
      'conf',
      'cfg',
      'env',
      'properties',
    ]),
  },
  {
    category: 'text',
    icon: 'article-outline',
    extensions: new Set(['txt', 'md', 'markdown', 'log', 'nfo']),
  },
  {
    category: 'audio',
    icon: 'audio-file-outline',
    extensions: new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'opus']),
  },
  {
    category: 'video',
    icon: 'video-file-outline',
    extensions: new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'mpeg', 'mpg']),
  },
  {
    category: 'image',
    icon: 'image-outline',
    extensions: new Set([
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'svg',
      'bmp',
      'tif',
      'tiff',
      'ico',
      'heic',
      'avif',
      'psd',
    ]),
  },
  {
    category: 'archive',
    icon: 'archive-outline',
    extensions: new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst']),
  },
  {
    category: 'code',
    icon: 'code',
    extensions: new Set([
      'go',
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'rb',
      'java',
      'c',
      'cc',
      'cpp',
      'h',
      'hpp',
      'rs',
      'php',
      'sh',
      'bash',
      'zsh',
      'ps1',
      'sql',
      'html',
      'css',
      'scss',
      'vue',
      'svelte',
      'kt',
      'swift',
      'dart',
      'ipynb',
    ]),
  },
  {
    category: 'font',
    icon: 'font-download-outline',
    extensions: new Set(['ttf', 'otf', 'woff', 'woff2']),
  },
  {
    category: 'key',
    icon: 'key-outline',
    extensions: new Set(['pem', 'crt', 'cer', 'p12', 'pub']),
  },
  {
    category: 'binary',
    icon: 'terminal',
    extensions: new Set(['exe', 'msi', 'app', 'dmg', 'deb', 'rpm', 'apk', 'bin']),
  },
]

function iconFor(entry: FileEntry): { category: string; icon: string } {
  if (entry.isDir) return { category: 'folder', icon: 'folder-outline' }
  const name = entry.name.toLowerCase()
  if (['dockerfile', 'makefile', 'gemfile', 'justfile'].includes(name)) {
    return { category: 'code', icon: 'code' }
  }
  if (['readme', 'license', 'changelog'].includes(name)) {
    return { category: 'text', icon: 'article-outline' }
  }
  const extension = name.includes('.') ? (name.split('.').at(-1) ?? '') : ''
  return (
    fileTypes.find((type) => type.extensions.has(extension)) ?? {
      category: 'other',
      icon: 'draft-outline',
    }
  )
}

export function FileTypeIcon({ entry }: { entry: FileEntry }) {
  const type = iconFor(entry)
  return (
    <span className={`file-type-icon file-type-${type.category}`}>
      <Glyph name={type.icon} size={19} />
    </span>
  )
}
