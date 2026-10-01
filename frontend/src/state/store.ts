import { configureStore, type Middleware } from '@reduxjs/toolkit'
import { api } from '../api/base'
import authReducer, { clearAuth, recheckAuth, setAuth } from './authSlice'
import { saveSession, watchSession } from '../api/authSession'
import { files } from '../api/files'
import { clearDetachedRegistry } from '../components/workspace/detachedTabs'
import workspaceReducer, { resetWorkspace } from './workspaceSlice'

const sessionMiddleware: Middleware = (context) => (next) => (action) => {
  const previousUser = (context.getState() as RootState).auth.user
  if (setAuth.match(action) && 'token' in action.payload) {
    saveSession({ token: action.payload.token, expiresAt: action.payload.expiresAt })
  }
  if (clearAuth.match(action)) saveSession(null)
  const result = next(action)
  if (clearAuth.match(action) || recheckAuth.match(action)) {
    if (previousUser) {
      try {
        clearDetachedRegistry(previousUser.id)
      } catch {
        // Session storage may be unavailable.
      }
    }
    files.clearCache()
    context.dispatch(resetWorkspace())
    context.dispatch(api.util.resetApiState())
  }
  return result
}

export const store = configureStore({
  reducer: {
    auth: authReducer,
    workspace: workspaceReducer,
    [api.reducerPath]: api.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(sessionMiddleware, api.middleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export type AppStore = typeof store

watchSession(
  () => store.dispatch(clearAuth()),
  () => store.dispatch(recheckAuth()),
)
