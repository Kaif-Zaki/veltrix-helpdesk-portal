# Veltrix Helpdesk & Approval Portal

An internal IT access, software, hardware, and engineering support portal secured by **WSO2 Identity Platform (Asgardeo)** using **OpenID Connect (OIDC + PKCE)** and **Role-Based Access Control (RBAC)**.

Built with React, TypeScript, Vite, `@asgardeo/react`, Express, and `jose`.

---

## Why This Project Exists

Engineering and operations teams frequently need temporary staging database access, developer software licenses, or hardware approvals. Instead of building custom login screens or password tables, this portal delegates all authentication, role assignment, and token issuance to **WSO2 Identity Platform** and enforces granular permissions at both the UI and REST API layers.

---

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│ React SPA (client/ · @asgardeo/react)                                │
│  • OIDC Authorization Code + PKCE sign-in / sign-out                 │
│  • Syncs authoritative roles & scopes via GET /api/me                │
│  • Role-tailored workspace UI (Member vs. Reviewer)                  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ 1. OIDC + PKCE login & scopes
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ WSO2 Identity Platform (Asgardeo)                                    │
│  • Issues signed JWT Access Tokens + ID Tokens                       │
│  • Member   -> requests:read, requests:create                        │
│  • Reviewer -> requests:read, requests:create,                       │
│                requests:approve, requests:delete                     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ 2. Bearer JWT sent on API requests
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Express REST API (server/ · jose)                                    │
│  • Verifies JWT signature via remote JWKS & checks token issuer      │
│  • Enforces per-route scopes (`requireScope(...)`) + role fallback   │
│  • Persists tickets in server/data/requests.json                     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Role & Permission Matrix

Every protected endpoint validates the Bearer token against WSO2 Identity Platform's JWKS endpoint before checking required permissions:

| Endpoint | Required Scope | Member | Reviewer | Unauthenticated / No Role |
| :--- | :--- | :---: | :---: | :---: |
| `GET /api/health` | Public | `200` | `200` | `200` |
| `GET /api/me` | Valid JWT | `200` | `200` | `401` |
| `GET /api/requests` | `requests:read` | `200` | `200` | `401` / `403` |
| `POST /api/requests` | `requests:create` | `201` | `201` | `401` / `403` |
| `PATCH /api/requests/:id/status` | `requests:approve` | `403` | `200` | `401` / `403` |
| `DELETE /api/requests/:id` | `requests:delete` | `403` | `200` | `401` / `403` |

### What Each Role Sees in the UI

- **Member (`requests:read`, `requests:create`):**
  - Browse and search the shared request queue
  - Toggle between **All Queue** and **My Requests**
  - Submit new access, software, hardware, or support tickets
  - View approval decisions, reviewer identity, timestamps, and review notes (approval and delete controls stay hidden and blocked by the API)
- **Reviewer (`requests:read`, `requests:create`, `requests:approve`, `requests:delete`):**
  - Full Member capabilities
  - Add optional custom **Review notes** when approving or rejecting pending requests
  - Delete resolved or unwanted tickets using a two-step **Confirm Delete** guard
- **No Role Assigned:**
  - Displays a clear restricted-access notice instead of failing silently

---

## Key Features

- **Zero-trust JWT verification:** The Express API never trusts client-side role headers; every request is verified via `jose` (`createRemoteJWKSet` + `jwtVerify`) against `{ASGARDEO_BASE_URL}/oauth2/jwks` and `{ASGARDEO_ISSUER}`.
- **Resilient RBAC claim extraction:** Reads explicit OAuth2 `scope` / `scp` claims first and safely maps verified JWT `roles` / `groups` claims (`Member`, `Reviewer`) if custom API scopes are not attached.
- **Smooth SPA auth lifecycle:** Preserves sessions in `localStorage` across refreshes, cleans OAuth callback query parameters once authenticated to `/dashboard`, prevents browser Back from returning to the login/callback screen while signed in, and handles sign-out cleanly back to `/`.
- **Responsive design:** Desktop two-column workspace and mobile-adaptive navigation/composer layout using `lucide-react` icons.

---

## Project Structure

```text
identity-helpdesk-portal/
├── package.json              # Root scripts (dev, build, test)
├── client/                   # React + Vite + TypeScript frontend
│   ├── .env.example
│   └── src/
│       ├── main.tsx          # AsgardeoProvider configuration
│       ├── App.tsx           # Landing page, routing guard, RBAC workspace UI
│       ├── index.css         # Responsive design system & layout styles
│       ├── api/
│       │   └── helpdeskApi.ts
│       └── utils/
│           └── token.ts      # JWT payload, scope, and role helpers
└── server/                   # Express + TypeScript + jose REST API
    ├── .env.example
    └── src/
        ├── index.ts          # Server entrypoint & env loading
        ├── app.ts            # Express routes & input validation
        ├── types.ts
        ├── middleware/
        │   └── auth.ts       # JWKS verification & requireScope middleware
        ├── store/
        │   └── requestStore.ts
        └── __tests__/
            └── api.test.ts   # Vitest + Supertest RBAC & validation suite
```

---

## Quick Start (Local Development)

### Prerequisites

- **Node.js** 18+ and **npm**
- A **WSO2 Identity Platform (Asgardeo)** organization

### 1. Configure WSO2 Identity Platform (Asgardeo)

1. In the Asgardeo Console, create a **Single-Page Application** (React).
2. Under **Protocol**:
   - Grant type: **Code** (with **PKCE** enabled and **Public client** checked)
   - **Authorized redirect URLs:** `http://localhost:5173`
   - **Allowed origins:** `http://localhost:5173`
   - Access Token type: **JWT**
3. Under **API Authorization**, register scopes (`requests:read`, `requests:create`, `requests:approve`, `requests:delete`) and authorize your SPA.
4. Create Application **Roles**:
   - `Member` -> `requests:read`, `requests:create`
   - `Reviewer` -> `requests:read`, `requests:create`, `requests:approve`, `requests:delete`
5. Assign users to `Member` or `Reviewer`.

### 2. Start the Backend API (`server/`)

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Default environment variables in `server/.env`:

```env
PORT=4000
ASGARDEO_BASE_URL=https://api.asgardeo.io/t/your-org
ASGARDEO_ISSUER=https://api.asgardeo.io/t/your-org/oauth2/token
CLIENT_ORIGIN=http://localhost:5173
```

The API listens on `http://localhost:4000` (health check: `GET /api/health`).

### 3. Start the Frontend App (`client/`)

Open a second terminal:

```bash
cd client
cp .env.example .env
# Update VITE_ASGARDEO_BASE_URL and VITE_ASGARDEO_CLIENT_ID in client/.env
npm install
npm run dev
```

Default environment variables in `client/.env`:

```env
VITE_ASGARDEO_BASE_URL=https://api.asgardeo.io/t/your-org
VITE_ASGARDEO_CLIENT_ID=your-spa-client-id
VITE_API_BASE_URL=http://localhost:4000
```

Open `http://localhost:5173` in your browser.

---

## Testing & Verification

Run the automated backend RBAC and validation test suite (`vitest` + `supertest`, using dynamically generated RS256 keys to simulate valid, wrong-issuer, Member, Reviewer, and unassigned tokens):

```bash
npm test
```

Build both the Express backend (`tsc`) and React frontend (`tsc -b && vite build`):

```bash
npm run build
```
