import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {HelpdeskRequest, RequestCategory, RequestPriority, RequestStatus} from '../types.js';

export interface CreateRequestInput {
  title: string;
  description: string;
  category: RequestCategory;
  priority: RequestPriority;
  createdBy: string;
}

const SEED_REQUESTS: HelpdeskRequest[] = [
  {
    id: 'req-1001',
    title: 'Production Staging DB Read Access',
    description: 'Need temporary read-only access to staging analytics database for sprint debugging.',
    category: 'access',
    priority: 'high',
    status: 'pending',
    createdBy: 'alex@veltrix.org',
    createdAt: '2026-11-24T09:30:00.000Z',
  },
  {
    id: 'req-1002',
    title: 'JetBrains IntelliJ Ultimate License',
    description: 'Renew annual IDE license for backend microservice development.',
    category: 'software',
    priority: 'medium',
    status: 'approved',
    createdBy: 'maya@veltrix.org',
    createdAt: '2026-11-23T14:15:00.000Z',
    reviewedBy: 'lead@veltrix.org',
    reviewedAt: '2026-11-23T16:45:00.000Z',
    reviewNote: 'Approved under engineering tooling budget.',
  },
];

export class RequestStore {
  private readonly filePath: string | null;
  private requests: HelpdeskRequest[];

  constructor(filePath: string | null = null, initialData?: HelpdeskRequest[]) {
    this.filePath = filePath;
    if (initialData) {
      this.requests = initialData.map((r) => ({...r}));
    } else if (filePath && fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      this.requests = JSON.parse(raw) as HelpdeskRequest[];
    } else {
      this.requests = SEED_REQUESTS.map((r) => ({...r}));
      this.persist();
    }
  }

  private persist(): void {
    if (!this.filePath) {
      return;
    }
    fs.mkdirSync(path.dirname(this.filePath), {recursive: true});
    fs.writeFileSync(this.filePath, JSON.stringify(this.requests, null, 2), 'utf-8');
  }

  list(status?: RequestStatus): HelpdeskRequest[] {
    const items = status ? this.requests.filter((r) => r.status === status) : this.requests;
    return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  create(input: CreateRequestInput): HelpdeskRequest {
    const item: HelpdeskRequest = {
      id: `req-${crypto.randomUUID().slice(0, 8)}`,
      title: input.title,
      description: input.description,
      category: input.category,
      priority: input.priority,
      status: 'pending',
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };
    this.requests.unshift(item);
    this.persist();
    return item;
  }

  updateStatus(
    id: string,
    status: Exclude<RequestStatus, 'pending'>,
    reviewedBy: string,
    reviewNote?: string,
  ): HelpdeskRequest | null {
    const target = this.requests.find((r) => r.id === id);
    if (!target) {
      return null;
    }
    target.status = status;
    target.reviewedBy = reviewedBy;
    target.reviewedAt = new Date().toISOString();
    if (reviewNote !== undefined) {
      target.reviewNote = reviewNote;
    }
    this.persist();
    return target;
  }

  delete(id: string): boolean {
    const index = this.requests.findIndex((r) => r.id === id);
    if (index === -1) {
      return false;
    }
    this.requests.splice(index, 1);
    this.persist();
    return true;
  }
}
