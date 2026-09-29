import { api } from './base'
import type { SessionDetail, WorkSession } from '../types'

export const sessionsApi = api.injectEndpoints({
  endpoints: (build) => ({
    sessions: build.query<WorkSession[], void>({
      query: () => '/sessions',
      providesTags: ['Sessions'],
    }),
    createSession: build.mutation<WorkSession, string>({
      query: (connectionId) => ({ url: `/connections/${connectionId}/sessions`, method: 'POST' }),
      invalidatesTags: ['Sessions'],
    }),
    sessionDetail: build.query<SessionDetail, string>({
      query: (sessionId) => `/sessions/${sessionId}`,
    }),
    deleteSession: build.mutation<void, string>({
      query: (sessionId) => ({ url: `/sessions/${sessionId}`, method: 'DELETE' }),
      invalidatesTags: ['Sessions'],
    }),
  }),
})

export const {
  useSessionsQuery,
  useCreateSessionMutation,
  useSessionDetailQuery,
  useDeleteSessionMutation,
} = sessionsApi
