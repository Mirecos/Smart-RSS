import type { Backup, ItemDto, ItemUpdate, MarkReadRequest, Settings, SourceCreateInput } from '@smart-rss/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { api, type ItemFilter } from '../lib/api';

export const queryKeys = {
  me: ['auth', 'me'] as const,
  authStatus: ['auth', 'status'] as const,
  users: ['users'] as const,
  sources: ['sources'] as const,
  source: (id: number) => ['sources', id] as const,
  categories: ['categories'] as const,
  items: ['items'] as const,
  itemList: (filter: ItemFilter) => ['items', filter] as const,
  settings: ['settings'] as const,
  health: ['health'] as const,
};

interface ItemPage {
  data: ItemDto[];
  meta?: { nextCursor: string | null };
}

/** Refetches everything that shows counts or items. */
function invalidateContent(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.sources }),
    client.invalidateQueries({ queryKey: queryKeys.categories }),
    client.invalidateQueries({ queryKey: queryKeys.items }),
  ]);
}

export const useSources = () => useQuery({ queryKey: queryKeys.sources, queryFn: api.sources, refetchInterval: 60_000 });
export const useSource = (id: number | null) =>
  useQuery({ queryKey: queryKeys.source(id ?? 0), queryFn: () => api.source(id as number), enabled: id !== null });
export const useCategories = () => useQuery({ queryKey: queryKeys.categories, queryFn: api.categories });
export const useSettings = () => useQuery({ queryKey: queryKeys.settings, queryFn: api.settings });
export const useHealth = () => useQuery({ queryKey: queryKeys.health, queryFn: api.health, staleTime: 30_000 });

export function useItems(filter: ItemFilter) {
  return useInfiniteQuery({
    queryKey: queryKeys.itemList(filter),
    queryFn: ({ pageParam }) => api.items(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ItemPage) => last.meta?.nextCursor ?? null,
    refetchInterval: 120_000,
  });
}

export function useUpdateItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ItemUpdate }) => api.updateItem(id, patch),
    // Optimistic: flip the flag in every cached list immediately.
    onMutate: ({ id, patch }) => {
      client.setQueriesData<InfiniteData<ItemPage>>({ queryKey: queryKeys.items }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                data: page.data.map((item) => (item.id === id ? { ...item, ...patch } : item)),
              })),
            }
          : data,
      );
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.sources }),
        client.invalidateQueries({ queryKey: queryKeys.categories }),
      ]),
  });
}

export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (scope: MarkReadRequest) => api.markRead(scope),
    onSuccess: () => invalidateContent(client),
  });
}

export function useSaveSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: SourceCreateInput }) =>
      id === null ? api.createSource(input) : api.updateSource(id, input),
    onSuccess: async (source) => {
      await invalidateContent(client);
      // The first fetch runs in the background; refresh counts once it had time to finish.
      setTimeout(() => void invalidateContent(client), 3000);
      return source;
    },
  });
}

export function useDeleteSource() {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.deleteSource, onSuccess: () => invalidateContent(client) });
}

export function useRefreshSource() {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.refreshSource, onSuccess: () => invalidateContent(client) });
}

export function useToggleSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => api.updateSource(id, { enabled }),
    onSuccess: () => invalidateContent(client),
  });
}

export function useCategoryMutations() {
  const client = useQueryClient();
  const onSuccess = () => invalidateContent(client);
  return {
    create: useMutation({ mutationFn: api.createCategory, onSuccess }),
    rename: useMutation({ mutationFn: ({ id, name }: { id: number; name: string }) => api.renameCategory(id, name), onSuccess }),
    remove: useMutation({ mutationFn: api.deleteCategory, onSuccess }),
  };
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.updateSettings(patch),
    onSuccess: (settings) => client.setQueryData(queryKeys.settings, settings),
  });
}

/**
 * Drops everything cached for the previous user. The auth queries are kept (and then updated):
 * removing them would detach the <AuthGate> observer, which would never see the new session.
 */
function resetUserData(client: QueryClient) {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.login,
    onSuccess: (user) => {
      resetUserData(client);
      client.setQueryData(queryKeys.me, user);
    },
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      resetUserData(client);
      client.setQueryData(queryKeys.me, null);
    },
  });
}

export const useChangePassword = () => useMutation({ mutationFn: api.changePassword });

export const useUsers = () => useQuery({ queryKey: queryKeys.users, queryFn: api.users });

export function useUserMutations() {
  const client = useQueryClient();
  const onSuccess = () => client.invalidateQueries({ queryKey: queryKeys.users });
  return {
    create: useMutation({ mutationFn: api.createUser, onSuccess }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof api.updateUser>[1] }) => api.updateUser(id, patch),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: api.deleteUser, onSuccess }),
  };
}

export function useImports() {
  const client = useQueryClient();
  const onSuccess = () => invalidateContent(client);
  return {
    opml: useMutation({ mutationFn: api.importOpml, onSuccess }),
    starter: useMutation({
      mutationFn: api.addStarterSources,
      // Sources are fetched in the background; refresh counts again once the first fetches landed.
      onSuccess: () => {
        setTimeout(() => void invalidateContent(client), 5000);
        return onSuccess();
      },
    }),
    backup: useMutation({ mutationFn: (backup: Backup) => api.importBackup(backup), onSuccess }),
  };
}
