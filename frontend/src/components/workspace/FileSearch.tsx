import { useT } from '../../i18n/useT'
import { useId } from 'react'
import { IconButton, Tooltip } from '../../ui'
import { Glyph } from '../common/Glyph'

interface FileSearchProps {
  query: string
  regex: boolean
  error: string | null
  disabled: boolean
  onQueryChange: (query: string) => void
  onRegexChange: (regex: boolean) => void
}

export function FileSearch({
  query,
  regex,
  error,
  disabled,
  onQueryChange,
  onRegexChange,
}: FileSearchProps) {
  const t = useT()

  const errorId = useId()

  return (
    <div className="files-search">
      <div className={`files-search-controls ${error ? 'files-search-invalid' : ''}`}>
        <Glyph name="search" size={16} />
        <input
          type="text"
          role="searchbox"
          aria-label={t('files.searchCurrentDirectory')}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          placeholder={regex ? t('files.regex') : t('files.searchThisFolder')}
          autoComplete="off"
          spellCheck={false}
          value={query}
          disabled={disabled}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.preventDefault()
              event.stopPropagation()
              onQueryChange('')
            }
          }}
        />
        <Tooltip title={t('files.clearSearch')}>
          <IconButton
            aria-label={t('files.clearSearch')}
            disabled={disabled || !query}
            onClick={() => onQueryChange('')}
          >
            <Glyph name="close" size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('files.useRegularExpressionCaseInsensitive')}>
          <IconButton
            aria-label={t('files.useRegularExpression')}
            aria-pressed={regex}
            disabled={disabled}
            onClick={() => onRegexChange(!regex)}
          >
            <span aria-hidden="true">.*</span>
          </IconButton>
        </Tooltip>
      </div>
      {error && (
        <div id={errorId} className="files-search-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
