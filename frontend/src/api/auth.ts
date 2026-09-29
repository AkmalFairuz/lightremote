import { api } from './base'
import type { LoginResult, User } from '../types'

export const authApi = api.injectEndpoints({
  endpoints: (build) => ({
    me: build.query<LoginResult, void>({ query: () => '/auth/me', providesTags: ['Auth'] }),
    login: build.mutation<LoginResult, { email: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      invalidatesTags: ['Auth'],
    }),
    logout: build.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      invalidatesTags: ['Auth', 'Sessions'],
    }),
    changePassword: build.mutation<void, { currentPassword: string; newPassword: string }>({
      query: (body) => ({ url: '/auth/password', method: 'PUT', body }),
    }),
    users: build.query<User[], void>({ query: () => '/users', providesTags: ['Users'] }),
    createUser: build.mutation<User, { email: string; password: string; role: 'admin' | 'user' }>({
      query: (body) => ({ url: '/users', method: 'POST', body }),
      invalidatesTags: ['Users'],
    }),
    updateUser: build.mutation<
      User,
      {
        id: string
        changes: {
          email?: string
          role?: 'admin' | 'user'
          disabled?: boolean
          password?: string
        }
      }
    >({
      query: ({ id, changes }) => ({ url: `/users/${id}`, method: 'PATCH', body: changes }),
      invalidatesTags: ['Users'],
    }),
  }),
})

export const {
  useMeQuery,
  useLoginMutation,
  useLogoutMutation,
  useChangePasswordMutation,
  useUsersQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
} = authApi
