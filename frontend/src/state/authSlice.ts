import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { AuthIdentity, LoginResult, User } from '../types'

interface AuthState {
  user: User | null
  csrfToken: string | null
  localMode: boolean
  signedOut: boolean
}

const initialState: AuthState = { user: null, csrfToken: null, localMode: false, signedOut: false }

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuth: (_state, action: PayloadAction<AuthIdentity | LoginResult>) => ({
      user: action.payload.user,
      csrfToken: action.payload.csrfToken,
      localMode: action.payload.localMode,
      signedOut: false,
    }),
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload
    },
    recheckAuth: () => ({ ...initialState }),
    clearAuth: () => ({ ...initialState, signedOut: true }),
  },
})

export const { setAuth, setUser, clearAuth, recheckAuth } = authSlice.actions
export default authSlice.reducer
