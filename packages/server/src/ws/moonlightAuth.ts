import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import { verifyToken } from '../services/jwt.js';
import { checkAndTouchSession } from '../services/loginSession.js';
import { userHasPermission } from '../services/permissions.js';
import { isMoonlightWebAvailable } from '../services/moonlightWeb.js';

export type MoonlightAuthOk = { ok: true; userId: string };
export type MoonlightAuthFail = { ok: false; status: 401 | 403 | 503; error: string };
export type MoonlightAuthResult = MoonlightAuthOk | MoonlightAuthFail;

/** Same cookie name as the rest of Gatwy (`authRequired` / login cookie). */
export const MOONLIGHT_COOKIE = 'gatwy_token';

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function readToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
  const cookie = parseCookie(req.headers.cookie, MOONLIGHT_COOKIE);
  return bearer ?? cookie ?? null;
}

/**
 * Authorize HTTP GET/POST /mlw/* and the /mlw WebSocket upgrade the same way:
 * JWT (cookie or Bearer) + live login session + protocols.moonlight + runtime present.
 */
export function authorizeMoonlightAccess(req: IncomingMessage): MoonlightAuthResult {
  try {
    const token = readToken(req);
    if (!token) {
      return { ok: false, status: 401, error: '需要登录' };
    }

    const payload = verifyToken(token);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const status = checkAndTouchSession(tokenHash, false);
    if (status === 'revoked') {
      return { ok: false, status: 401, error: '会话已被撤销' };
    }
    if (status === 'idle_expired') {
      return { ok: false, status: 401, error: '会话因长时间无操作已过期' };
    }

    if (!userHasPermission(payload.userId, 'protocols.moonlight')) {
      return { ok: false, status: 403, error: '无权使用 Moonlight 协议' };
    }

    if (!isMoonlightWebAvailable()) {
      return { ok: false, status: 503, error: '当前安装未提供 Moonlight 运行环境' };
    }

    return { ok: true, userId: payload.userId };
  } catch {
    return { ok: false, status: 401, error: '令牌无效或已过期' };
  }
}
