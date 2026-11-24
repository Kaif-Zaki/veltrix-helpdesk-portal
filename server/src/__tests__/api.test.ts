import {beforeAll, describe, expect, it} from 'vitest';
import request from 'supertest';
import {generateKeyPair, jwtVerify, SignJWT, type KeyLike} from 'jose';
import {createApp} from '../app.js';
import {createAuthMiddleware} from '../middleware/auth.js';
import {RequestStore} from '../store/requestStore.js';

const ISSUER = 'https://api.asgardeo.io/t/veltrix/oauth2/token';

describe('Identity Helpdesk API (OIDC + RBAC)', () => {
  let privateKey: KeyLike;
  let publicKey: KeyLike;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  });

  async function mintToken(
    sub: string,
    scope: string,
    issuer = ISSUER,
    expiresIn = '5m',
    extraClaims: Record<string, unknown> = {},
  ): Promise<string> {
    return new SignJWT({scope, email: sub, ...extraClaims})
      .setProtectedHeader({alg: 'RS256'})
      .setSubject(sub)
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey);
  }

  function setupTestApp() {
    const store = new RequestStore(null, [
      {
        id: 'req-seed-1',
        title: 'VPN Access',
        description: 'Requesting VPN access for remote testing.',
        category: 'access',
        priority: 'medium',
        status: 'pending',
        createdBy: 'member@veltrix.org',
        createdAt: '2026-11-24T10:00:00.000Z',
      },
    ]);

    const authMiddleware = createAuthMiddleware(async (token) => {
      const {payload} = await jwtVerify(token, publicKey, {issuer: ISSUER});
      return payload;
    });

    return createApp({authMiddleware, store});
  }

  it('allows public health check without auth', async () => {
    const app = setupTestApp();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects unauthenticated or invalid-issuer tokens with 401', async () => {
    const app = setupTestApp();

    const noHeader = await request(app).get('/api/requests');
    expect(noHeader.status).toBe(401);

    const wrongIssuerToken = await mintToken('member@veltrix.org', 'requests:read', 'https://evil.example.com');
    const badIss = await request(app)
      .get('/api/requests')
      .set('Authorization', `Bearer ${wrongIssuerToken}`);
    expect(badIss.status).toBe(401);
  });

  it('allows a Member to read and create requests, but blocks approve and delete with 403', async () => {
    const app = setupTestApp();
    const memberToken = await mintToken('member@veltrix.org', 'openid profile requests:read requests:create');

    const listRes = await request(app)
      .get('/api/requests')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.requests).toHaveLength(1);

    const createRes = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        title: 'Docker Desktop Seat',
        description: 'Need a license for local container testing.',
        category: 'software',
        priority: 'low',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.request.status).toBe('pending');
    expect(createRes.body.request.createdBy).toBe('member@veltrix.org');

    const approveRes = await request(app)
      .patch(`/api/requests/${createRes.body.request.id}/status`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({status: 'approved'});
    expect(approveRes.status).toBe(403);
    expect(approveRes.body.requiredScope).toBe('requests:approve');

    const deleteRes = await request(app)
      .delete(`/api/requests/${createRes.body.request.id}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(deleteRes.status).toBe(403);
    expect(deleteRes.body.requiredScope).toBe('requests:delete');
  });

  it('allows a Reviewer with full scopes to approve and delete requests', async () => {
    const app = setupTestApp();
    const reviewerToken = await mintToken(
      'reviewer@veltrix.org',
      'openid requests:read requests:create requests:approve requests:delete',
    );

    const approveRes = await request(app)
      .patch('/api/requests/req-seed-1/status')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({status: 'approved', reviewNote: 'Verified manager sign-off.'});
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.request.status).toBe('approved');
    expect(approveRes.body.request.reviewedBy).toBe('reviewer@veltrix.org');
    expect(approveRes.body.request.reviewNote).toBe('Verified manager sign-off.');

    const deleteRes = await request(app)
      .delete('/api/requests/req-seed-1')
      .set('Authorization', `Bearer ${reviewerToken}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.deleted).toBe(true);
  });

  it('validates payloads and returns 400 on invalid input', async () => {
    const app = setupTestApp();
    const memberToken = await mintToken('member@veltrix.org', 'requests:read requests:create');

    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({title: 'Hi', description: 'Short'});
    expect(res.status).toBe(400);
  });

  it('derives permissions from verified roles claim when API scopes are omitted and exposes /api/me', async () => {
    const app = setupTestApp();
    const memberByRole = await mintToken('member@veltrix.org', 'openid profile', ISSUER, '5m', {
      roles: ['Member'],
    });
    const reviewerByRole = await mintToken('reviewer@veltrix.org', 'openid profile', ISSUER, '5m', {
      roles: ['Reviewer'],
    });
    const unassignedToken = await mintToken('guest@veltrix.org', 'openid profile');

    const meRes = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${memberByRole}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.roles).toEqual(['Member']);
    expect(meRes.body.user.scopes).toContain('requests:create');
    expect(meRes.body.user.scopes).not.toContain('requests:approve');

    const guestList = await request(app)
      .get('/api/requests')
      .set('Authorization', `Bearer ${unassignedToken}`);
    expect(guestList.status).toBe(403);

    const memberApprove = await request(app)
      .patch('/api/requests/req-seed-1/status')
      .set('Authorization', `Bearer ${memberByRole}`)
      .send({status: 'approved'});
    expect(memberApprove.status).toBe(403);

    const reviewerReject = await request(app)
      .patch('/api/requests/req-seed-1/status')
      .set('Authorization', `Bearer ${reviewerByRole}`)
      .send({status: 'rejected', reviewNote: 'Missing security approval.'});
    expect(reviewerReject.status).toBe(200);
    expect(reviewerReject.body.request.status).toBe('rejected');
    expect(reviewerReject.body.request.reviewNote).toBe('Missing security approval.');
  });
});
