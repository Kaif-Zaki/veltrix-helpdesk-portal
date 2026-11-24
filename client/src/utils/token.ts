export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.');
    if (parts.length < 2) {
      return {};
    }
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseClaimList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function extractScopesFromToken(token: string): string[] {
  const payload = decodeJwtPayload(token);
  const explicit = new Set<string>([...parseClaimList(payload.scope), ...parseClaimList(payload.scp)]);
  return Array.from(explicit);
}

export function extractRolesFromPayload(payload: Record<string, unknown>): string[] {
  const roles = new Set<string>([...parseClaimList(payload.roles), ...parseClaimList(payload.groups)]);
  return Array.from(roles);
}
