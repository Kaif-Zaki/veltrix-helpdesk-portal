export type RequestStatus = 'pending' | 'approved' | 'rejected';
export type RequestPriority = 'low' | 'medium' | 'high';
export type RequestCategory = 'access' | 'hardware' | 'software' | 'support';

export interface HelpdeskRequest {
  id: string;
  title: string;
  description: string;
  category: RequestCategory;
  priority: RequestPriority;
  status: RequestStatus;
  createdBy: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

async function requestJson<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = typeof data?.message === 'string' ? data.message : `Request failed (${response.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export interface AuthenticatedProfile {
  sub: string;
  email?: string;
  username?: string;
  roles: string[];
  scopes: string[];
}

export async function fetchCurrentUser(token: string): Promise<AuthenticatedProfile> {
  const data = await requestJson<{user: AuthenticatedProfile}>('/api/me', token);
  return data.user;
}

export async function fetchRequests(token: string, status?: RequestStatus): Promise<HelpdeskRequest[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await requestJson<{requests: HelpdeskRequest[]}>(`/api/requests${query}`, token);
  return data.requests;
}

export async function createHelpdeskRequest(
  token: string,
  payload: {
    title: string;
    description: string;
    category: RequestCategory;
    priority: RequestPriority;
  },
): Promise<HelpdeskRequest> {
  const data = await requestJson<{request: HelpdeskRequest}>('/api/requests', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.request;
}

export async function reviewHelpdeskRequest(
  token: string,
  id: string,
  status: 'approved' | 'rejected',
  reviewNote?: string,
): Promise<HelpdeskRequest> {
  const data = await requestJson<{request: HelpdeskRequest}>(`/api/requests/${id}/status`, token, {
    method: 'PATCH',
    body: JSON.stringify({status, reviewNote}),
  });
  return data.request;
}

export async function deleteHelpdeskRequest(token: string, id: string): Promise<void> {
  await requestJson<{deleted: boolean}>(`/api/requests/${id}`, token, {
    method: 'DELETE',
  });
}
