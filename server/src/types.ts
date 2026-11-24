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

export interface AuthenticatedUser {
  sub: string;
  email?: string;
  username?: string;
  roles: string[];
  scopes: string[];
}
