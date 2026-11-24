import express, {type Express, type RequestHandler, type Response} from 'express';
import cors from 'cors';
import {requireScope, type AuthenticatedRequest} from './middleware/auth.js';
import {RequestStore} from './store/requestStore.js';
import type {RequestCategory, RequestPriority, RequestStatus} from './types.js';

const VALID_STATUSES = new Set<RequestStatus>(['pending', 'approved', 'rejected']);
const VALID_CATEGORIES = new Set<RequestCategory>(['access', 'hardware', 'software', 'support']);
const VALID_PRIORITIES = new Set<RequestPriority>(['low', 'medium', 'high']);
const VALID_REVIEW_STATUSES = new Set<Exclude<RequestStatus, 'pending'>>(['approved', 'rejected']);

function isRequestStatus(value: string): value is RequestStatus {
  return VALID_STATUSES.has(value as RequestStatus);
}

function getParamId(param: string | string[] | undefined): string {
  return Array.isArray(param) ? param[0] ?? '' : param ?? '';
}

export interface AppDependencies {
  authMiddleware: RequestHandler;
  store: RequestStore;
  clientOrigin?: string;
}

export function createApp({authMiddleware, store, clientOrigin = 'http://localhost:5173'}: AppDependencies): Express {
  const app = express();

  app.use(
    cors({
      origin: clientOrigin,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(express.json());

  app.get('/api/health', (_req, res: Response) => {
    res.json({status: 'ok', service: 'identity-helpdesk-server'});
  });

  app.get('/api/me', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    res.json({user: req.user});
  });

  app.get(
    '/api/requests',
    authMiddleware,
    requireScope('requests:read'),
    (req: AuthenticatedRequest, res: Response) => {
      const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
      if (statusParam !== undefined && !isRequestStatus(statusParam)) {
        res.status(400).json({error: 'invalid_query', message: 'Invalid status filter.'});
        return;
      }
      res.json({requests: store.list(statusParam)});
    },
  );

  app.post(
    '/api/requests',
    authMiddleware,
    requireScope('requests:create'),
    (req: AuthenticatedRequest, res: Response) => {
      const {title, description, category = 'support', priority = 'medium'} = req.body ?? {};

      if (typeof title !== 'string' || title.trim().length < 3) {
        res.status(400).json({error: 'validation_error', message: 'Title must be at least 3 characters.'});
        return;
      }
      if (typeof description !== 'string' || description.trim().length < 5) {
        res.status(400).json({error: 'validation_error', message: 'Description must be at least 5 characters.'});
        return;
      }
      if (!VALID_CATEGORIES.has(category)) {
        res.status(400).json({error: 'validation_error', message: 'Invalid category.'});
        return;
      }
      if (!VALID_PRIORITIES.has(priority)) {
        res.status(400).json({error: 'validation_error', message: 'Invalid priority.'});
        return;
      }

      const createdBy = req.user?.email ?? req.user?.username ?? req.user?.sub ?? 'unknown';
      const created = store.create({
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
        createdBy,
      });

      res.status(201).json({request: created});
    },
  );

  app.patch(
    '/api/requests/:id/status',
    authMiddleware,
    requireScope('requests:approve'),
    (req: AuthenticatedRequest, res: Response) => {
      const {status, reviewNote} = req.body ?? {};
      if (!VALID_REVIEW_STATUSES.has(status)) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Status must be either "approved" or "rejected".',
        });
        return;
      }

      const reviewedBy = req.user?.email ?? req.user?.username ?? req.user?.sub ?? 'reviewer';
      const note = typeof reviewNote === 'string' && reviewNote.trim() ? reviewNote.trim() : undefined;
      const requestId = getParamId(req.params.id);
      const updated = store.updateStatus(requestId, status, reviewedBy, note);

      if (!updated) {
        res.status(404).json({error: 'not_found', message: 'Request not found.'});
        return;
      }
      res.json({request: updated});
    },
  );

  app.delete(
    '/api/requests/:id',
    authMiddleware,
    requireScope('requests:delete'),
    (req: AuthenticatedRequest, res: Response) => {
      const requestId = getParamId(req.params.id);
      const removed = store.delete(requestId);
      if (!removed) {
        res.status(404).json({error: 'not_found', message: 'Request not found.'});
        return;
      }
      res.json({deleted: true, id: requestId});
    },
  );

  return app;
}
