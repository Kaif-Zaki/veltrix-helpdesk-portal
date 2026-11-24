import type {NextFunction, Request, RequestHandler, Response} from 'express';
import {createRemoteJWKSet, jwtVerify, type JWTPayload} from 'jose';
import type {AuthenticatedUser} from '../types.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export type TokenVerifier = (token: string) => Promise<JWTPayload>;

export function createJwksTokenVerifier(jwksUrl: string, issuer: string): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  return async (token: string): Promise<JWTPayload> => {
    const {payload} = await jwtVerify(token, jwks, {
      issuer,
    });
    return payload;
  };
}

const HELPDESK_SCOPES = ['requests:read', 'requests:create', 'requests:approve', 'requests:delete'] as const;

const ROLE_SCOPE_MAP: Record<string, readonly string[]> = {
  member: ['requests:read', 'requests:create'],
  reviewer: ['requests:read', 'requests:create', 'requests:approve', 'requests:delete'],
};

function parseClaimList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function extractRoles(payload: JWTPayload): string[] {
  const combined = new Set<string>([
    ...parseClaimList(payload.roles),
    ...parseClaimList(payload.groups),
  ]);
  return Array.from(combined);
}

export function extractScopes(payload: JWTPayload, roles: string[] = extractRoles(payload)): string[] {
  const explicitScopes = new Set<string>([
    ...parseClaimList(payload.scope),
    ...parseClaimList(payload.scp),
  ]);

  const hasExplicitHelpdeskScope = HELPDESK_SCOPES.some((scope) => explicitScopes.has(scope));
  if (!hasExplicitHelpdeskScope && roles.length > 0) {
    for (const role of roles) {
      const mapped = ROLE_SCOPE_MAP[role.toLowerCase()];
      if (mapped) {
        for (const scope of mapped) {
          explicitScopes.add(scope);
        }
      }
    }
  }

  return Array.from(explicitScopes);
}

export function createAuthMiddleware(verifyToken: TokenVerifier): RequestHandler {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Missing or malformed Authorization Bearer token.',
      });
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Bearer token cannot be empty.',
      });
      return;
    }

    try {
      const payload = await verifyToken(token);
      const roles = extractRoles(payload);
      const username =
        (typeof payload.username === 'string' && payload.username) ||
        (typeof payload.preferred_username === 'string' && payload.preferred_username) ||
        (typeof payload.name === 'string' && payload.name) ||
        undefined;

      req.user = {
        sub: typeof payload.sub === 'string' ? payload.sub : 'unknown',
        email: typeof payload.email === 'string' ? payload.email : undefined,
        username,
        roles,
        scopes: extractScopes(payload, roles),
      };
      next();
    } catch (error) {
      res.status(401).json({
        error: 'invalid_token',
        message: error instanceof Error ? error.message : 'Token verification failed.',
      });
    }
  };
}

export function requireScope(requiredScope: string): RequestHandler {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const scopes = req.user?.scopes ?? [];
    if (!scopes.includes(requiredScope)) {
      res.status(403).json({
        error: 'insufficient_scope',
        requiredScope,
        grantedScopes: scopes,
        message: `Forbidden: missing required scope "${requiredScope}".`,
      });
      return;
    }
    next();
  };
}
