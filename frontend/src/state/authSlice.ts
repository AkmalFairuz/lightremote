import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { LoginResult, User } from '../types'

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
    setAuth: (_state, action: PayloadAction<LoginResult>) => ({
      ...action.payload,
      signedOut: false,
    }),
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload
    },
    clearAuth: () => ({ ...initialState, signedOut: true }),
  },
})

export const { setAuth, setUser, clearAuth } = authSlice.actions
export default authSlice.reducer
