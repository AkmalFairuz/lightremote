import type { FileEntry } from '../../types'

export const maxEditableBytes = 10 * 1024 * 1024

const editableExtensions = new Set([
  'bash',
  'bat',
  'c',
  'cc',
  'cfg',
  'conf',
  'config',
  'cpp',
  'cs',
  'css',
  'csv',
  'env',
  'go',
  'h',
  'hpp',
  'htm',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsonc',
  'jsonl',
  'jsx',
  'less',
  'log',
  'lua',
  'md',
  'markdown',
  'mjs',
  'php',
  'properties',
  'ps1',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svg',
  'text',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
  'zsh',
])

const editableNames = new Set([
  '.bashrc',
  '.env',
  '.env.local',
  '.gitconfig',
  '.gitignore',
  '.htaccess',
  '.npmrc',
  '.profile',
  '.ssh/config',
  'dockerfile',
  'makefile',
])

/** Reports whether the remote entry has a known text format. */
export function isEditableTextFile(entry: FileEntry): boolean {
  if (entry.isDir) return false
  const name = entry.name.toLowerCase()
  if (editableNames.has(name) || name.startsWith('.env.')) return true
  const extension = name.split('.').at(-1) ?? ''
  return editableExtensions.has(extension)
}
