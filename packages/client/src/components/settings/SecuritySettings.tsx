import { useEffect, useState, type FormEvent } from 'react';
import { useSettings, invalidateSettings } from '../../hooks/useSettings';
import { showToast } from '../../hooks/useToast';

interface IpRule {
  id: string;
  type: 'allow' | 'deny';
  cidr: string;
  description: string;
}

// Same rules as the server (middleware/ipRules.ts), used to warn before saving rules that
// would lock the current session out. Handles IPv4 and IPv6 addresses and CIDR ranges.
function parseIp(raw: string): { bits: 32 | 128; value: bigint } | null {
  const ip = raw.split('%')[0].replace(/^::ffff:/i, '');
  const octet = '(0|[1-9]\\d{0,2})'; // no leading zeros, like the server
  const v4 = ip.match(new RegExp(`^${octet}\\.${octet}\\.${octet}\\.${octet}$`));
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { bits: 32, value: parts.reduce((acc, p) => (acc << 8n) | BigInt(p), 0n) };
  }
  if (!ip.includes(':')) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 ? head.length !== 8 : head.length + tail.length > 7) return null;
  const groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return { bits: 128, value: groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n) };
}

function matchesCidr(ip: string, cidr: string): boolean {
  const [range, prefixStr, ...extra] = cidr.trim().split('/');
  if (/^::ffff:/i.test(range)) return false; // an IPv4-mapped rule is invalid on the server
  const addr = parseIp(ip);
  const base = parseIp(range);
  if (extra.length > 0 || !addr || !base || addr.bits !== base.bits) return false;
  if (prefixStr === undefined) return addr.value === base.value;
  if (!/^\d{1,3}$/.test(prefixStr) || Number(prefixStr) > base.bits) return false;
  const shift = BigInt(base.bits - Number(prefixStr));
  return (addr.value >> shift) === (base.value >> shift);
}

export function SecuritySettings() {
  const { settings, refresh } = useSettings();

  // Session timeout state
  const [idleTimeout, setIdleTimeout] = useState('0');
  const [maxSessionMinutes, setMaxSessionMinutes] = useState('0');
  const [savingSession, setSavingSession] = useState(false);

  // Login lockout state
  const [maxFailed, setMaxFailed] = useState('5');
  const [lockoutMinutes, setLockoutMinutes] = useState('30');
  const [savingLockout, setSavingLockout] = useState(false);

  // IP rules state
  const [ipRulesEnabled, setIpRulesEnabled] = useState(false);
  const [ipRulesMode, setIpRulesMode] = useState<'allowlist' | 'denylist'>('allowlist');
  const [ipRules, setIpRules] = useState<IpRule[]>([]);
  const [newRuleCidr, setNewRuleCidr] = useState('');
  const [newRuleType, setNewRuleType] = useState<'allow' | 'deny'>('allow');
  const [newRuleDesc, setNewRuleDesc] = useState('');
  const [savingIp, setSavingIp] = useState(false);
  const [currentIp, setCurrentIp] = useState<string>('');
  const [ipBlockWarning, setIpBlockWarning] = useState<string | null>(null);

  // Connection limits
  const [maxConnPerUser, setMaxConnPerUser] = useState('10');
  const [savingConn, setSavingConn] = useState(false);

  // Trusted proxies
  const [trustedProxies, setTrustedProxies] = useState('');
  const [proxyDetectionEnabled, setProxyDetectionEnabled] = useState(true);
  const [savingProxy, setSavingProxy] = useState(false);

  // Passkey settings
  const [passkeyEnabled, setPasskeyEnabled] = useState(true);
  const [passkeyInactiveDays, setPasskeyInactiveDays] = useState('90');
  const [savingPasskey, setSavingPasskey] = useState(false);

  useEffect(() => {
    setIdleTimeout(settings['security.idle_timeout_minutes'] ?? '0');
    setMaxSessionMinutes(settings['security.max_session_minutes'] ?? '0');
    setMaxFailed(settings['security.max_failed_logins'] ?? '5');
    setLockoutMinutes(settings['security.lockout_minutes'] ?? '30');
    setIpRulesEnabled(settings['security.ip_rules_enabled'] === 'true');
    setIpRulesMode((settings['security.ip_rules_mode'] as 'allowlist' | 'denylist') ?? 'allowlist');
    setMaxConnPerUser(settings['security.max_connections_per_user'] ?? '10');
    setTrustedProxies(settings['security.trusted_proxies'] ?? '');
    setProxyDetectionEnabled(settings['security.proxy_detection_enabled'] !== 'false');
    setPasskeyEnabled(settings['security.passkey_enabled'] !== 'false');
    setPasskeyInactiveDays(settings['security.passkey_inactive_days'] ?? '90');

  }, [settings]);

  useEffect(() => {
    fetch('/api/v1/settings/ip-rules', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled: boolean; mode: 'allowlist' | 'denylist'; currentIp: string; rules: IpRule[] } | null) => {
        if (!d) return;
        setIpRulesEnabled(d.enabled);
        setIpRulesMode(d.mode);
        setCurrentIp(d.currentIp);
        setIpRules(Array.isArray(d.rules) ? d.rules : []);
      })
      .catch(() => {});
  }, []);

  async function saveSetting(updates: Record<string, string>, onSuccess: () => void, onError: (msg: string) => void) {
    const res = await fetch('/api/v1/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      await refresh();
      invalidateSettings();
      onSuccess();
    } else {
      const d = await res.json();
      onError(d.error || '保存失败。');
    }
  }

  async function handleSessionSave(e: FormEvent) {
    e.preventDefault();
    setSavingSession(true);
    try {
      await saveSetting(
        {
          'security.idle_timeout_minutes': idleTimeout,
          'security.max_session_minutes': maxSessionMinutes,
        },
        () => showToast('已保存。', 'success'),
        (msg) => showToast(msg, 'error'),
      );
    } catch {
      showToast('网络错误。', 'error');
    } finally {
      setSavingSession(false);
    }
  }

  async function handleLockoutSave(e: FormEvent) {
    e.preventDefault();
    setSavingLockout(true);
    try {
      await saveSetting(
        {
          'security.max_failed_logins': maxFailed,
          'security.lockout_minutes': lockoutMinutes,
        },
        () => showToast('已保存。', 'success'),
        (msg) => showToast(msg, 'error'),
      );
    } catch {
      showToast('网络错误。', 'error');
    } finally {
      setSavingLockout(false);
    }
  }

  function addIpRule() {
    if (!newRuleCidr.trim()) return;
    const rule: IpRule = {
      id: crypto.randomUUID(),
      type: newRuleType,
      cidr: newRuleCidr.trim(),
      description: newRuleDesc.trim(),
    };
    setIpRules((prev) => [...prev, rule]);
    setNewRuleCidr('');
    setNewRuleDesc('');
  }

  function removeIpRule(id: string) {
    setIpRules((prev) => prev.filter((r) => r.id !== id));
  }

  function wouldCurrentIpBeBlocked(): boolean {
    if (!ipRulesEnabled || !currentIp) return false;

    const blockedByAllowlist = ipRulesMode === 'allowlist' && !ipRules
      .filter((r) => r.type === 'allow')
      .some((r) => matchesCidr(currentIp, r.cidr));
    const blockedByDenylist = ipRulesMode === 'denylist' && ipRules
      .filter((r) => r.type === 'deny')
      .some((r) => matchesCidr(currentIp, r.cidr));

    return blockedByAllowlist || blockedByDenylist;
  }

  async function persistIpRules() {
    const res = await fetch('/api/v1/settings/ip-rules', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: ipRulesEnabled, mode: ipRulesMode, rules: ipRules }),
    });

    if (res.ok) {
      await refresh();
      invalidateSettings();
      showToast('IP 规则已保存。', 'success');
      return;
    }

    const d = await res.json();
    showToast(d.error || '保存失败。', 'error');
  }

  async function handleIpSave(e: FormEvent) {
    e.preventDefault();
    setSavingIp(true);
    setIpBlockWarning(null);
    try {
      if (wouldCurrentIpBeBlocked()) {
        setIpBlockWarning(`你当前的 IP（${currentIp}）将被这些规则阻止。`);
        return;
      }

      await persistIpRules();
    } catch {
      showToast('网络错误。', 'error');
    } finally {
      setSavingIp(false);
    }
  }

  async function handleConnSave(e: FormEvent) {
    e.preventDefault();
    setSavingConn(true);
    try {
      await saveSetting(
        { 'security.max_connections_per_user': maxConnPerUser },
        () => showToast('已保存。', 'success'),
        (msg) => showToast(msg, 'error'),
      );
    } catch {
      showToast('网络错误。', 'error');
    } finally {
      setSavingConn(false);
    }
  }

  async function handleProxySave(e: FormEvent) {
    e.preventDefault();
    setSavingProxy(true);
    try {
      await saveSetting(
        {
          'security.trusted_proxies': trustedProxies,
          'security.proxy_detection_enabled': String(proxyDetectionEnabled),
        },
        () => showToast('已保存。', 'success'),
        (msg) => showToast(msg, 'error'),
      );
    } catch {
      showToast('网络错误。', 'error');
    } finally {
      setSavingProxy(false);
    }
  }

  async function handlePasskeySave(e: FormEvent) {
    e.preventDefault();
    setSavingPasskey(true);
    try {
      await saveSetting(
        {
          'security.passkey_enabled': String(passkeyEnabled),
          'security.passkey_inactive_days': passkeyInactiveDays,
        },
        () => showToast('已保存。', 'success'),
        (msg) => showToast(msg, 'error'),
      );
    } catch {
      showToast('网络错误。', 'error');
    } finally {
      setSavingPasskey(false);
    }
  }

  return (
    <div className="max-w-lg space-y-8">
      {/* Session Timeouts */}
      <section>
        <h2 className="text-base font-semibold text-text-primary mb-1">会话超时</h2>
        <p className="text-sm text-text-secondary mb-4">控制会话保持活动的时长。设为 0 表示禁用。</p>
        <form onSubmit={handleSessionSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              空闲超时（分钟） <span className="font-normal">— 0 = 禁用</span>
            </label>
            <p className="text-xs text-text-secondary mb-1">会话在无活动达到此分钟数后自动失效。任何 API 请求都会重新计时。</p>
            <input
              type="number"
              min="0"
              value={idleTimeout}
              onChange={(e) => setIdleTimeout(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              最长会话时间（分钟） <span className="font-normal">— 0 = 不限制</span>
            </label>
            <p className="text-xs text-text-secondary mb-1">无论是否活动，会话时长的硬性上限。JWT 令牌将在此分钟数后过期，用户需重新登录。</p>
            <input
              type="number"
              min="0"
              value={maxSessionMinutes}
              onChange={(e) => setMaxSessionMinutes(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={savingSession}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingSession ? '保存中…' : '保存'}
          </button>
        </form>
      </section>

      <hr className="border-border" />

      {/* Passkeys */}
      <section>
        <h2 className="text-base font-semibold text-text-primary mb-1">通行密钥（WebAuthn）</h2>
        <p className="text-sm text-text-secondary mb-4">配置使用通行密钥的免密码两步验证。</p>
        <form onSubmit={handlePasskeySave} className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPasskeyEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                passkeyEnabled ? 'bg-accent' : 'bg-surface-hover border border-border'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  passkeyEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
            <div>
              <span className="text-sm text-text-secondary">启用通行密钥</span>
              <p className="text-xs text-text-secondary">允许用户注册通行密钥用于两步验证。</p>
            </div>
          </div>
          {passkeyEnabled && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                自动禁用闲置通行密钥（天） <span className="font-normal">— 0 = 从不</span>
              </label>
              <p className="text-xs text-text-secondary mb-1">
                出于安全考虑，在此期间内未使用的通行密钥将被自动禁用。
              </p>
              <input
                type="number"
                min="0"
                value={passkeyInactiveDays}
                onChange={(e) => setPasskeyInactiveDays(e.target.value)}
                className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={savingPasskey}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingPasskey ? '保存中…' : '保存'}
          </button>
        </form>
      </section>

      <hr className="border-border" />

      {/* Login & Lockout */}
      <section>
        <h2 className="text-base font-semibold text-text-primary mb-1">登录与锁定</h2>
        <p className="text-sm text-text-secondary mb-4">配置暴力破解防护和账户锁定阈值。</p>
        <form onSubmit={handleLockoutSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              锁定前允许的最大登录失败次数
            </label>
            <input
              type="number"
              min="1"
              value={maxFailed}
              onChange={(e) => setMaxFailed(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              锁定时长（分钟）
            </label>
            <input
              type="number"
              min="1"
              value={lockoutMinutes}
              onChange={(e) => setLockoutMinutes(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={savingLockout}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingLockout ? '保存中…' : '保存'}
          </button>
        </form>
      </section>

      <hr className="border-border" />

      {/* IP Rules */}
      <section>
        <h2 className="text-base font-semibold text-text-primary mb-1">IP 规则</h2>
        <p className="text-sm text-text-secondary mb-4">按 IP 地址或 CIDR 范围限制访问。</p>
        {currentIp && (
          <p className="text-xs text-text-secondary mb-2">当前客户端 IP：<span className="font-mono text-text-primary">{currentIp}</span></p>
        )}
        <form onSubmit={handleIpSave} className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIpRulesEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                ipRulesEnabled ? 'bg-accent' : 'bg-surface-hover border border-border'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  ipRulesEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
            <span className="text-sm text-text-secondary">启用 IP 规则</span>

            {ipRulesEnabled && (
              <select
                value={ipRulesMode}
                onChange={(e) => setIpRulesMode(e.target.value as 'allowlist' | 'denylist')}
                className="ml-4 px-2 py-1 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
              >
                <option value="allowlist">允许列表（仅允许列出的 IP）</option>
                <option value="denylist">拒绝列表（阻止列出的 IP）</option>
              </select>
            )}
          </div>

          {/* Existing rules */}
          {ipRules.length > 0 && (
            <div className="border border-border rounded overflow-hidden">
              {ipRules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-b-0 bg-surface text-sm">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${rule.type === 'allow' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                    {rule.type === 'allow' ? '允许' : '拒绝'}
                  </span>
                  <span className="font-mono text-text-primary flex-1">{rule.cidr}</span>
                  {rule.description && <span className="text-text-secondary truncate max-w-[150px]">{rule.description}</span>}
                  <button
                    type="button"
                    onClick={() => removeIpRule(rule.id)}
                    className="text-text-secondary hover:text-red-400 shrink-0"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add rule */}
          <div className="flex gap-2 items-end flex-wrap">
            <div>
              <label className="block text-xs text-text-secondary mb-1">类型</label>
              <select
                value={newRuleType}
                onChange={(e) => setNewRuleType(e.target.value as 'allow' | 'deny')}
                className="px-2 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
              >
                <option value="allow">允许</option>
                <option value="deny">拒绝</option>
              </select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs text-text-secondary mb-1">CIDR</label>
              <input
                type="text"
                value={newRuleCidr}
                onChange={(e) => setNewRuleCidr(e.target.value)}
                placeholder="192.168.1.0/24"
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm font-mono"
              />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="block text-xs text-text-secondary mb-1">描述（可选）</label>
              <input
                type="text"
                value={newRuleDesc}
                onChange={(e) => setNewRuleDesc(e.target.value)}
                placeholder="办公网络"
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
              />
            </div>
            <button
              type="button"
              onClick={addIpRule}
              className="px-3 py-2 bg-surface-hover border border-border rounded text-sm text-text-primary hover:bg-surface"
            >
              + 添加
            </button>
          </div>

          {ipBlockWarning && (
            <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-300 space-y-2">
              <p>{ipBlockWarning}</p>
              <p>保存这些规则可能会立即阻断你当前的会话，并阻止此后从该 IP 登录。</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setSavingIp(true);
                    try {
                      await persistIpRules();
                      setIpBlockWarning(null);
                    } catch {
                      showToast('网络错误。', 'error');
                    } finally {
                      setSavingIp(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded bg-yellow-500 text-black text-xs font-semibold hover:bg-yellow-400 disabled:opacity-60"
                  disabled={savingIp}
                >
                  {savingIp ? '保存中…' : '仍然保存'}
                </button>
                <button
                  type="button"
                  onClick={() => setIpBlockWarning(null)}
                  className="px-3 py-1.5 rounded border border-yellow-500/50 text-yellow-200 text-xs hover:bg-yellow-500/10"
                  disabled={savingIp}
                >
                  取消
                </button>
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={savingIp}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingIp ? '保存中…' : '保存 IP 规则'}
          </button>
        </form>
      </section>

      <hr className="border-border" />

      {/* Connection Limits */}
      <section>
        <h2 className="text-base font-semibold text-text-primary mb-1">连接限制</h2>
        <p className="text-sm text-text-secondary mb-4">每个用户允许的最大并发会话数。</p>
        <form onSubmit={handleConnSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              每用户最大并发连接数
            </label>
            <select
              value={maxConnPerUser}
              onChange={(e) => setMaxConnPerUser(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            >
              <option value="10">10（默认）</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
          {maxConnPerUser !== '10' && (
            <div className="flex items-start gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-400 text-sm">
              <svg className="shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>
                超过默认值（10）可能使服务器面临资源耗尽的风险。仅在信任你的用户时才提高此限制。
              </span>
            </div>
          )}
          <button
            type="submit"
            disabled={savingConn}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingConn ? '保存中…' : '保存'}
          </button>
        </form>
      </section>

      <hr className="border-border" />

      {/* Trusted Proxies */}
      <section>
        <h2 className="text-base font-semibold text-text-primary mb-1">受信任的代理</h2>
        <p className="text-sm text-text-secondary mb-4">受信任代理的 IP 地址列表，以逗号分隔。</p>
        <form onSubmit={handleProxySave} className="space-y-4">
          <div>
            <input
              type="text"
              value={trustedProxies}
              onChange={(e) => setTrustedProxies(e.target.value)}
              placeholder="10.0.0.1, 10.0.0.2"
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm font-mono"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setProxyDetectionEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                proxyDetectionEnabled ? 'bg-accent' : 'bg-surface-hover border border-border'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  proxyDetectionEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
            <div>
              <span className="text-sm text-text-secondary">代理检测通知</span>
              <p className="text-xs text-text-secondary">启用后，若用户的连接经由不受信任的代理到达，将在登录时通知用户。</p>
            </div>
          </div>
          <button
            type="submit"
            disabled={savingProxy}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingProxy ? '保存中…' : '保存'}
          </button>
        </form>
      </section>
    </div>
  );
}
