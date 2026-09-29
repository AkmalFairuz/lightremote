import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { RootState } from '../state/store'

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api',
    credentials: 'same-origin',
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).auth.csrfToken
      if (token) headers.set('X-CSRF-Token', token)
      return headers
    },
  }),
  tagTypes: ['Auth', 'Folders', 'Connections', 'Users', 'Sessions'],
  endpoints: () => ({}),
})
