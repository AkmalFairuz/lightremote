import { api } from './base'
import type { Connection, ConnectionInput, Folder } from '../types'

export const resourcesApi = api.injectEndpoints({
  endpoints: (build) => ({
    folders: build.query<Folder[], void>({ query: () => '/folders', providesTags: ['Folders'] }),
    createFolder: build.mutation<Folder, { name: string; parentId: string | null }>({
      query: (body) => ({ url: '/folders', method: 'POST', body }),
      invalidatesTags: ['Folders'],
    }),
    updateFolder: build.mutation<Folder, { id: string; name: string; parentId: string | null }>({
      query: ({ id, name, parentId }) => ({
        url: `/folders/${id}`,
        method: 'PUT',
        body: { name, parentId },
      }),
      invalidatesTags: ['Folders', 'Connections'],
    }),
    deleteFolder: build.mutation<void, string>({
      query: (id) => ({ url: `/folders/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Folders'],
    }),
    connections: build.query<Connection[], void>({
      query: () => '/connections',
      providesTags: ['Connections'],
    }),
    recentConnections: build.query<Connection[], void>({
      query: () => '/connections/recent',
      providesTags: ['Connections', 'RecentConnections'],
    }),
    recordConnectionOpen: build.mutation<void, string>({
      query: (id) => ({ url: `/connections/${id}/recent`, method: 'POST' }),
      invalidatesTags: ['RecentConnections'],
    }),
    createConnection: build.mutation<Connection, ConnectionInput>({
      query: (body) => ({ url: '/connections', method: 'POST', body }),
      invalidatesTags: ['Connections'],
    }),
    createDirectConnection: build.mutation<Connection, ConnectionInput>({
      query: (body) => ({ url: '/direct-connections', method: 'POST', body }),
    }),
    deleteDirectConnection: build.mutation<void, string>({
      query: (id) => ({ url: `/direct-connections/${id}`, method: 'DELETE' }),
    }),
    directConnection: build.query<Connection, string>({
      query: (id) => `/connections/${id}`,
    }),
    duplicateConnection: build.mutation<Connection, string>({
      query: (id) => ({ url: `/connections/${id}/duplicate`, method: 'POST' }),
      invalidatesTags: ['Connections'],
    }),
    updateConnection: build.mutation<Connection, { id: string; input: ConnectionInput }>({
      query: ({ id, input }) => ({ url: `/connections/${id}`, method: 'PUT', body: input }),
      invalidatesTags: ['Connections', 'Sessions'],
    }),
    moveConnectionFolder: build.mutation<Connection, { id: string; folderId: string | null }>({
      query: ({ id, folderId }) => ({
        url: `/connections/${id}/folder`,
        method: 'PATCH',
        body: { folderId },
      }),
      invalidatesTags: ['Connections'],
    }),
    renameConnection: build.mutation<Connection, { id: string; name: string }>({
      query: ({ id, name }) => ({
        url: `/connections/${id}/name`,
        method: 'PATCH',
        body: { name },
      }),
      invalidatesTags: ['Connections'],
    }),
    deleteConnection: build.mutation<void, string>({
      query: (id) => ({ url: `/connections/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Connections', 'Sessions'],
    }),
    inspectHostKey: build.mutation<{ fingerprint: string }, string>({
      query: (id) => ({ url: `/connections/${id}/host-key/inspect`, method: 'POST' }),
    }),
    approveHostKey: build.mutation<void, { id: string; fingerprint: string }>({
      query: ({ id, fingerprint }) => ({
        url: `/connections/${id}/host-key/approve`,
        method: 'POST',
        body: { fingerprint },
      }),
      invalidatesTags: ['Connections'],
    }),
  }),
})

export const {
  useFoldersQuery,
  useCreateFolderMutation,
  useUpdateFolderMutation,
  useDeleteFolderMutation,
  useConnectionsQuery,
  useLazyConnectionsQuery,
  useRecentConnectionsQuery,
  useRecordConnectionOpenMutation,
  useCreateConnectionMutation,
  useCreateDirectConnectionMutation,
  useDeleteDirectConnectionMutation,
  useLazyDirectConnectionQuery,
  useDuplicateConnectionMutation,
  useUpdateConnectionMutation,
  useMoveConnectionFolderMutation,
  useRenameConnectionMutation,
  useDeleteConnectionMutation,
  useInspectHostKeyMutation,
  useApproveHostKeyMutation,
} = resourcesApi
