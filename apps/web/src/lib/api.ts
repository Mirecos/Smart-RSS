import type {
  ApiResponse,
  AuthStatusDto,
  Backup,
  LoginRequest,
  PasswordChange,
  UserCreateInput,
  UserDto,
  UserRole,
  CategoryDto,
  FetchOptions,
  HealthDto,
  ImportResult,
  ItemDto,
  ItemUpdate,
  MarkReadRequest,
  PageMeta,
  PreviewResult,
  RawResult,
  RefreshOutcome,
  Settings,
  SourceConfigInput,
  SourceCreateInput,
  SourceDetailDto,
  SourceDto,
} from '@smart-rss/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> {
  data: T;
  meta?: PageMeta;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<Envelope<T>> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError('Cannot reach the server. Is it running?', 0);
  }
  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!payload || !payload.success || !response.ok) {
    const failure = payload && !payload.success ? payload.error : null;
    throw new ApiError(failure?.message ?? `Request failed (HTTP ${response.status})`, response.status, failure?.details);
  }
  return { data: payload.data, meta: payload.meta };
}

const data = async <T>(promise: Promise<Envelope<T>>): Promise<T> => (await promise).data;

export interface ItemFilter {
  sourceId?: number;
  categoryId?: number;
  starred?: boolean;
  unread?: boolean;
  q?: string;
}

export function itemsQueryString(filter: ItemFilter, cursor?: string | null, limit = 40): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (filter.sourceId) params.set('sourceId', String(filter.sourceId));
  if (filter.categoryId) params.set('categoryId', String(filter.categoryId));
  if (filter.starred) params.set('starred', 'true');
  if (filter.unread) params.set('unread', 'true');
  if (filter.q?.trim()) params.set('q', filter.q.trim());
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

/** Accepts either a raw backup or the API envelope saved by "Export backup". */
export function unwrapBackup(json: unknown): Backup {
  const candidate = json as { success?: boolean; data?: unknown };
  return (candidate?.success === true && candidate.data ? candidate.data : json) as Backup;
}

export const api = {
  health: () => data(request<HealthDto>('GET', '/health')),

  authStatus: () => data(request<AuthStatusDto>('GET', '/auth/status')),
  me: () => data(request<UserDto>('GET', '/auth/me')),
  login: (input: LoginRequest) => data(request<UserDto>('POST', '/auth/login', input)),
  logout: () => data(request<null>('POST', '/auth/logout')),
  changePassword: (input: PasswordChange) => data(request<null>('POST', '/auth/password', input)),

  users: () => data(request<UserDto[]>('GET', '/users')),
  createUser: (input: UserCreateInput) => data(request<UserDto>('POST', '/users', input)),
  updateUser: (id: number, patch: { role?: UserRole; password?: string }) =>
    data(request<UserDto>('PATCH', `/users/${id}`, patch)),
  deleteUser: (id: number) => data(request<null>('DELETE', `/users/${id}`)),

  sources: () => data(request<SourceDto[]>('GET', '/sources')),
  source: (id: number) => data(request<SourceDetailDto>('GET', `/sources/${id}`)),
  createSource: (input: SourceCreateInput) => data(request<SourceDto>('POST', '/sources', input)),
  updateSource: (id: number, patch: Partial<SourceCreateInput>) => data(request<SourceDto>('PATCH', `/sources/${id}`, patch)),
  deleteSource: (id: number) => data(request<null>('DELETE', `/sources/${id}`)),
  refreshSource: (id: number) => data(request<RefreshOutcome>('POST', `/sources/${id}/refresh`)),

  categories: () => data(request<CategoryDto[]>('GET', '/categories')),
  createCategory: (name: string) => data(request<CategoryDto>('POST', '/categories', { name })),
  renameCategory: (id: number, name: string) => data(request<CategoryDto>('PATCH', `/categories/${id}`, { name })),
  deleteCategory: (id: number) => data(request<null>('DELETE', `/categories/${id}`)),

  items: (filter: ItemFilter, cursor?: string | null) =>
    request<ItemDto[]>('GET', `/items?${itemsQueryString(filter, cursor)}`),
  updateItem: (id: number, patch: ItemUpdate) => data(request<ItemDto>('PATCH', `/items/${id}`, patch)),
  markRead: (scope: MarkReadRequest) => data(request<{ updated: number }>('POST', '/items/mark-read', scope)),

  preview: (url: string, config: SourceConfigInput) => data(request<PreviewResult>('POST', '/preview', { url, config })),
  raw: (url: string, fetchOptions: Partial<FetchOptions>) =>
    data(request<RawResult>('POST', '/preview/raw', { url, fetch: fetchOptions })),

  settings: () => data(request<Settings>('GET', '/settings')),
  updateSettings: (patch: Partial<Settings>) => data(request<Settings>('PATCH', '/settings', patch)),

  addStarterSources: () => data(request<ImportResult>('POST', '/sources/starter')),
  importOpml: (content: string) => data(request<ImportResult>('POST', '/opml', { content })),
  importBackup: (backup: Backup) => data(request<ImportResult>('POST', '/import', backup)),
};
