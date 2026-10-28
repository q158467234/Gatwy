import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { invalidateSettings } from '../../hooks/useSettings.js';
import { showToast } from '../../hooks/useToast';
import { BASE_PATH } from '../../lib/basePath';

interface AuthSettings {
  'auth.local_enabled': string;
  'auth.ldap_enabled': string;
  'auth.ldap_url': string;
  'auth.ldap_bind_dn': string;
  'auth.ldap_search_base': string;
  'auth.ldap_user_filter': string;
  'auth.ldap_username_attr': string;
  'auth.ldap_email_attr': string;
  'auth.ldap_display_name_attr': string;
  'auth.ldap_admin_group_dn': string;
  'auth.ldap_tls_reject_unauthorized': string;
  'auth.oidc_enabled': string;
  'auth.oidc_provider_url': string;
  'auth.oidc_client_id': string;
  'auth.oidc_redirect_uri': string;
  'auth.oidc_scope': string;
  'auth.oidc_display_name_claim': string;
  'auth.oidc_username_claim': string;
  'auth.oidc_admin_group_claim': string;
  'auth.oidc_admin_group_value': string;
  'auth.oidc_button_label': string;
  'auth.oidc_token_auth_method': string;
}

const DEFAULTS: AuthSettings = {
  'auth.local_enabled': 'true',
  'auth.ldap_enabled': 'false',
  'auth.ldap_url': '',
  'auth.ldap_bind_dn': '',
  'auth.ldap_search_base': '',
  'auth.ldap_user_filter': '(uid={username})',
  'auth.ldap_username_attr': 'uid',
  'auth.ldap_email_attr': 'mail',
  'auth.ldap_display_name_attr': 'cn',
  'auth.ldap_admin_group_dn': '',
  'auth.ldap_tls_reject_unauthorized': 'true',
  'auth.oidc_enabled': 'false',
  'auth.oidc_provider_url': '',
  'auth.oidc_client_id': '',
  'auth.oidc_redirect_uri': '',
  'auth.oidc_scope': 'openid email profile',
  'auth.oidc_display_name_claim': 'name',
  'auth.oidc_username_claim': 'preferred_username',
  'auth.oidc_admin_group_claim': '',
  'auth.oidc_admin_group_value': '',
  'auth.oidc_button_label': 'Sign in with SSO',
  'auth.oidc_token_auth_method': 'client_secret_basic',
};

export function AuthProvidersSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AuthSettings>(DEFAULTS);
  const [ldapPassword, setLdapPassword] = useState('');
  const [oidcSecret, setOidcSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testingLdap, setTestingLdap] = useState(false);
  const [ldapTestResult, setLdapTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    fetch('/api/v1/settings', { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { settings: Record<string, string> }) => {
        const merged = { ...DEFAULTS };
        for (const key of Object.keys(DEFAULTS) as (keyof AuthSettings)[]) {
          if (d.settings[key] !== undefined) merged[key] = d.settings[key];
        }
        setSettings(merged);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.role]);

  const set = (key: keyof AuthSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggle = (key: keyof AuthSettings) => {
    setSettings((prev) => ({ ...prev, [key]: prev[key] === 'true' ? 'false' : 'true' }));
  };

  const handleSave = async () => {
    setSaving(true);

    const updates: Record<string, string> = { ...settings };
    updates['auth.ldap_bind_password'] = ldapPassword || '__unchanged__';
    updates['auth.oidc_client_secret'] = oidcSecret || '__unchanged__';

    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const d = await res.json() as { error: string };
        showToast(d.error || '保存失败', 'error');
      } else {
        showToast('设置已保存。', 'success');
        setLdapPassword('');
        setOidcSecret('');
        invalidateSettings();
      }
    } catch {
      showToast('网络错误。', 'error');
    } finally {
      setSaving(false);
    }
  };

  const testLdapConnection = async () => {
    setTestingLdap(true);
    setLdapTestResult(null);
    try {
      const res = await fetch('/api/v1/auth/ldap/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: settings['auth.ldap_url'],
          bindDn: settings['auth.ldap_bind_dn'],
          bindPassword: ldapPassword || undefined,
          searchBase: settings['auth.ldap_search_base'],
        }),
      });
      const d = await res.json() as { success: boolean; error?: string };
      setLdapTestResult(d.success ? '✅ 连接成功' : `❌ ${d.error ?? '连接失败'}`);
    } catch {
      setLdapTestResult('❌ 网络错误');
    } finally {
      setTestingLdap(false);
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground">加载中…</div>;

  const localEnabled = settings['auth.local_enabled'] === 'true';
  const ldapEnabled = settings['auth.ldap_enabled'] === 'true';
  const oidcEnabled = settings['auth.oidc_enabled'] === 'true';

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Local Authentication */}
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">本地身份验证</h3>
          <p className="text-sm text-muted-foreground">允许用户使用本地存储的用户名和密码登录。</p>
        </div>
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div>
            <p className="font-medium">启用本地登录</p>
            <p className="text-sm text-muted-foreground">用户可使用其 Gatwy 用户名和密码登录</p>
          </div>
          <button
            onClick={() => toggle('auth.local_enabled')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${localEnabled ? 'bg-accent' : 'bg-surface-hover'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${localEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {!localEnabled && (
          <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-600 dark:text-yellow-400">
            <span>⚠️</span>
            <span>本地身份验证已禁用。请确保至少配置了一个 SSO 提供方，以便管理员仍能访问系统。</span>
          </div>
        )}
      </section>

      {/* LDAP */}
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">LDAP / Active Directory</h3>
          <p className="text-sm text-muted-foreground">通过 LDAP 目录或 Active Directory 验证用户身份。</p>
        </div>
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div>
            <p className="font-medium">启用 LDAP 身份验证</p>
            <p className="text-sm text-muted-foreground">用户可使用其目录凭据登录</p>
          </div>
          <button
            onClick={() => toggle('auth.ldap_enabled')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${ldapEnabled ? 'bg-accent' : 'bg-surface-hover'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ldapEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {ldapEnabled && (
          <div className="space-y-4 p-4 border rounded-lg bg-surface-alt">
            <div className="grid grid-cols-1 gap-4">
              <Field label="LDAP 服务器 URL" hint="例如 ldap://dc.example.com 或 ldaps://dc.example.com:636">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.ldap_url']} onChange={(e) => set('auth.ldap_url', e.target.value)} placeholder="ldap://dc.example.com" />
              </Field>
              <Field label="Bind DN" hint="用于搜索目录的服务账户 DN">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.ldap_bind_dn']} onChange={(e) => set('auth.ldap_bind_dn', e.target.value)} placeholder="cn=service,ou=users,dc=example,dc=com" />
              </Field>
              <Field label="Bind 密码" hint="留空则保留现有密码">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" type="password" value={ldapPassword} onChange={(e) => setLdapPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
              </Field>
              <Field label="搜索基准" hint="搜索用户时使用的基准 DN">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.ldap_search_base']} onChange={(e) => set('auth.ldap_search_base', e.target.value)} placeholder="ou=users,dc=example,dc=com" />
              </Field>
              <Field label="用户搜索过滤器" hint="使用 {username} 作为输入用户名的占位符">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.ldap_user_filter']} onChange={(e) => set('auth.ldap_user_filter', e.target.value)} placeholder="(uid={username})" />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <Field label="用户名属性">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.ldap_username_attr']} onChange={(e) => set('auth.ldap_username_attr', e.target.value)} placeholder="uid" />
              </Field>
              <Field label="邮箱属性">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.ldap_email_attr']} onChange={(e) => set('auth.ldap_email_attr', e.target.value)} placeholder="mail" />
              </Field>
              <Field label="显示名称属性">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.ldap_display_name_attr']} onChange={(e) => set('auth.ldap_display_name_attr', e.target.value)} placeholder="cn" />
              </Field>
            </div>

            <Field label="管理员组 DN" hint="可选：该组成员将被授予管理员角色">
              <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.ldap_admin_group_dn']} onChange={(e) => set('auth.ldap_admin_group_dn', e.target.value)} placeholder="cn=gatwy-admins,ou=groups,dc=example,dc=com" />
            </Field>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-primary">验证 TLS 证书</p>
                <p className="text-xs text-text-secondary">仅在开发环境使用自签名证书时禁用</p>
              </div>
              <button
                onClick={() => toggle('auth.ldap_tls_reject_unauthorized')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings['auth.ldap_tls_reject_unauthorized'] === 'true' ? 'bg-accent' : 'bg-surface-hover'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings['auth.ldap_tls_reject_unauthorized'] === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={testLdapConnection}
                disabled={testingLdap || !settings['auth.ldap_url'] || !settings['auth.ldap_search_base']}
                className="px-3 py-1.5 border border-border rounded text-sm text-text-primary hover:bg-surface-hover disabled:opacity-50"
              >
                {testingLdap ? '测试中…' : '测试连接'}
              </button>
              {ldapTestResult && <span className="text-sm text-text-secondary">{ldapTestResult}</span>}
            </div>
          </div>
        )}
      </section>

      {/* OIDC */}
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">OpenID Connect（SSO）</h3>
          <p className="text-sm text-muted-foreground">允许用户通过 Azure AD、Okta、Google 或 Keycloak 等身份提供方登录。</p>
        </div>
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div>
            <p className="font-medium">启用 SSO</p>
            <p className="text-sm text-muted-foreground">在登录页显示 SSO 登录按钮</p>
          </div>
          <button
            onClick={() => toggle('auth.oidc_enabled')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${oidcEnabled ? 'bg-accent' : 'bg-surface-hover'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${oidcEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {oidcEnabled && (
          <div className="space-y-4 p-4 border rounded-lg bg-surface-alt">
            <div className="grid grid-cols-1 gap-4">
              <Field label="提供方 URL（签发方）" hint="身份提供方的基础 URL（将从 /.well-known/openid-configuration 获取发现文档）">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.oidc_provider_url']} onChange={(e) => set('auth.oidc_provider_url', e.target.value)} placeholder="https://login.microsoftonline.com/tenant-id/v2.0" />
              </Field>
              <Field label="Client ID">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.oidc_client_id']} onChange={(e) => set('auth.oidc_client_id', e.target.value)} placeholder="your-client-id" />
              </Field>
              <Field label="Client Secret" hint="留空则保留现有密钥">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" type="password" value={oidcSecret} onChange={(e) => setOidcSecret(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
              </Field>
              <Field label="重定向 URI" hint={`必须在身份提供方中注册。请使用：${window.location.origin}${BASE_PATH}/api/v1/auth/oidc/callback`}>
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.oidc_redirect_uri']} onChange={(e) => set('auth.oidc_redirect_uri', e.target.value)} placeholder={`${window.location.origin}${BASE_PATH}/api/v1/auth/oidc/callback`} />
              </Field>
              <Field label="作用域" hint="以空格分隔的 OIDC 作用域">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.oidc_scope']} onChange={(e) => set('auth.oidc_scope', e.target.value)} placeholder="openid email profile" />
              </Field>
              <Field label="Token 端点认证方式" hint="必须与身份提供方一致。环境变量 OIDC_TOKEN_AUTH_METHOD 会覆盖此设置。">
                <select
                  className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                  value={settings['auth.oidc_token_auth_method'] || 'client_secret_basic'}
                  onChange={(e) => set('auth.oidc_token_auth_method', e.target.value)}
                >
                  <option value="client_secret_basic">client_secret_basic (HTTP Basic)</option>
                  <option value="client_secret_post">client_secret_post（表单正文）</option>
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="用户名 Claim" hint="用作用户名的 JWT claim">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.oidc_username_claim']} onChange={(e) => set('auth.oidc_username_claim', e.target.value)} placeholder="preferred_username" />
              </Field>
              <Field label="显示名称 Claim">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.oidc_display_name_claim']} onChange={(e) => set('auth.oidc_display_name_claim', e.target.value)} placeholder="name" />
              </Field>
              <Field label="管理员组 Claim" hint="包含组成员信息的 claim 名称">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.oidc_admin_group_claim']} onChange={(e) => set('auth.oidc_admin_group_claim', e.target.value)} placeholder="groups" />
              </Field>
              <Field label="管理员组值" hint="授予管理员角色的 claim 值">
                <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.oidc_admin_group_value']} onChange={(e) => set('auth.oidc_admin_group_value', e.target.value)} placeholder="gatwy-admins" />
              </Field>
            </div>

            <Field label="登录按钮文字" hint="登录页 SSO 按钮上显示的文字">
              <input className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" value={settings['auth.oidc_button_label']} onChange={(e) => set('auth.oidc_button_label', e.target.value)} placeholder="使用 SSO 登录" />
            </Field>
          </div>
        )}
      </section>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="py-2 px-4 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 font-medium text-sm"
      >
        {saving ? '保存中…' : '保存更改'}
      </button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-text-primary">{label}</label>
      {children}
      {hint && <p className="text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}
