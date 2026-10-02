import { t } from '../i18n'
import { desktopRuntime } from './runtime'

function call(method: string, ...args: string[]): Promise<void> {
  if (!desktopRuntime) return Promise.reject(new Error(t('common.wailsRuntimeIsUnavailable')))
  return desktopRuntime.Call.ByName(method, ...args)
}

export function openDetachedWindow(transferId: string): Promise<void> {
  return call('main.DesktopService.OpenDetached', transferId)
}

export function saveRemoteFile(
  connectionId: string,
  remotePath: string,
  filename: string,
  transferId: string,
): Promise<boolean> {
  if (!desktopRuntime) return Promise.reject(new Error(t('common.wailsRuntimeIsUnavailable')))
  return desktopRuntime.Call.ByName(
    'main.DesktopService.SaveRemoteFile',
    connectionId,
    remotePath,
    filename,
    transferId,
  )
}

export function saveTextFile(filename: string, contents: string): Promise<void> {
  return call('main.DesktopService.SaveTextFile', filename, contents)
}

export function saveImageFile(filename: string, encoded: string): Promise<void> {
  return call('main.DesktopService.SaveImageFile', filename, encoded)
}
