import { useT } from './i18n/useT'
import { LanguageSelector } from './components/shell/LanguageSelector'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Dialog as MuiDialog } from '@mui/material'
import { Button, CircularProgress, DialogActions, DialogContent, Typography } from './ui'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { useMeQuery, useSetupStatusQuery } from './api/auth'
import { LoginDialog } from './components/shell/LoginDialog'
import { SetupDialog } from './components/shell/SetupDialog'
import { LockedShell } from './components/shell/LockedShell'
import { useAppDispatch, useAppSelector } from './state/hooks'
import { setAuth } from './state/authSlice'
import { errorMessage, isUnauthorized } from './types'

const AppShell = lazy(() =>
  import('./components/shell/AppShell').then((module) => ({ default: module.AppShell })),
)
const DetachedWorkspacePage = lazy(() =>
  import('./components/workspace/DetachedWorkspacePage').then((module) => ({
    default: module.DetachedWorkspacePage,
  })),
)

function PageLoading() {
  return (
    <div className="page-loading">
      <CircularProgress size={28} />
    </div>
  )
}

function AuthGate({ children, detached = false }: { children: ReactNode; detached?: boolean }) {
  const t = useT()

  const dispatch = useAppDispatch()
  const { user, signedOut } = useAppSelector((state) => state.auth)
  const { data, error, isLoading, isFetching, isError, refetch } = useMeQuery(undefined, {
    skip: Boolean(user) || signedOut,
  })
  const checkingSetup = !user && (signedOut || isUnauthorized(error))
  const {
    data: installation,
    error: setupError,
    isError: setupFailed,
    refetch: refetchSetup,
  } = useSetupStatusQuery(undefined, { skip: !checkingSetup })

  useEffect(() => {
    if (!user && !signedOut && data && !isFetching && !isError) dispatch(setAuth(data))
  }, [data, dispatch, isError, isFetching, signedOut, user])

  if (user) return children
  if (checkingSetup && !installation && !setupFailed) {
    return <LockedShell checkingSession />
  }
  if (checkingSetup && installation?.required && !setupFailed) {
    return (
      <LockedShell>
        <SetupDialog />
      </LockedShell>
    )
  }
  if (checkingSetup && installation && !setupFailed) {
    return detached ? (
      <Navigate to="/" replace />
    ) : (
      <LockedShell>
        <LoginDialog />
      </LockedShell>
    )
  }
  if (
    (checkingSetup && setupFailed) ||
    (!checkingSetup && (isError || (!isLoading && !data && !isFetching)))
  ) {
    return (
      <LockedShell>
        <MuiDialog open fullWidth maxWidth="xs" aria-labelledby="server-error-title">
          <DialogContent>
            <div className="dialog-language">
              <LanguageSelector />
            </div>
            <Typography component="h1" variant="h6" id="server-error-title">
              {t('common.serverUnavailable')}
            </Typography>
            <Typography>{errorMessage(checkingSetup ? setupError : error)}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => (checkingSetup ? refetchSetup() : refetch())}>
              {t('common.retry')}
            </Button>
          </DialogActions>
        </MuiDialog>
      </LockedShell>
    )
  }
  return detached ? <PageLoading /> : <LockedShell checkingSession />
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route
            path="/detached/:transferId"
            element={
              <AuthGate detached>
                <DetachedWorkspacePage />
              </AuthGate>
            }
          />
          <Route
            path="/"
            element={
              <AuthGate>
                <AppShell />
              </AuthGate>
            }
          >
            <Route index element={null} />
            <Route path="settings" element={<Navigate to="/" replace />} />
            <Route path="settings/users" element={<Navigate to="/" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
