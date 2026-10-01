import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { RootState } from '../state/store'

import { authHeaders, handleUnauthorized, sessionToken } from './authSession'

const baseQuery = fetchBaseQuery({
  baseUrl: '/api',
  credentials: 'omit',
  prepareHeaders: (headers, { getState }) => {
    authHeaders((getState() as RootState).auth.csrfToken).forEach((value, name) => {
      headers.set(name, value)
    })
    return headers
  },
})

export const api = createApi({
  reducerPath: 'api',
  baseQuery: async (args, context, options) => {
    const token = sessionToken()
    const result = await baseQuery(args, context, options)
    const path = typeof args === 'string' ? args : args.url
    if (path !== '/auth/login' && path !== '/auth/setup') {
      handleUnauthorized(typeof result.error?.status === 'number' ? result.error.status : 0, token)
    }
    return result
  },
  tagTypes: ['Auth', 'Folders', 'Connections', 'RecentConnections', 'Users', 'Sessions', 'SSHKeys'],
  endpoints: () => ({}),
})
