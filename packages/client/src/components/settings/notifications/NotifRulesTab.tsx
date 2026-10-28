import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../../hooks/useAuth';
import { showToast } from '../../../hooks/useToast';

const API = '/api/v1/notifications';

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(API + path, { credentials: 'include', ...opts });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ChannelType = 'smtp' | 'telegram' | 'slack' | 'webhook';

interface Condition {
  field: 'event' | 'user' | 'ip' | 'time' | 'date' | 'custom';
  operator: string;
  value: string;
  value2?: string;
}

interface Cadence {
  type: 'always' | 'throttle';
  minutes?: number;
}

interface Action {
  channel: ChannelType;
  to?: string;           // smtp — custom comma-separated addresses
  to_users?: string[];   // smtp — user IDs
  to_roles?: string[];   // smtp — role IDs
  subject?: string;      // smtp
  body?: string;         // smtp / template override
  chat_id?: string;      // telegram
  template?: string;     // telegram / slack / webhook
  url?: string;          // slack / webhook
}

interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  events: string[];
  conditionLogic: 'AND' | 'OR';
  conditions: Condition[];
  cadence: Cadence;
  actions: Action[];
  createdAt: string;
  lastTriggeredAt: string | null;
}

// ─── Event catalogue (grouped) ───────────────────────────────────────────────

const EVENT_GROUPS: { label: string; events: { value: string; label: string }[] }[] = [
  {
    label: '全部',
    events: [{ value: '*', label: '任意事件' }],
  },
  {
    label: '认证',
    events: [
      { value: 'auth.*', label: '认证 — 全部' },
      { value: 'auth.login_success', label: '登录成功' },
      { value: 'auth.login_failed', label: '登录失败' },
      { value: 'auth.logout', label: '退出登录' },
      { value: 'auth.password_changed', label: '密码已修改' },
      { value: 'auth.passkey_login_success', label: '通行密钥登录成功' },
      { value: 'auth.passkey_login_failed', label: '通行密钥登录失败' },
      { value: 'auth.passkey_registered', label: '通行密钥已注册' },
      { value: 'auth.passkey_renamed', label: '通行密钥已重命名' },
      { value: 'auth.passkey_removed', label: '通行密钥已移除' },
      { value: 'auth.passkey_admin_reset', label: '管理员重置了用户的通行密钥' },
    ],
  },
  {
    label: '会话',
    events: [
      { value: 'session.*', label: '会话 — 全部' },
      { value: 'session.rdp.connect', label: 'RDP 会话已连接' },
      { value: 'session.rdp.disconnect', label: 'RDP 会话已断开' },
      { value: 'session.rdp.file_upload', label: 'RDP 文件已上传' },
      { value: 'session.rdp.file_download', label: 'RDP 文件已下载' },
      { value: 'session.rdp.redirect.blocked', label: 'RDP 重定向已拦截（SSRF 防护）' },
      { value: 'session.ssh.connect', label: 'SSH 会话已连接' },
      { value: 'session.ssh.disconnect', label: 'SSH 会话已断开' },
      { value: 'session.ssh.tunnel.blocked', label: 'SSH 隧道已拦截（SSRF 防护）' },
      { value: 'session.ssh.host_key_mismatch', label: 'SSH 主机密钥已变更（连接被拒绝）' },
      { value: 'session.telnet.connect', label: 'Telnet 会话已连接' },
      { value: 'session.telnet.disconnect', label: 'Telnet 会话已断开' },
      { value: 'session.vnc.connect', label: 'VNC 会话已连接' },
      { value: 'session.vnc.disconnect', label: 'VNC 会话已断开' },
      { value: 'session.disconnect.forced', label: '会话被管理员断开' },
      { value: 'session.moonlight.connect', label: 'Moonlight 会话已连接' },
      { value: 'session.moonlight.disconnect', label: 'Moonlight 会话已断开' },
      { value: 'session.moonlight.pair', label: 'Moonlight 配对事件' },
      { value: 'session.moonlight.denied', label: 'Moonlight 串流被拒绝（主机不允许）' },
      { value: 'session.smb.connect', label: 'SMB 会话已连接' },
      { value: 'session.sftp.connect', label: 'SFTP 会话已连接' },
      { value: 'session.ftp.connect', label: 'FTP 会话已连接' },
    ],
  },
  {
    label: '连接',
    events: [
      { value: 'connection.*', label: '连接 — 全部' },
      { value: 'connection.created', label: '连接已创建' },
      { value: 'connection.updated', label: '连接已更新' },
      { value: 'connection.deleted', label: '连接已删除' },
      { value: 'connection.shares_updated', label: '连接共享已更新' },
      { value: 'connections.imported', label: '连接已导入' },
      { value: 'group.shares_updated', label: '文件夹共享已更新' },
      { value: 'group.share_capability_changed', label: '文件夹共享权限已变更' },
    ],
  },
  {
    label: '凭据',
    events: [
      { value: 'credential.*', label: '凭据 — 全部' },
      { value: 'credential.created', label: '凭据已创建' },
      { value: 'credential.updated', label: '凭据已更新' },
      { value: 'credential.deleted', label: '凭据已删除' },
    ],
  },
  {
    label: '用户',
    events: [
      { value: 'user.*', label: '用户 — 全部' },
      { value: 'user.setup', label: '初始管理员设置已完成' },
      { value: 'user.created', label: '用户已创建' },
      { value: 'user.updated', label: '用户已更新' },
      { value: 'user.deleted', label: '用户已删除' },
      { value: 'user.password_reset', label: '用户密码已重置' },
      { value: 'user.unlocked', label: '用户已解锁' },
      { value: 'user.mfa_enabled', label: 'MFA 已启用' },
      { value: 'user.mfa_disabled', label: 'MFA 已禁用' },
    ],
  },
  {
    label: '角色',
    events: [
      { value: 'role.*', label: '角色 — 全部' },
      { value: 'role.created', label: '角色已创建' },
      { value: 'role.updated', label: '角色已更新' },
      { value: 'role.reset', label: '角色权限已重置' },
      { value: 'role.deleted', label: '角色已删除' },
    ],
  },
  {
    label: '设置',
    events: [
      { value: 'settings.*', label: '设置 — 全部' },
      { value: 'settings.updated', label: '设置已更改' },
      { value: 'settings.notification_rule_created', label: '通知规则已创建' },
      { value: 'settings.notification_rule_updated', label: '通知规则已更新' },
      { value: 'settings.notification_rule_enabled', label: '通知规则已启用' },
      { value: 'settings.notification_rule_disabled', label: '通知规则已禁用' },
      { value: 'settings.notification_rule_deleted', label: '通知规则已删除' },
      { value: 'settings.notifications_channel_updated', label: '通知渠道已更新' },
      { value: 'settings.notifications_retention_changed', label: '通知保留期限已更改' },
    ],
  },
  {
    label: '备份',
    events: [
      { value: 'backup.*', label: '备份 — 全部' },
      { value: 'backup.auto.*', label: '自动备份 — 全部' },
      { value: 'backup.auto.config_updated', label: '自动备份配置已更新' },
      { value: 'backup.auto.destination_tested', label: '自动备份目标已测试' },
      { value: 'backup.auto.run_succeeded', label: '自动备份执行成功' },
      { value: 'backup.auto.run_failed', label: '自动备份执行失败' },
      { value: 'backup.auto.auto_disabled', label: '自动备份已被自动禁用' },
      { value: 'admin.backup.export', label: '手动导出备份' },
    ],
  },
  {
    label: '安全',
    events: [
      { value: 'security.*', label: '安全 — 全部' },
      { value: 'security.ip_blocked', label: 'IP 地址已封禁' },
      { value: 'security.ip_rules_updated', label: 'IP 访问规则已更新' },
      { value: 'security.account_locked', label: '账户已锁定（登录失败次数过多）' },
      { value: 'security.locked_account_attempt', label: '已锁定账户的登录尝试' },
    ],
  },
  {
    label: '通知',
    events: [
      { value: 'notifications.*', label: '通知 — 全部' },
      { value: 'notifications.log_entry_deleted', label: '通知日志条目已删除' },
      { value: 'notifications.log_cleared', label: '通知日志已清空' },
      { value: 'notifications.log_purged', label: '通知日志已清理（保留期限）' },
      { value: 'notifications.channel_tested', label: '通知渠道已测试' },
      { value: 'notifications.log_retried', label: '通知重试已发送' },
    ],
  },
  {
    label: '个人资料',
    events: [
      { value: 'profile.*', label: '个人资料 — 全部' },
      { value: 'profile.updated', label: '个人资料已更新' },
    ],
  },
  {
    label: '数据库',
    events: [
      { value: 'db.*', label: '数据库会话 — 全部' },
      { value: 'db.connect', label: '数据库会话已连接' },
      { value: 'db.disconnect', label: '数据库会话已断开' },
      { value: 'db.quarantined', label: '数据库已隔离（检测到损坏）' },
    ],
  },
  {
    label: '管理员',
    events: [
      { value: 'admin.*', label: '管理员操作 — 全部' },
      { value: 'admin.sessions.purge', label: '管理员清理了会话' },
    ],
  },
  {
    label: '录像',
    events: [
      { value: 'recordings.*', label: '录像 — 全部' },
      { value: 'recordings.retention_purged', label: '录像已按保留期限清理' },
    ],
  },
];

const CONDITION_FIELDS: { value: string; label: string }[] = [
  { value: 'event', label: '事件类型' },
  { value: 'user', label: '用户 ID' },
  { value: 'ip', label: 'IP 地址' },
  { value: 'time', label: '时间（HH:MM UTC）' },
  { value: 'date', label: '日期（YYYY-MM-DD）' },
  { value: 'custom', label: '详情 JSON 包含' },
];

const OPERATORS: { value: string; label: string }[] = [
  { value: 'equals', label: '等于' },
  { value: 'not_equals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'starts_with', label: '开头为' },
  { value: 'ends_with', label: '结尾为' },
  { value: 'matches', label: '匹配正则' },
  { value: 'before', label: '早于' },
  { value: 'after', label: '晚于' },
  { value: 'between', label: '介于' },
];

const CHANNEL_OPTIONS: { value: ChannelType; label: string }[] = [
  { value: 'smtp', label: '邮件（SMTP）' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'slack', label: 'Slack' },
  { value: 'webhook', label: 'Webhook' },
];

// ─── EventPicker (combobox multi-select with portal dropdown) ────────────────

const ALL_EVENTS = EVENT_GROUPS.flatMap((g) => g.events);

function getEventLabel(value: string): string {
  return ALL_EVENTS.find((e) => e.value === value)?.label ?? value;
}

// Category icon mapping for visual hierarchy
const GROUP_ICONS: Record<string, string> = {
  全部: '🌐', 认证: '🔑', 会话: '💻', 连接: '🔌',
  用户: '👤', 角色: '🪪', 设置: '⚙️', 备份: '💾', 安全: '🛡️',
  通知: '🔔', 个人资料: '🧾', 数据库: '🗄️', 管理员: '🛠️',
  录像: '🎥',
};

function EventPicker({ events, onChange }: { events: string[]; onChange: (v: string[]) => void }) {
  const { features } = useAuth();
  const pickerGroups = features.moonlight
    ? EVENT_GROUPS
    : EVENT_GROUPS.map((g) => ({
        ...g,
        events: g.events.filter((ev) => !ev.value.includes('moonlight')),
      }));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 320 });

  // Position dropdown relative to anchor via portal
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const dropH = 340;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow >= dropH ? rect.bottom + 4 : rect.top - dropH - 4;
    setPos({ top, left: rect.left, width: Math.max(rect.width, 360) });
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        anchorRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Auto-focus search on open
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  function toggle(value: string) {
    onChange(events.includes(value) ? events.filter((e) => e !== value) : [...events, value]);
  }

  function addCustom() {
    const v = search.trim();
    if (v && !events.includes(v) && !ALL_EVENTS.some((e) => e.value === v)) {
      onChange([...events, v]);
    }
    setSearch('');
  }

  // Filter events by search term
  const q = search.toLowerCase();
  const filteredGroups = q
    ? pickerGroups.map((g) => ({
        ...g,
        events: g.events.filter(
          (ev) => ev.label.toLowerCase().includes(q) || ev.value.toLowerCase().includes(q),
        ),
      })).filter((g) => g.events.length > 0)
    : pickerGroups;

  const selectedCount = events.length;

  return (
    <div ref={anchorRef}>
      {/* ── Combobox trigger area ── */}
      <div
        className={`flex flex-wrap items-center gap-1.5 min-h-[38px] px-2.5 py-1.5 rounded-lg border cursor-text transition-colors ${
          open
            ? 'border-accent ring-1 ring-accent/30 bg-surface'
            : 'border-border bg-surface hover:border-text-secondary/30'
        }`}
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {/* Selected pills — compact, inline */}
        {events.map((ev) => (
          <span
            key={ev}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs font-medium bg-accent/10 text-accent border border-accent/20 max-w-[200px] group"
          >
            <span className="truncate">{getEventLabel(ev)}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggle(ev); }}
              className="flex items-center justify-center w-4 h-4 rounded hover:bg-accent/20 transition-colors"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </span>
        ))}

        {/* Inline search input */}
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !search && events.length > 0) {
              onChange(events.slice(0, -1));
            }
            if (e.key === 'Enter' && search.trim()) {
              e.preventDefault();
              // If exactly one filtered result, select it
              const allFiltered = filteredGroups.flatMap((g) => g.events);
              if (allFiltered.length === 1) { toggle(allFiltered[0].value); setSearch(''); }
              else { addCustom(); }
            }
            if (e.key === 'Escape') { setOpen(false); setSearch(''); }
          }}
          placeholder={events.length === 0 ? '搜索事件…' : ''}
          className="flex-1 min-w-[80px] text-xs bg-transparent text-text-primary placeholder:text-text-secondary/40 focus:outline-none"
        />

        {/* Counter + chevron */}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          {selectedCount > 0 && (
            <span className="text-[10px] font-semibold text-accent bg-accent/10 rounded px-1.5 py-0.5">
              {selectedCount}
            </span>
          )}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary/60">
            <polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
          </svg>
        </div>
      </div>

      {/* ── Dropdown (rendered as portal so it floats above everything) ── */}
      {open && createPortal(
        <div
          ref={dropRef}
          className="fixed z-[9999] rounded-lg border border-border bg-surface shadow-2xl overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {/* Grouped event list */}
          <div className="max-h-[280px] overflow-y-auto overscroll-contain">
            {filteredGroups.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-text-secondary">
                没有匹配“<span className="font-medium text-text-primary">{search}</span>”的事件
                <br />
                <button
                  type="button"
                  onClick={addCustom}
                  className="mt-2 text-accent hover:underline"
                >
                  将“{search.trim()}”添加为自定义事件
                </button>
              </div>
            ) : (
              filteredGroups.map((group) => (
                <div key={group.label}>
                  {/* Group header */}
                  <div className="sticky top-0 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-surface-alt/90 backdrop-blur-sm border-b border-border/60">
                    <span className="text-xs">{GROUP_ICONS[group.label] ?? '📋'}</span>
                    <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">{group.label}</span>
                    <span className="text-[10px] text-text-secondary/40 ml-auto">{group.events.filter((ev) => events.includes(ev.value)).length}/{group.events.length}</span>
                  </div>
                  {/* Event items — compact 2-col grid for small items, full-width for long names */}
                  <div className="py-0.5">
                    {group.events.map((ev) => {
                      const checked = events.includes(ev.value);
                      return (
                        <button
                          key={ev.value}
                          type="button"
                          onClick={() => { toggle(ev.value); inputRef.current?.focus(); }}
                          className={`w-full flex items-center gap-2.5 px-3 py-[7px] text-xs text-left transition-colors ${
                            checked
                              ? 'bg-accent/5 hover:bg-accent/10'
                              : 'hover:bg-surface-alt'
                          }`}
                        >
                          {/* Checkbox */}
                          <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all ${
                            checked
                              ? 'bg-accent border border-accent shadow-sm shadow-accent/30'
                              : 'border border-border bg-surface'
                          }`}>
                            {checked && (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </span>
                          {/* Label */}
                          <span className={`flex-1 ${checked ? 'text-accent font-medium' : 'text-text-primary'}`}>
                            {ev.label}
                          </span>
                          {/* Monospace event key */}
                          <code className={`text-[10px] font-mono shrink-0 ${checked ? 'text-accent/60' : 'text-text-secondary/40'}`}>
                            {ev.value}
                          </code>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer: quick actions */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-surface-alt/50 text-[11px] text-text-secondary">
            <span>已选 {selectedCount} 项</span>
            <div className="flex items-center gap-3">
              {selectedCount > 0 && (
                <button type="button" onClick={() => onChange([])} className="text-red-400 hover:text-red-500 transition-colors">
                  全部清除
                </button>
              )}
              <button type="button" onClick={() => { setOpen(false); setSearch(''); }} className="text-text-secondary hover:text-text-primary transition-colors">
                完成
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Rule Editor slide-over ───────────────────────────────────────────────────

function RuleEditor({
  initial,
  onSave,
  onClose,
}: {
  initial?: Rule;
  onSave: (r: Rule) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [events, setEvents] = useState<string[]>(initial?.events ?? []);
  const [condLogic, setCondLogic] = useState<'AND' | 'OR'>(initial?.conditionLogic ?? 'AND');
  const [conditions, setConditions] = useState<Condition[]>(initial?.conditions ?? []);
  const [cadence, setCadence] = useState<Cadence>(initial?.cadence ?? { type: 'always' });
  const [actions, setActions] = useState<Action[]>(initial?.actions ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const { users, roles } = useRecipients();

  function addCondition() {
    setConditions((c) => [...c, { field: 'user', operator: 'equals', value: '' }]);
  }

  function updateCondition(i: number, patch: Partial<Condition>) {
    setConditions((c) => c.map((item, idx) => idx === i ? { ...item, ...patch } : item));
  }

  function removeCondition(i: number) {
    setConditions((c) => c.filter((_, idx) => idx !== i));
  }

  function addAction() {
    setActions((a) => [...a, { channel: 'smtp' }]);
  }

  function updateAction(i: number, patch: Partial<Action>) {
    setActions((a) => a.map((item, idx) => idx === i ? { ...item, ...patch } : item));
  }

  function removeAction(i: number) {
    setActions((a) => a.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!name.trim()) { setErr('请填写规则名称'); return; }
    if (events.length === 0) { setErr('请至少选择一个事件'); return; }
    if (actions.length === 0) { setErr('请至少添加一个动作'); return; }

    setSaving(true); setErr('');
    const body = {
      name: name.trim(),
      events,
      conditionLogic: condLogic,
      conditions,
      cadence,
      actions,
      enabled: true,
    };

    const url = initial ? `/rules/${initial.id}` : '/rules';
    const method = initial ? 'PUT' : 'POST';
    const { ok, data } = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (ok) {
      onSave(data.rule as Rule);
    } else {
      setErr(data.error ?? '保存失败');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* slide-over panel */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-surface shadow-2xl flex flex-col">
        {/* Header */}
        <div className="h-12 flex items-center justify-between px-5 border-b border-border shrink-0">
          <span className="text-sm font-semibold text-text-primary">
            {initial ? '编辑规则' : '新建规则'}
          </span>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-hover text-text-secondary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Rule name */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-secondary">规则名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：登录失败告警"
              className="w-full px-3 py-2 text-sm rounded border border-border bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent"
            />
          </div>

          {/* ── Step 1: When ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white text-[10px] font-bold shrink-0">1</span>
              <span className="text-sm font-semibold text-text-primary">当</span>
            </div>
            <div className="pl-7 space-y-1">
              <label className="block text-xs text-text-secondary mb-1">在以下事件发生时触发：</label>
              <EventPicker events={events} onChange={setEvents} />
            </div>
          </section>

          {/* ── Step 2: Check If ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white text-[10px] font-bold shrink-0">2</span>
              <span className="text-sm font-semibold text-text-primary">检查条件</span>
              <span className="text-xs text-text-secondary">（可选 — 留空则始终触发）</span>
            </div>

            {conditions.length > 0 && (
              <div className="pl-7 space-y-2">
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <span>满足</span>
                  <select
                    value={condLogic}
                    onChange={(e) => setCondLogic(e.target.value as 'AND' | 'OR')}
                    className="px-2 py-1 rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
                  >
                    <option value="AND">全部（AND）</option>
                    <option value="OR">任一（OR）</option>
                  </select>
                  <span>以下条件：</span>
                </div>

                {conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <select
                      value={c.field}
                      onChange={(e) => updateCondition(i, { field: e.target.value as Condition['field'] })}
                      className="px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
                    >
                      {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <select
                      value={c.operator}
                      onChange={(e) => updateCondition(i, { operator: e.target.value })}
                      className="px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
                    >
                      {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <input
                      value={c.value}
                      onChange={(e) => updateCondition(i, { value: e.target.value })}
                      placeholder="值"
                      className="flex-1 min-w-[80px] px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
                    />
                    {c.operator === 'between' && (
                      <>
                        <span className="text-xs text-text-secondary">和</span>
                        <input
                          value={c.value2 ?? ''}
                          onChange={(e) => updateCondition(i, { value2: e.target.value })}
                          placeholder="结束值"
                          className="w-24 px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
                        />
                      </>
                    )}
                    <button onClick={() => removeCondition(i)} className="text-text-secondary hover:text-red-500 transition-colors">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="pl-7">
              <button
                onClick={addCondition}
                className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                添加条件
              </button>
            </div>
          </section>

          {/* ── Step 3: Do This ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white text-[10px] font-bold shrink-0">3</span>
              <span className="text-sm font-semibold text-text-primary">执行动作</span>
            </div>

            <div className="pl-7 space-y-3">
              {/* Cadence */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-secondary">频率：</span>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="radio" checked={cadence.type === 'always'} onChange={() => setCadence({ type: 'always' })} className="accent-accent" />
                  始终
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="radio" checked={cadence.type === 'throttle'} onChange={() => setCadence({ type: 'throttle', minutes: 60 })} className="accent-accent" />
                  限流
                </label>
                {cadence.type === 'throttle' && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <input
                      type="number"
                      min="1"
                      value={cadence.minutes ?? 60}
                      onChange={(e) => setCadence({ type: 'throttle', minutes: parseInt(e.target.value, 10) || 60 })}
                      className="w-16 px-2 py-1 rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
                    />
                    <span className="text-text-secondary">分钟内最多告警一次</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              {actions.map((action, i) => (
                <ActionCard
                  key={i}
                  index={i}
                  action={action}
                  onChange={(patch) => updateAction(i, patch)}
                  onRemove={() => removeAction(i)}
                  users={users}
                  roles={roles}
                />
              ))}

              <button
                onClick={addAction}
                className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                添加动作
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-5 py-3 flex items-center justify-between">
          <div>{err && <p className="text-xs text-red-500">{err}</p>}</div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-hover text-text-primary">
              取消
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中…' : '保存规则'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  index, action, onChange, onRemove, users, roles,
}: {
  index: number;
  action: Action;
  onChange: (p: Partial<Action>) => void;
  onRemove: () => void;
  users: RecipientUser[];
  roles: RecipientRole[];
}) {
  const VARS = '{{severity}} {{app_name}} {{event}} {{user}} {{ip}} {{timestamp}} {{rule}} {{target}} {{details}}';

  return (
    <div className="border border-border rounded-lg p-3 space-y-2 bg-surface-alt">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary">动作 {index + 1}</span>
        <button onClick={onRemove} className="text-text-secondary hover:text-red-500 transition-colors">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-text-secondary shrink-0">渠道：</label>
        <select
          value={action.channel}
          onChange={(e) => onChange({ channel: e.target.value as ChannelType })}
          className="flex-1 px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
        >
          {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {action.channel === 'smtp' && (
        <>
          <PillSelect
            label="发送给用户"
            options={users.map((u) => ({
              id: u.id,
              label: u.username,
              sub: u.email ?? '未设置邮箱',
              dimmed: !u.hasEmail,
            }))}
            selected={action.to_users ?? []}
            onChange={(ids) => onChange({ to_users: ids })}
          />
          {/* Warn immediately when a selected user has no email */}
          {(action.to_users ?? []).some((id) => users.find((u) => u.id === id && !u.hasEmail)) && (
            <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-600 dark:text-yellow-400">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 mt-0.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>
                以下选中的用户没有邮箱地址，将被跳过：
                <strong>
                  {(action.to_users ?? [])
                    .filter((id) => users.find((u) => u.id === id && !u.hasEmail))
                    .map((id) => users.find((u) => u.id === id)?.username)
                    .join(', ')}
                </strong>
                。请在<em>设置 → 用户</em>中设置其邮箱。
              </span>
            </div>
          )}
          <PillSelect
            label="发送给角色"
            options={roles.map((r) => ({ id: r.id, label: r.name }))}
            selected={action.to_roles ?? []}
            onChange={(ids) => onChange({ to_roles: ids })}
          />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-secondary">其他地址</label>
            <input value={action.to ?? ''} onChange={(e) => onChange({ to: e.target.value })}
              placeholder="例如：ops@example.com, alerts@example.com"
              className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent" />
            <p className="text-[11px] text-text-secondary/60">多个地址用逗号分隔。没有邮箱地址的用户会被自动跳过。</p>
          </div>
          <input value={action.subject ?? ''} onChange={(e) => onChange({ subject: e.target.value })}
            placeholder="主题（留空使用默认值）" className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent" />
          <textarea rows={3} value={action.body ?? ''} onChange={(e) => onChange({ body: e.target.value })}
            placeholder={`正文模板（留空使用默认值）\n${VARS}`}
            className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent resize-none font-mono" />
        </>
      )}

      {action.channel === 'telegram' && (
        <>
          <input value={action.chat_id ?? ''} onChange={(e) => onChange({ chat_id: e.target.value })}
            placeholder="Chat ID（留空使用默认值）" className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent" />
          <textarea rows={3} value={action.template ?? ''} onChange={(e) => onChange({ template: e.target.value })}
            placeholder={`消息模板（留空使用默认值）\n${VARS}`}
            className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent resize-none font-mono text-xs" />
        </>
      )}

      {(action.channel === 'slack' || action.channel === 'webhook') && (
        <>
          {action.channel === 'webhook' && (
            <input value={action.url ?? ''} onChange={(e) => onChange({ url: e.target.value })}
              placeholder="覆盖 URL（留空使用默认值）" className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent" />
          )}
          <textarea rows={3} value={action.template ?? ''} onChange={(e) => onChange({ template: e.target.value })}
            placeholder={`消息模板（留空使用默认值）\n${VARS}`}
            className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:border-accent resize-none font-mono text-xs" />
        </>
      )}
    </div>
  );
}

// ─── Recipients data ─────────────────────────────────────────────────────────

interface RecipientUser { id: string; username: string; displayName: string | null; email: string | null; hasEmail: boolean; }
interface RecipientRole { id: string; name: string; }

function useRecipients() {
  const [users, setUsers] = useState<RecipientUser[]>([]);
  const [roles, setRoles] = useState<RecipientRole[]>([]);
  useEffect(() => {
    apiFetch('/recipients').then(({ ok, data }) => {
      if (ok) {
        setUsers(data.users as RecipientUser[]);
        setRoles(data.roles as RecipientRole[]);
      }
    });
  }, []);
  return { users, roles };
}

/** Multi-select pill list for users or roles */
function PillSelect({
  label, options, selected, onChange, disabled,
}: {
  label: string;
  options: { id: string; label: string; sub?: string; dimmed?: boolean }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-text-secondary">{label}</label>
      <div className="flex flex-wrap gap-1.5 p-2 border border-border rounded bg-surface min-h-[34px]">
        {options.map((o) => {
          const active = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(o.id)}
              title={o.sub}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                active
                  ? 'bg-accent text-white border-accent'
                  : o.dimmed
                  ? 'bg-surface-alt text-text-secondary/50 border-border'
                  : 'bg-surface-alt text-text-secondary border-border hover:border-accent hover:text-text-primary'
              }`}
            >
              {active && <span>✓</span>}
              {o.label}
            </button>
          );
        })}
        {options.length === 0 && <span className="text-xs text-text-secondary/50">暂无可选项</span>}
      </div>
    </div>
  );
}

// ─── Action Card ──────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '从不';
  const d = new Date(iso.includes('T') ? iso : iso + 'Z');
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export function NotifRulesTab() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);

  const load = useCallback(async () => {
    const { ok, data } = await apiFetch('/rules');
    if (ok) setRules(data.rules as Rule[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggleRule(rule: Rule) {
    const { ok, data } = await apiFetch(`/rules/${rule.id}/toggle`, { method: 'PATCH' });
    if (ok) {
      const enabled = (data as { enabled: boolean }).enabled;
      showToast(`“${rule.name}”${enabled ? '已启用' : '已禁用'}`);
    } else {
      showToast('切换规则状态失败', 'error');
    }
    await load();
  }

  async function deleteRule() {
    if (!deleting) return;
    await apiFetch(`/rules/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">已配置 {rules.length} 条规则</p>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          新建规则
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-text-secondary">加载中…</p>
      ) : rules.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">
          暂无规则，新建一条规则开始使用。
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="border border-border rounded-lg p-4 flex items-start gap-4 bg-surface hover:bg-surface-alt transition-colors">
              {/* Toggle */}
              <button
                onClick={() => toggleRule(rule)}
                className={`mt-0.5 relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${rule.enabled ? 'bg-accent' : 'bg-surface-hover border border-border'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${rule.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-text-primary truncate">{rule.name}</span>
                  <div className="flex gap-1 flex-wrap shrink-0">
                    {(rule.events ?? []).slice(0, 3).map((ev) => (
                      <span key={ev} className="text-xs bg-surface-hover border border-border rounded px-1.5 py-0.5 text-text-secondary font-mono">{getEventLabel(ev)}</span>
                    ))}
                    {(rule.events ?? []).length > 3 && (
                      <span className="text-xs text-text-secondary">另外 {(rule.events ?? []).length - 3} 个</span>
                    )}
                  </div>
                  {rule.conditions.length > 0 && (
                    <span className="text-xs text-text-secondary shrink-0">{rule.conditions.length} 个条件（{rule.conditionLogic}）</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-text-secondary flex-wrap">
                  <span>{rule.actions.length} 个动作：{rule.actions.map((a) => a.channel).join(', ')}</span>
                  {rule.cadence.type === 'throttle' && <span>• 限流 {rule.cadence.minutes} 分钟</span>}
                  {rule.lastTriggeredAt && <span>• 上次触发 {formatRelativeTime(rule.lastTriggeredAt)}</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setEditing(rule)}
                  className="p-1.5 rounded hover:bg-surface-hover text-text-secondary transition-colors"
                  title="编辑"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  onClick={() => setDeleting(rule)}
                  className="p-1.5 rounded hover:bg-surface-hover text-text-secondary hover:text-red-500 transition-colors"
                  title="删除"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rule editor slide-over */}
      {editing !== null && (
        <RuleEditor
          initial={editing === 'new' ? undefined : editing}
          onSave={async () => { setEditing(null); await load(); }}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Delete confirmation — in-app modal */}
      {deleting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setDeleting(null); }}
        >
          <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-primary">删除规则？</h3>
                <p className="text-sm text-text-secondary mt-1">
                  “<span className="font-medium text-text-primary">{deleting.name}</span>”将被永久删除。
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={deleteRule} className="flex-1 py-2 px-4 bg-red-500 hover:bg-red-600 text-white text-sm rounded transition-colors">
                删除
              </button>
              <button onClick={() => setDeleting(null)} className="px-4 py-2 border border-border rounded text-sm text-text-primary hover:bg-surface-hover transition-colors">
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}