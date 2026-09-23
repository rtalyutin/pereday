import { isIP } from 'node:net';

export interface ServerConfig {
  origin: string;
  campaignSlug: string;
  cookieName: string;
  sessionTtlSeconds: number;
  maxBodyBytes: number;
  pageLimit: number;
  rateWindowSeconds: number;
  sessionRateLimit: number;
  writeRateLimit: number;
  rateLimitMode: 'socket' | 'trusted-proxy' | 'ingress';
  trustedProxyAddresses: string[];
  cursorSecret: string;
  csrfSecret: string;
}

export function readConfig(env = process.env): ServerConfig & { databaseUrl: string; port: number; bindHost: string; shutdownGraceSeconds:number } {
  const origin = new URL(env.PEREDAI_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5173');
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
    throw new Error('PEREDAI_PUBLIC_ORIGIN must be an origin');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === '127.0.0.1'))
    throw new Error('HTTPS is required outside 127.0.0.1');
  const required = (key: string) => {
    const value = env[key];
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };
  const positive = (key: string, fallback?: string) => {
    const raw = env[key] ?? fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${key}`);
    return value;
  };
  const local = origin.protocol === 'http:';
  const bindHost = env.PEREDAI_BIND_HOST ?? (local ? '127.0.0.1' : '0.0.0.0');
  if (!isIP(bindHost) || (local && bindHost !== '127.0.0.1'))
    throw new Error('Invalid PEREDAI_BIND_HOST for this origin');
  if (env.PORT && env.PEREDAI_PORT && env.PORT !== env.PEREDAI_PORT)
    throw new Error('PORT and PEREDAI_PORT must match');
  const rateLimitMode = env.PEREDAI_RATE_LIMIT_MODE ?? (local ? 'socket' : '');
  if (!['socket', 'trusted-proxy', 'ingress'].includes(rateLimitMode) || (!local && rateLimitMode === 'socket'))
    throw new Error('HTTPS requires PEREDAI_RATE_LIMIT_MODE=trusted-proxy or ingress');
  const trustedProxyAddresses = env.PEREDAI_TRUSTED_PROXY_ADDRESSES?.split(',').map(x => x.trim()) ?? [];
  if (rateLimitMode === 'trusted-proxy' ?
    trustedProxyAddresses.length < 1 || trustedProxyAddresses.some(x => !isIP(x)) :
    trustedProxyAddresses.length !== 0)
    throw new Error('Invalid PEREDAI_TRUSTED_PROXY_ADDRESSES for rate limit mode');
  const cursorSecret=required('PEREDAI_CURSOR_SECRET');
  const csrfSecret=required('PEREDAI_CSRF_SECRET');
  if (cursorSecret.length < 32 || csrfSecret.length < 32 || cursorSecret === csrfSecret)
    throw new Error('Cursor and CSRF secrets must be distinct and at least 32 characters');
  return {
    origin: origin.origin,
    campaignSlug: env.PEREDAI_CAMPAIGN_SLUG ?? 'peredai',
    databaseUrl: required('DATABASE_URL'),
    port: positive('PORT', env.PEREDAI_PORT ?? '8787'),
    bindHost,
    shutdownGraceSeconds: positive('PEREDAI_SHUTDOWN_GRACE_SECONDS', local ? '10' : undefined),
    cookieName: local ? 'peredai_sid' : '__Host-peredai_sid',
    sessionTtlSeconds: positive('PEREDAI_SESSION_TTL_SECONDS', local ? '86400' : undefined),
    maxBodyBytes: positive('PEREDAI_MAX_BODY_BYTES', local ? '16384' : undefined),
    pageLimit: positive('PEREDAI_PAGE_LIMIT', local ? '20' : undefined),
    rateWindowSeconds: positive('PEREDAI_RATE_WINDOW_SECONDS', local ? '60' : undefined),
    sessionRateLimit: positive('PEREDAI_SESSION_RATE_LIMIT', local ? '10' : undefined),
    writeRateLimit: positive('PEREDAI_WRITE_RATE_LIMIT', local ? '120' : undefined),
    rateLimitMode: rateLimitMode as ServerConfig['rateLimitMode'],
    trustedProxyAddresses,
    cursorSecret,
    csrfSecret,
  };
}
