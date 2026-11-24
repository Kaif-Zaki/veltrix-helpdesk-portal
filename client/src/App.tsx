import {FormEvent, useCallback, useEffect, useMemo, useState} from 'react';
import {SignedIn, SignedOut, SignInButton, SignOutButton, useAsgardeo} from '@asgardeo/react';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Inbox,
  Info,
  KeyRound,
  Laptop,
  Layers,
  LifeBuoy,
  LockKeyhole,
  LogIn,
  LogOut,
  MessageSquare,
  Package,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Ticket,
  Trash2,
  User,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  createHelpdeskRequest,
  deleteHelpdeskRequest,
  fetchCurrentUser,
  fetchRequests,
  reviewHelpdeskRequest,
  type HelpdeskRequest,
  type RequestCategory,
  type RequestPriority,
  type RequestStatus,
} from './api/helpdeskApi';
import {extractRolesFromPayload, extractScopesFromToken} from './utils/token';

function CategoryIcon({category}: {category: RequestCategory}) {
  switch (category) {
    case 'access':
      return <KeyRound size={12} />;
    case 'hardware':
      return <Laptop size={12} />;
    case 'software':
      return <Package size={12} />;
    case 'support':
    default:
      return <LifeBuoy size={12} />;
  }
}

function StatusIcon({status}: {status: RequestStatus}) {
  switch (status) {
    case 'approved':
      return <CheckCircle2 size={12} />;
    case 'rejected':
      return <XCircle size={12} />;
    case 'pending':
    default:
      return <Clock size={12} />;
  }
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

function hasLikelyStoredSession(): boolean {
  try {
    const stores = [window.localStorage, window.sessionStorage];
    for (const store of stores) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (!key) {
          continue;
        }
        const raw = store.getItem(key);
        if (raw && raw.includes('access_token') && raw.includes('id_token')) {
          return true;
        }
      }
    }
  } catch {
    // Ignore storage access restrictions
  }
  return false;
}

export default function App() {
  const {isSignedIn, isLoading, getAccessToken, getDecodedIdToken} = useAsgardeo();

  const [requests, setRequests] = useState<HelpdeskRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | RequestStatus>('all');
  const [viewScope, setViewScope] = useState<'all' | 'mine'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [userLabel, setUserLabel] = useState<string>('');
  const [userSub, setUserSub] = useState<string>('');
  const [userIdentifiers, setUserIdentifiers] = useState<string[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileComposeOpen, setMobileComposeOpen] = useState<boolean>(false);

  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [category, setCategory] = useState<RequestCategory>('access');
  const [priority, setPriority] = useState<RequestPriority>('medium');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canRead = scopes.includes('requests:read');
  const canCreate = scopes.includes('requests:create');
  const canApprove = scopes.includes('requests:approve');
  const canDelete = scopes.includes('requests:delete');

  const roleKind: 'reviewer' | 'member' | 'none' =
    canApprove || canDelete ? 'reviewer' : canRead || canCreate ? 'member' : 'none';

  const loadWorkspace = useCallback(async () => {
    if (!isSignedIn) {
      return;
    }
    setLoadingData(true);
    setError(null);
    try {
      const [token, idToken] = await Promise.all([getAccessToken(), getDecodedIdToken()]);
      const clientScopes = extractScopesFromToken(token);
      const idTokenRoles = idToken ? extractRolesFromPayload(idToken as Record<string, unknown>) : [];

      let effectiveScopes = clientScopes;
      let effectiveRoles = idTokenRoles;
      let verifiedSub = typeof idToken?.sub === 'string' ? idToken.sub : '';
      let verifiedEmail = typeof idToken?.email === 'string' ? idToken.email : '';
      let verifiedUsername = typeof idToken?.username === 'string' ? idToken.username : '';

      try {
        const profile = await fetchCurrentUser(token);
        effectiveScopes = profile.scopes.length > 0 ? profile.scopes : clientScopes;
        effectiveRoles = profile.roles.length > 0 ? profile.roles : idTokenRoles;
        verifiedSub = profile.sub || verifiedSub;
        verifiedEmail = profile.email || verifiedEmail;
        verifiedUsername = profile.username || verifiedUsername;
      } catch (profileErr) {
        // Surface backend connection or JWT verification failures cleanly
        throw profileErr;
      }

      setScopes(effectiveScopes);
      setUserRoles(effectiveRoles);
      setUserSub(verifiedSub);

      const display =
        verifiedEmail ||
        verifiedUsername ||
        (typeof idToken?.name === 'string' && idToken.name) ||
        verifiedSub ||
        'Authenticated User';
      setUserLabel(display);

      const identifiers = [verifiedEmail, verifiedUsername, verifiedSub, display]
        .filter((val): val is string => Boolean(val && val.trim()))
        .map((val) => val.toLowerCase());
      setUserIdentifiers(Array.from(new Set(identifiers)));

      if (effectiveScopes.includes('requests:read')) {
        const items = await fetchRequests(token);
        setRequests(items);
      } else {
        setRequests([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load helpdesk workspace.');
    } finally {
      setLoadingData(false);
    }
  }, [getAccessToken, getDecodedIdToken, isSignedIn]);

  const hasOAuthCodeInUrl = new URLSearchParams(window.location.search).has('code');
  const [hasStoredSessionHint] = useState<boolean>(() => hasLikelyStoredSession());
  const [authWaitTimedOut, setAuthWaitTimedOut] = useState<boolean>(false);

  const authPending =
    !isSignedIn && !authWaitTimedOut && (hasOAuthCodeInUrl || (hasStoredSessionHint && isLoading));

  useEffect(() => {
    if (isSignedIn || authWaitTimedOut || (!hasOAuthCodeInUrl && !hasStoredSessionHint)) {
      return;
    }
    const timeoutMs = hasOAuthCodeInUrl ? 4500 : 1500;
    const timer = window.setTimeout(() => {
      setAuthWaitTimedOut(true);
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [authWaitTimedOut, hasOAuthCodeInUrl, hasStoredSessionHint, isSignedIn]);

  useEffect(() => {
    if (authPending) {
      return;
    }

    if (isSignedIn) {
      const currentState = window.history.state as {veltrixAuth?: string} | null;
      if (
        window.location.pathname !== '/dashboard' ||
        window.location.search !== '' ||
        window.location.hash !== ''
      ) {
        window.history.replaceState({veltrixAuth: 'dashboard'}, '', '/dashboard');
      }
      if (currentState?.veltrixAuth !== 'guard') {
        window.history.pushState({veltrixAuth: 'guard'}, '', '/dashboard');
      }

      const handlePopState = () => {
        window.history.pushState({veltrixAuth: 'guard'}, '', '/dashboard');
      };

      const handlePageShow = (event: PageTransitionEvent) => {
        if (event.persisted) {
          window.history.replaceState({veltrixAuth: 'guard'}, '', '/dashboard');
        }
      };

      window.addEventListener('popstate', handlePopState);
      window.addEventListener('pageshow', handlePageShow);

      return () => {
        window.removeEventListener('popstate', handlePopState);
        window.removeEventListener('pageshow', handlePageShow);
      };
    }

    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error_description') || params.get('error');
    if (oauthError) {
      setError(`Sign-in error: ${oauthError}`);
      window.history.replaceState(null, '', '/');
      return;
    }

    if (params.has('code')) {
      if (authWaitTimedOut) {
        window.history.replaceState(null, '', '/');
        setError('Previous sign-in callback expired or was already used. Please sign in again.');
      }
      return;
    }

    const allowedHashes = new Set(['#workflow', '#governance', '#security']);
    const cleanHash = allowedHashes.has(window.location.hash) ? window.location.hash : '';

    if (window.location.pathname !== '/' || window.location.hash !== cleanHash) {
      window.history.replaceState(null, '', `/${cleanHash}`);
    }
  }, [authPending, authWaitTimedOut, isSignedIn]);

  useEffect(() => {
    if (isSignedIn) {
      void loadWorkspace();
    } else {
      setRequests([]);
      setScopes([]);
      setUserRoles([]);
      setUserLabel('');
      setUserSub('');
      setUserIdentifiers([]);
      setConfirmDeleteId(null);
      setReviewNotes({});
    }
  }, [isSignedIn, loadWorkspace]);

  const isOwnRequest = useCallback(
    (createdBy: string) => {
      const normalized = createdBy.trim().toLowerCase();
      return normalized.length > 0 && userIdentifiers.includes(normalized);
    },
    [userIdentifiers],
  );

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canCreate) {
      setError('Missing required scope "requests:create" to submit a request.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const token = await getAccessToken();
      const created = await createHelpdeskRequest(token, {title, description, category, priority});
      setRequests((prev) => [created, ...prev]);
      setTitle('');
      setDescription('');
      setCategory('access');
      setPriority('medium');
      setMobileComposeOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create request.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReview(id: string, status: 'approved' | 'rejected') {
    if (!canApprove) {
      setError('Missing required scope "requests:approve" for Reviewer actions.');
      return;
    }
    setError(null);
    setBusyRequestId(id);
    try {
      const token = await getAccessToken();
      const customNote = reviewNotes[id]?.trim();
      const note =
        customNote || (status === 'approved' ? 'Approved via Reviewer console' : 'Declined by Reviewer');
      const updated = await reviewHelpdeskRequest(token, id, status, note);
      setRequests((prev) => prev.map((item) => (item.id === id ? updated : item)));
      setReviewNotes((prev) => {
        const next = {...prev};
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update request.');
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!canDelete) {
      setError('Missing required scope "requests:delete" for deletion.');
      return;
    }
    setError(null);
    setBusyRequestId(id);
    try {
      const token = await getAccessToken();
      await deleteHelpdeskRequest(token, id);
      setRequests((prev) => prev.filter((item) => item.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete request.');
    } finally {
      setBusyRequestId(null);
    }
  }

  const scopedRequests = useMemo(
    () => (viewScope === 'mine' ? requests.filter((r) => isOwnRequest(r.createdBy)) : requests),
    [isOwnRequest, requests, viewScope],
  );

  const pendingCount = useMemo(
    () => scopedRequests.filter((r) => r.status === 'pending').length,
    [scopedRequests],
  );
  const approvedCount = useMemo(
    () => scopedRequests.filter((r) => r.status === 'approved').length,
    [scopedRequests],
  );
  const rejectedCount = useMemo(
    () => scopedRequests.filter((r) => r.status === 'rejected').length,
    [scopedRequests],
  );

  const visibleRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedRequests.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.createdBy.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [scopedRequests, searchQuery, statusFilter]);

  const filterCounts: Record<'all' | RequestStatus, number> = {
    all: scopedRequests.length,
    pending: pendingCount,
    approved: approvedCount,
    rejected: rejectedCount,
  };

  return (
    <div className="app-shell">
      <div className="container">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <Layers size={18} />
            </div>
            <div className="brand-text">
              <h1 className="brand-title">Veltrix Helpdesk</h1>
              <p className="brand-sub">WSO2 Identity Platform · Access &amp; Operations</p>
            </div>
          </div>

          {!authPending && (
            <>
              <SignedOut>
                <nav className="topbar-nav" aria-label="Primary">
                  <a href="#workflow" className="nav-link">
                    Workflow
                  </a>
                  <a href="#governance" className="nav-link">
                    Role Matrix
                  </a>
                  <a href="#security" className="nav-link">
                    Security
                  </a>
                </nav>
                <SignInButton className="btn btn-primary">
                  <LogIn size={14} />
                  <span>Sign in</span>
                </SignInButton>
              </SignedOut>

              <SignedIn>
                <div className="user-controls">
                  {userLabel && (
                    <div className="user-identity" title={userLabel}>
                      <User size={13} />
                      <span>{userLabel}</span>
                    </div>
                  )}
                  <span
                    className={`role-pill ${
                      roleKind === 'reviewer'
                        ? 'role-reviewer'
                        : roleKind === 'member'
                          ? 'role-member'
                          : 'role-restricted'
                    }`}
                  >
                    {roleKind === 'reviewer' ? (
                      <ShieldCheck size={13} />
                    ) : roleKind === 'member' ? (
                      <UserCheck size={13} />
                    ) : (
                      <LockKeyhole size={13} />
                    )}
                    {roleKind === 'reviewer' ? 'Reviewer' : roleKind === 'member' ? 'Member' : 'No Role'}
                  </span>
                  <SignOutButton className="btn">
                    <LogOut size={14} />
                    <span>Sign out</span>
                  </SignOutButton>
                </div>
              </SignedIn>
            </>
          )}
        </header>

        {authPending ? (
          <div className="auth-loading-shell" role="status" aria-live="polite">
            <div className="auth-loading-card">
              <div className="auth-loading-icon" aria-hidden="true">
                <RefreshCw size={20} className="spin" />
              </div>
              <h2 className="auth-loading-title">
                {hasOAuthCodeInUrl ? 'Completing sign-in…' : 'Restoring your session…'}
              </h2>
              <p className="auth-loading-sub">
                Verifying your Veltrix identity session with WSO2 Identity Platform.
              </p>
            </div>
          </div>
        ) : (
          <>
            <SignedOut>
              <div className="landing-stack">
                {error && (
                  <div className="notice notice-error" role="alert">
                    <AlertCircle size={16} style={{flexShrink: 0, marginTop: '2px'}} />
                    <span>{error}</span>
                  </div>
                )}
            <div className="hero-split">
              <section className="signin-editorial">
                <div>
                  <span className="eyebrow">
                    <LockKeyhole size={12} /> Veltrix Operations · OIDC + RBAC
                  </span>
                  <h2 className="signin-title">Internal access &amp; IT requests, governed by verified identity.</h2>
                  <p className="signin-desc">
                    A centralized portal for Veltrix engineering and operations teams to request cloud access, software
                    licenses, and developer hardware—backed by WSO2 Identity Platform roles and scope-enforced APIs.
                  </p>
                  <div className="hero-actions">
                    <SignInButton className="btn btn-copper signin-cta" style={{width: 'auto', minHeight: '42px'}}>
                      <span>{isLoading ? 'Connecting...' : 'Sign in with WSO2 Identity Platform'}</span>
                      <ArrowRight size={15} />
                    </SignInButton>
                    <a href="#workflow" className="btn btn-outline-cream" style={{minHeight: '42px'}}>
                      How it works
                    </a>
                  </div>
                </div>

                <div className="trust-row">
                  <span className="trust-item">
                    <Check size={13} color="#cc8b65" /> OAuth 2.0 + PKCE
                  </span>
                  <span className="trust-item">
                    <Check size={13} color="#cc8b65" /> Role-Scoped JWT Tokens
                  </span>
                  <span className="trust-item">
                    <Check size={13} color="#cc8b65" /> JWKS Signature Verification
                  </span>
                </div>
              </section>

              <aside className="preview-card" aria-label="Portal workspace preview">
                <div>
                  <div className="preview-header">
                    <div className="preview-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className="role-pill role-reviewer">
                      <ShieldCheck size={12} /> Live Queue Preview
                    </span>
                  </div>

                  <div className="request-list" style={{marginTop: '14px'}}>
                    <div className="preview-ticket">
                      <div className="preview-ticket-top">
                        <span className="preview-ticket-title">Staging DB Read Access</span>
                        <span className="status-badge status-pending">
                          <Clock size={11} /> Pending
                        </span>
                      </div>
                      <div className="preview-ticket-sub">
                        Temporary read-only credentials for sprint analytics debugging · High priority
                      </div>
                    </div>

                    <div className="preview-ticket">
                      <div className="preview-ticket-top">
                        <span className="preview-ticket-title">JetBrains IntelliJ License</span>
                        <span className="status-badge status-approved">
                          <CheckCircle2 size={11} /> Approved
                        </span>
                      </div>
                      <div className="preview-ticket-sub">
                        Annual IDE license renewal · Approved by Reviewer with <code>requests:approve</code>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="role-row" style={{marginBottom: 0}}>
                  <KeyRound size={15} className="role-row-icon" />
                  <div>
                    <strong>Zero-trust API enforcement</strong>
                    <span>Sign in as a Member or Reviewer to test real scope-based access control.</span>
                  </div>
                </div>
              </aside>
            </div>

            <section id="workflow" className="section-block">
              <div className="section-head">
                <div>
                  <div className="section-kicker">Workflow</div>
                  <h3 className="section-heading">From sign-in to audited approval in three steps</h3>
                </div>
                <p className="section-sub">
                  Every action in the portal maps directly to OAuth 2.0 scopes issued by your Veltrix organization.
                </p>
              </div>

              <div className="steps-grid">
                <article className="step-card">
                  <div className="step-top">
                    <span className="step-num">01</span>
                    <div className="step-icon">
                      <LogIn size={15} />
                    </div>
                  </div>
                  <h4>Authenticate via OIDC</h4>
                  <p>
                    Users sign in through WSO2 Identity Platform using Authorization Code flow with PKCE. No passwords
                    touch the Express API.
                  </p>
                </article>

                <article className="step-card">
                  <div className="step-top">
                    <span className="step-num">02</span>
                    <div className="step-icon">
                      <Send size={15} />
                    </div>
                  </div>
                  <h4>Submit Scoped Requests</h4>
                  <p>
                    Members holding <code>requests:create</code> submit categorized access, software, hardware, or
                    support tickets into the shared queue.
                  </p>
                </article>

                <article className="step-card">
                  <div className="step-top">
                    <span className="step-num">03</span>
                    <div className="step-icon">
                      <ShieldCheck size={15} />
                    </div>
                  </div>
                  <h4>Verify &amp; Approve</h4>
                  <p>
                    Reviewers with <code>requests:approve</code> and <code>requests:delete</code> validate requests while
                    the backend verifies every JWT via JWKS.
                  </p>
                </article>
              </div>
            </section>

            <section id="governance" className="section-block">
              <div className="section-head">
                <div>
                  <div className="section-kicker">Governance &amp; Categories</div>
                  <h3 className="section-heading">Clear role boundaries and supported request types</h3>
                </div>
              </div>

              <div className="governance-grid">
                <div className="role-matrix" style={{marginBottom: 0}}>
                  <div className="role-row">
                    <UserCheck size={17} className="role-row-icon" />
                    <div>
                      <strong>Member Role · Standard Contributors</strong>
                      <span>
                        Issued <code>requests:read</code> and <code>requests:create</code>. Can browse the queue,
                        search tickets, and submit new requests. Approval and delete routes return <code>403</code>.
                      </span>
                    </div>
                  </div>
                  <div className="role-row">
                    <ShieldCheck size={17} className="role-row-icon" />
                    <div>
                      <strong>Reviewer Role · Operations &amp; Leads</strong>
                      <span>
                        Issued <code>requests:read</code>, <code>requests:create</code>, <code>requests:approve</code>,
                        and <code>requests:delete</code>. Can approve, reject with notes, and clean up resolved tickets.
                      </span>
                    </div>
                  </div>
                </div>

                <div className="category-list">
                  <div className="category-item">
                    <div className="category-icon-box">
                      <KeyRound size={15} />
                    </div>
                    <div>
                      <strong>Access &amp; Cloud Environments</strong>
                      <span>Staging databases, Kubernetes namespaces, VPN profiles, and temporary elevated roles.</span>
                    </div>
                  </div>
                  <div className="category-item">
                    <div className="category-icon-box">
                      <Package size={15} />
                    </div>
                    <div>
                      <strong>Software &amp; Tooling Licenses</strong>
                      <span>IDE seats, SaaS developer subscriptions, design tools, and API sandbox keys.</span>
                    </div>
                  </div>
                  <div className="category-item">
                    <div className="category-icon-box">
                      <Laptop size={15} />
                    </div>
                    <div>
                      <strong>Hardware &amp; Engineering Support</strong>
                      <span>Workstation upgrades, test devices, and internal infrastructure troubleshooting.</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section id="security" className="security-banner">
              <div>
                <h3>Ready to try the Veltrix RBAC workflow?</h3>
                <p>
                  Every API endpoint verifies JWT signatures against{' '}
                  <code>https://api.asgardeo.io/t/veltrix/oauth2/jwks</code>, checks the token issuer, and validates
                  per-route scopes before mutating state.
                </p>
              </div>
              <SignInButton className="btn btn-copper" style={{minHeight: '42px', padding: '10px 18px'}}>
                <span>{isLoading ? 'Connecting...' : 'Sign in to Portal'}</span>
                <ArrowRight size={15} />
              </SignInButton>
            </section>
          </div>
        </SignedOut>

        <SignedIn>
          {error && (
            <div className="notice notice-error" role="alert">
              <AlertCircle size={16} style={{flexShrink: 0, marginTop: '2px'}} />
              <span>{error}</span>
            </div>
          )}

          {roleKind === 'none' && !loadingData && (
            <div className="notice notice-error" role="alert">
              <LockKeyhole size={16} style={{flexShrink: 0, marginTop: '2px'}} />
              <span>
                No helpdesk scopes or roles were granted to this token. Assign the <strong>Member</strong> or{' '}
                <strong>Reviewer</strong> role in WSO2 Identity Platform (<code>veltrix</code>) to access requests.
              </span>
            </div>
          )}

          {roleKind === 'member' && (
            <div className="notice notice-info">
              <Info size={16} color="#7a4426" style={{flexShrink: 0, marginTop: '2px'}} />
              <span>
                Signed in as <strong>Member</strong> (<code>requests:read</code>, <code>requests:create</code>).
                Approval and deletion controls require the <strong>Reviewer</strong> role.
              </span>
            </div>
          )}

          <section className="kpi-strip" aria-label="Request summary">
            <div className="kpi-cell">
              <div>
                <div className="kpi-label">Total</div>
                <div className="kpi-value">{scopedRequests.length}</div>
              </div>
              <div className="kpi-icon" aria-hidden="true">
                <Ticket size={16} />
              </div>
            </div>
            <div className="kpi-cell">
              <div>
                <div className="kpi-label">Pending</div>
                <div className="kpi-value">{pendingCount}</div>
              </div>
              <div className="kpi-icon" aria-hidden="true">
                <Clock size={16} />
              </div>
            </div>
            <div className="kpi-cell">
              <div>
                <div className="kpi-label">Approved</div>
                <div className="kpi-value">{approvedCount}</div>
              </div>
              <div className="kpi-icon" aria-hidden="true">
                <CheckCircle2 size={16} />
              </div>
            </div>
            <div className="kpi-cell">
              <div>
                <div className="kpi-label">Rejected</div>
                <div className="kpi-value">{rejectedCount}</div>
              </div>
              <div className="kpi-icon" aria-hidden="true">
                <XCircle size={16} />
              </div>
            </div>
          </section>

          <div className="mobile-compose-bar">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setMobileComposeOpen((prev) => !prev)}
            >
              {mobileComposeOpen ? <X size={15} /> : <Plus size={15} />}
              <span>{mobileComposeOpen ? 'Close Form' : 'New Request'}</span>
            </button>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => void loadWorkspace()}
              disabled={loadingData}
              aria-label="Refresh requests"
            >
              <RefreshCw size={15} className={loadingData ? 'spin' : ''} />
            </button>
          </div>

          <div className="workspace-grid">
            <aside className={`panel panel-sticky ${mobileComposeOpen ? '' : 'compose-hidden-mobile'}`}>
              <div className="panel-header">
                <h3 className="panel-title">
                  <Plus size={16} color="#013328" />
                  <span>New Request</span>
                </h3>
                <button
                  type="button"
                  className="btn btn-icon mobile-close-btn"
                  onClick={() => setMobileComposeOpen(false)}
                  aria-label="Close request form"
                >
                  <X size={15} />
                </button>
              </div>

              {!canCreate && (
                <div className="form-locked-banner">
                  <LockKeyhole size={14} style={{flexShrink: 0, marginTop: '2px'}} />
                  <span>
                    Read-only mode: submitting tickets requires the <code>requests:create</code> scope.
                  </span>
                </div>
              )}

              <form onSubmit={handleCreate}>
                <div className="field">
                  <label htmlFor="req-title">Title</label>
                  <input
                    id="req-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Staging Kubernetes Access"
                    required
                    minLength={3}
                    disabled={!canCreate || submitting}
                  />
                </div>

                <div className="field">
                  <label htmlFor="req-desc">Description</label>
                  <textarea
                    id="req-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Explain what access or resource you need..."
                    required
                    minLength={5}
                    disabled={!canCreate || submitting}
                  />
                </div>

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="req-cat">Category</label>
                    <select
                      id="req-cat"
                      value={category}
                      onChange={(e) => setCategory(e.target.value as RequestCategory)}
                      disabled={!canCreate || submitting}
                    >
                      <option value="access">Access</option>
                      <option value="software">Software</option>
                      <option value="hardware">Hardware</option>
                      <option value="support">Support</option>
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="req-priority">Priority</label>
                    <select
                      id="req-priority"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as RequestPriority)}
                      disabled={!canCreate || submitting}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{width: '100%', minHeight: '40px'}}
                  disabled={submitting || !canCreate}
                >
                  <Plus size={15} />
                  <span>{submitting ? 'Submitting...' : 'Submit Request'}</span>
                </button>
              </form>

              <div className="scopes-box">
                <div className="scopes-header">
                  <span className="kpi-label">
                    {userRoles.length > 0 ? `Roles (${userRoles.join(', ')}) · Scopes` : 'Granted JWT Scopes'}
                  </span>
                  <KeyRound size={13} color="#7a4426" />
                </div>
                <div className="scope-list">
                  {scopes.map((scope) => (
                    <span key={scope} className="scope-chip">
                      {scope}
                    </span>
                  ))}
                </div>
              </div>
            </aside>

            <main className="panel">
              <div className="queue-toolbar">
                <div className="queue-toolbar-top">
                  <h3 className="panel-title">
                    <Ticket size={16} color="#013328" />
                    <span>Request Queue</span>
                  </h3>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '8px',
                      flex: 1,
                      justifyContent: 'flex-end',
                    }}
                  >
                    <div className="scope-toggle-group" role="group" aria-label="Ticket ownership filter">
                      <button
                        type="button"
                        className={`scope-toggle-btn ${viewScope === 'all' ? 'scope-toggle-btn-active' : ''}`}
                        onClick={() => setViewScope('all')}
                      >
                        All Queue
                      </button>
                      <button
                        type="button"
                        className={`scope-toggle-btn ${viewScope === 'mine' ? 'scope-toggle-btn-active' : ''}`}
                        onClick={() => setViewScope('mine')}
                      >
                        My Requests
                      </button>
                    </div>
                    <div className="search-wrap">
                      <Search size={14} className="search-icon" />
                      <input
                        type="search"
                        className="search-input"
                        placeholder="Search requests..."
                        aria-label="Search requests"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-icon"
                      onClick={() => void loadWorkspace()}
                      disabled={loadingData}
                      title="Refresh requests"
                      aria-label="Refresh requests"
                    >
                      <RefreshCw size={14} className={loadingData ? 'spin' : ''} />
                    </button>
                  </div>
                </div>

                <div className="filter-tabs" role="tablist" aria-label="Filter by status">
                  {(['all', 'pending', 'approved', 'rejected'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={statusFilter === tab}
                      className={`tab-btn ${statusFilter === tab ? 'tab-btn-active' : ''}`}
                      onClick={() => setStatusFilter(tab)}
                    >
                      <span>{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
                      <span className="tab-count">{filterCounts[tab]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {loadingData ? (
                <div className="empty-state">
                  <RefreshCw size={20} className="spin" />
                  <span>Loading requests...</span>
                </div>
              ) : !canRead ? (
                <div className="empty-state">
                  <LockKeyhole size={22} />
                  <span>
                    Your account does not hold the <code>requests:read</code> scope.
                  </span>
                </div>
              ) : visibleRequests.length === 0 ? (
                <div className="empty-state">
                  <Inbox size={22} />
                  <span>No requests match your current filter.</span>
                </div>
              ) : (
                <div className="request-list">
                  {visibleRequests.map((item) => (
                    <article key={item.id} className="request-card">
                      <div className="request-top">
                        <h4 className="request-title">{item.title}</h4>
                        <span className={`status-badge status-${item.status}`}>
                          <StatusIcon status={item.status} />
                          <span>{item.status}</span>
                        </span>
                      </div>

                      <p className="request-desc">{item.description}</p>

                      <div className="request-meta">
                        <span className="meta-pill">
                          <CategoryIcon category={item.category} />
                          <span>{item.category}</span>
                        </span>
                        <span className={`meta-pill ${item.priority === 'high' ? 'priority-high' : ''}`}>
                          {item.priority} priority
                        </span>
                        <span className="meta-inline">
                          <User size={12} />
                          <span>{item.createdBy === userSub && userLabel ? userLabel : item.createdBy}</span>
                          {isOwnRequest(item.createdBy) && <span className="owner-chip">You</span>}
                        </span>
                        <span className="meta-inline">
                          <Calendar size={12} />
                          <span>{formatShortDate(item.createdAt)}</span>
                        </span>
                      </div>

                      {(item.reviewNote || item.reviewedBy) && (
                        <div className="request-note">
                          <MessageSquare size={13} style={{flexShrink: 0, marginTop: '2px'}} />
                          <span>
                            <strong>
                              {item.reviewedBy === userSub && userLabel ? userLabel : item.reviewedBy ?? 'Reviewer'}
                            </strong>
                            {item.reviewedAt ? ` · ${formatShortDate(item.reviewedAt)}` : ''}:{' '}
                            {item.reviewNote ?? `Marked as ${item.status}.`}
                          </span>
                        </div>
                      )}

                      {((canApprove && item.status === 'pending') || canDelete) && (
                        <div className="review-controls">
                          {canApprove && item.status === 'pending' && (
                            <input
                              type="text"
                              className="review-note-input"
                              placeholder="Optional review note (e.g. Approved for 7 days)..."
                              aria-label={`Review note for ${item.title}`}
                              value={reviewNotes[item.id] ?? ''}
                              disabled={busyRequestId === item.id}
                              onChange={(e) =>
                                setReviewNotes((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                            />
                          )}
                          <div className="review-actions-row">
                            {canApprove && item.status === 'pending' && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-approve"
                                  disabled={busyRequestId === item.id}
                                  onClick={() => void handleReview(item.id, 'approved')}
                                >
                                  <CheckCircle2 size={14} />
                                  <span>{busyRequestId === item.id ? 'Updating...' : 'Approve'}</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-reject"
                                  disabled={busyRequestId === item.id}
                                  onClick={() => void handleReview(item.id, 'rejected')}
                                >
                                  <XCircle size={14} />
                                  <span>Reject</span>
                                </button>
                              </>
                            )}
                            {canDelete &&
                              (confirmDeleteId === item.id ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-danger-solid"
                                    disabled={busyRequestId === item.id}
                                    onClick={() => void handleDelete(item.id)}
                                  >
                                    <Trash2 size={14} />
                                    <span>{busyRequestId === item.id ? 'Deleting...' : 'Confirm Delete'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={busyRequestId === item.id}
                                    onClick={() => setConfirmDeleteId(null)}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-ghost-danger"
                                  disabled={busyRequestId === item.id}
                                  onClick={() => setConfirmDeleteId(item.id)}
                                >
                                  <Trash2 size={14} />
                                  <span>Delete</span>
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </main>
          </div>
        </SignedIn>
          </>
        )}
      </div>

      <footer className="footer">
        <span>Veltrix Helpdesk Portal · Secured by WSO2 Identity Platform</span>
        <span>OAuth 2.0 + OIDC · JWKS Verified</span>
      </footer>
    </div>
  );
}
