import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { showToast } from '../../hooks/useToast';

/** Display names for the server's auto-backup status and trigger values. */
const BACKUP_STATUS_LABEL: Record<string, string> = { running: '进行中', success: '成功', failed: '失败' };
const BACKUP_TRIGGER_LABEL: Record<string, string> = { scheduled: '定时', manual: '手动' };

interface SizeInfo { dbSize: number; recordingsSize: number; recordingCount: number }
interface SmbConnection { id: string; name: string; host: string; port: number }
interface AutoConfig {
  enabled: boolean;
  destinationMode: 'saved' | 'adhoc';
  connectionId: string;
  remotePath: string;
  scheduleType: 'daily' | 'weekly';
  scheduleTime: string;
  scheduleWeekday: number;
  includeRecordings: boolean;
  retentionCount: number;
  autoDisabled: boolean;
}
interface AutoStatus {
  enabled: boolean;
  autoDisabled: boolean;
  runInProgress: boolean;
  queuedScheduledRun: boolean;
  nextRunAt: string;
  lastRunAt: string;
  lastStatus: string;
  lastError: string;
  lastFilename: string;
  lastSizeBytes: number;
  consecutiveFailures: number;
  maxFileSizeBytes: number;
}
interface AutoHistoryRow {
  id: string;
  trigger_type: string;
  status: string;
  started_at: string;
  size_bytes: number | null;
  filename: string | null;
  error_message: string | null;
}

interface AutoHistoryResponse {
  rows: AutoHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
}

type Tab = 'manual' | 'auto';
const HISTORY_PAGE_SIZE = 10;

function fmtBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtDate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="relative inline-flex h-5 w-9 shrink-0">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-accent" />
      <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
    </span>
  );
}

export function BackupSettings() {
  const [tab, setTab] = useState<Tab>('manual');

  return (
    <div className="space-y-5">
      <div className="flex border-b border-border">
        <button
          onClick={() => setTab('manual')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'manual' ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
        >
          手动备份
        </button>
        <button
          onClick={() => setTab('auto')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'auto' ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
        >
          自动备份
        </button>
      </div>

      {tab === 'manual' ? <ManualBackupTab /> : <AutoBackupTab />}
    </div>
  );
}

function ManualBackupTab() {
  const [exportPassword, setExportPassword] = useState('');
  const [exportConfirm, setExportConfirm] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [includeRecordings, setIncludeRecordings] = useState(false);
  const [sizeInfo, setSizeInfo] = useState<SizeInfo | null>(null);
  const [sizeLoading, setSizeLoading] = useState(true);

  const [importPassword, setImportPassword] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSizeLoading(true);
    fetch('/api/v1/backup/size', { credentials: 'include' })
      .then((r) => r.ok ? r.json() as Promise<SizeInfo> : Promise.reject())
      .then((d) => setSizeInfo(d))
      .catch(() => setSizeInfo(null))
      .finally(() => setSizeLoading(false));
  }, []);

  async function handleExport(e: React.FormEvent) {
    e.preventDefault();
    if (exportPassword.length < 8) { showToast('密码至少需要 8 个字符。', 'error'); return; }
    if (exportPassword !== exportConfirm) { showToast('两次输入的密码不一致。', 'error'); return; }
    setExportLoading(true);
    try {
      const res = await fetch('/api/v1/backup/export', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: exportPassword, includeRecordings }),
      });
      if (!res.ok) {
        const d = await res.json() as { error: string };
        showToast(d.error || '导出失败。', 'error');
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      const fname = cd.match(/filename="([^"]+)"/)?.[1] ?? 'gatwy-backup.geb';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`备份已下载：${fname}`, 'success');
      setExportPassword('');
      setExportConfirm('');
    } catch {
      showToast('导出时发生网络错误。', 'error');
    } finally {
      setExportLoading(false);
    }
  }

  async function doImport() {
    if (!importFile || !importPassword) return;
    setImportLoading(true);
    setShowConfirm(false);
    try {
      const arrayBuf = await importFile.arrayBuffer();
      const res = await fetch('/api/v1/backup/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Password': importPassword },
        body: arrayBuf,
      });

      let d: { ok?: boolean; message?: string; error?: string; recordingsRestored?: number } = {};
      try { d = await res.json() as typeof d; } catch { /* non-json */ }

      if (!res.ok) {
        const msg = res.status === 422 ? '备份密码错误。' : (d.error || `导入失败（HTTP ${res.status}）。`);
        showToast(msg, 'error');
        return;
      }

      showToast(`${d.message ?? '已恢复。'}（已恢复 ${d.recordingsRestored ?? 0} 个录像）`, 'success');
      setImportFile(null);
      setImportPassword('');
      if (fileRef.current) fileRef.current.value = '';
    } catch {
      showToast('导入时发生网络错误。', 'error');
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <div className="max-w-lg space-y-8">
      <section>
        <h2 className="text-base font-semibold text-text-primary mb-1">导出备份</h2>
        <p className="text-sm text-text-secondary mb-4">
          创建包含数据库和加密密钥的加密备份，
          可选择同时包含会话录像。
        </p>
        <div className="mb-4 rounded-lg border border-border bg-surface-hover px-4 py-3 text-sm space-y-1">
          {sizeLoading ? (
            <p className="text-text-secondary">正在计算大小…</p>
          ) : sizeInfo ? (
            <>
              <p className="text-text-secondary"><span className="font-medium text-text-primary">数据库：</span> ~{fmtBytes(sizeInfo.dbSize)}</p>
              <p className="text-text-secondary">
                <span className="font-medium text-text-primary">录像：</span> ~{fmtBytes(sizeInfo.recordingsSize)}
                {sizeInfo.recordingCount > 0 && <span className="text-text-secondary/70">（{sizeInfo.recordingCount} 个文件）</span>}
              </p>
              <p className="font-medium text-text-primary pt-1 border-t border-border">预计总计：~{fmtBytes(sizeInfo.dbSize + (includeRecordings ? sizeInfo.recordingsSize : 0))}</p>
            </>
          ) : (
            <p className="text-text-secondary/70">无法加载大小信息。</p>
          )}
        </div>

        <label className="flex items-center gap-3 mb-4 cursor-pointer select-none w-fit">
          <Toggle checked={includeRecordings} onChange={setIncludeRecordings} />
          <span className="text-sm text-text-secondary">备份中包含录像</span>
        </label>

        <form onSubmit={handleExport} className="space-y-3">
          <input type="password" value={exportPassword} onChange={(e) => setExportPassword(e.target.value)} placeholder="备份密码" className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary text-sm" />
          <input type="password" value={exportConfirm} onChange={(e) => setExportConfirm(e.target.value)} placeholder="确认密码" className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary text-sm" />
          <button type="submit" disabled={exportLoading} className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium">
            {exportLoading ? '正在创建备份…' : '下载备份'}
          </button>
        </form>
      </section>

      <hr className="border-border" />

      <section>
        <h2 className="text-base font-semibold text-text-primary mb-1">导入 / 恢复备份</h2>
        <p className="text-sm text-red-400 font-medium mb-4">此操作将覆盖当前所有数据。</p>
        <div className="space-y-3">
          <input ref={fileRef} type="file" accept=".geb" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} className="w-full text-sm text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-border file:bg-surface-hover file:text-text-primary file:cursor-pointer hover:file:bg-surface" />
          <input type="password" value={importPassword} onChange={(e) => setImportPassword(e.target.value)} placeholder="备份密码" className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary text-sm" />

          {showConfirm && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400 space-y-2">
              <p className="font-medium">这将永久覆盖当前所有数据，是否继续？</p>
              <div className="flex gap-2">
                <button onClick={doImport} className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700">确认恢复</button>
                <button onClick={() => setShowConfirm(false)} className="px-3 py-1.5 border border-border rounded text-text-secondary hover:bg-surface-hover text-sm">取消</button>
              </div>
            </div>
          )}

          {!showConfirm && (
            <button
              onClick={() => {
                if (!importFile) { showToast('请先选择备份文件。', 'error'); return; }
                if (!importPassword) { showToast('请输入备份密码。', 'error'); return; }
                setShowConfirm(true);
              }}
              disabled={importLoading}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
            >
              {importLoading ? '恢复中…' : '恢复备份'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function AutoBackupTab() {
  const { user } = useAuth();
  const hasSmbPermission = user?.permissions?.includes('protocols.smb') ?? false;

  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [runningNow, setRunningNow] = useState(false);

  const [passwordSentinel, setPasswordSentinel] = useState('__unchanged__');
  const [config, setConfig] = useState<AutoConfig>({
    enabled: false,
    destinationMode: 'saved',
    connectionId: '',
    remotePath: '',
    scheduleType: 'daily',
    scheduleTime: '02:30',
    scheduleWeekday: 1,
    includeRecordings: false,
    retentionCount: 14,
    autoDisabled: false,
  });
  const [status, setStatus] = useState<AutoStatus | null>(null);
  const [history, setHistory] = useState<AutoHistoryRow[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [connections, setConnections] = useState<SmbConnection[]>([]);

  const [globalPassword, setGlobalPassword] = useState('');
  const [globalPasswordConfirm, setGlobalPasswordConfirm] = useState('');
  const [hasPassword, setHasPassword] = useState(false);

  const [adhocOpen, setAdhocOpen] = useState(false);
  const [showConfigDetails, setShowConfigDetails] = useState(true);
  const collapseInitRef = useRef(false);
  const [adhoc, setAdhoc] = useState({ host: '', port: 445, share: '', username: '', password: '', domain: '' });
  const [adhocHasPassword, setAdhocHasPassword] = useState(false);

  const weekdays = [
    { value: 0, label: '星期日' },
    { value: 1, label: '星期一' },
    { value: 2, label: '星期二' },
    { value: 3, label: '星期三' },
    { value: 4, label: '星期四' },
    { value: 5, label: '星期五' },
    { value: 6, label: '星期六' },
  ];

  function isConfigAlreadySet(
    cfg: AutoConfig,
    hasGlobalPw: boolean,
    hasAdhocPw: boolean,
    adhocCfg: { host: string; share: string },
  ): boolean {
    if (!hasGlobalPw) return false;
    if (cfg.destinationMode === 'saved') {
      return !!cfg.connectionId;
    }
    return !!adhocCfg.host && !!adhocCfg.share && hasAdhocPw;
  }

  async function loadHistory(page: number) {
    setHistoryLoading(true);
    try {
      const histRes = await fetch(`/api/v1/backup/auto/history?limit=${HISTORY_PAGE_SIZE}&page=${page}`, { credentials: 'include' });
      if (histRes.ok) {
        const data = await histRes.json() as AutoHistoryResponse;
        setHistory(data.rows ?? []);
        setHistoryTotal(Number.isFinite(data.total) ? data.total : 0);
        setHistoryPage(Number.isFinite(data.page) ? data.page : page);
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const [cfgRes, stRes, conRes, capRes] = await Promise.all([
        fetch('/api/v1/backup/auto/config', { credentials: 'include' }),
        fetch('/api/v1/backup/auto/status', { credentials: 'include' }),
        fetch('/api/v1/backup/auto/connections', { credentials: 'include' }),
        fetch('/api/v1/backup/auto/capabilities', { credentials: 'include' }),
      ]);

      if (capRes.ok) {
        const capData = await capRes.json() as { passwordSentinel?: string };
        if (capData.passwordSentinel) setPasswordSentinel(capData.passwordSentinel);
      }

      if (cfgRes.ok) {
        const data = await cfgRes.json() as {
          config: AutoConfig;
          hasPassword: boolean;
          hasAdhocPassword: boolean;
          adhoc: { host: string; port: number; share: string; username: string; domain: string };
        };
        setConfig(data.config);
        setHasPassword(data.hasPassword);
        setAdhocHasPassword(data.hasAdhocPassword);
        setAdhoc((prev) => ({
          ...prev,
          host: data.adhoc.host || '',
          port: data.adhoc.port || 445,
          share: data.adhoc.share || '',
          username: data.adhoc.username || '',
          domain: data.adhoc.domain || '',
          password: '',
        }));

        if (!collapseInitRef.current) {
          const configured = isConfigAlreadySet(data.config, data.hasPassword, data.hasAdhocPassword, {
            host: data.adhoc.host || '',
            share: data.adhoc.share || '',
          });
          setShowConfigDetails(!configured);
          collapseInitRef.current = true;
        }
      }

      if (stRes.ok) {
        const data = await stRes.json() as { status: AutoStatus };
        setStatus(data.status);
      }

      if (conRes.ok) {
        const data = await conRes.json() as { connections: SmbConnection[] };
        setConnections(data.connections ?? []);
      }

      await loadHistory(1);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const totalHistoryPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));

  async function goToHistoryPage(nextPage: number) {
    const page = Math.max(1, Math.min(totalHistoryPages, nextPage));
    await loadHistory(page);
  }

  async function saveConfig() {
    setSaving(true);
    try {
      if (!globalPassword && !hasPassword) {
        showToast('必须设置全局备份密码。', 'error');
        return;
      }
      if (globalPassword && globalPassword.length < 8) {
        showToast('全局备份密码至少需要 8 个字符。', 'error');
        return;
      }
      if (globalPassword && globalPassword !== globalPasswordConfirm) {
        showToast('两次输入的全局密码不一致。', 'error');
        return;
      }
      if (config.destinationMode === 'saved' && !config.connectionId) {
        showToast('请选择一个 SMB 目标连接。', 'error');
        return;
      }
      if (config.destinationMode === 'adhoc' && (!adhoc.host || !adhoc.share)) {
        showToast('临时 SMB 目标必须填写主机和共享名。', 'error');
        return;
      }

      const res = await fetch('/api/v1/backup/auto/config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          password: globalPassword || passwordSentinel,
          adhoc: {
            ...adhoc,
            password: adhoc.password || passwordSentinel,
          },
        }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) {
        showToast(d.error || '保存自动备份配置失败。', 'error');
        return;
      }

      showToast('自动备份配置已保存。', 'success');
      setGlobalPassword('');
      setGlobalPasswordConfirm('');
      setAdhoc((p) => ({ ...p, password: '' }));
      setHasPassword(true);
      setAdhocHasPassword(true);
      await load();
    } catch {
      showToast('保存配置时发生网络错误。', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function testDestination() {
    setTesting(true);
    try {
      const res = await fetch('/api/v1/backup/auto/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinationMode: config.destinationMode,
          connectionId: config.connectionId,
          remotePath: config.remotePath,
          adhoc: {
            ...adhoc,
            password: adhoc.password || passwordSentinel,
          },
        }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) {
        showToast(d.error || '目标测试失败。', 'error');
        return;
      }
      showToast('目标测试通过。', 'success');
      setAdhoc((p) => ({ ...p, password: '' }));
      setAdhocHasPassword(true);
    } catch {
      showToast('测试目标时发生网络错误。', 'error');
    } finally {
      setTesting(false);
    }
  }

  async function runNow() {
    setRunningNow(true);
    try {
      const res = await fetch('/api/v1/backup/auto/run-now', {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) {
        showToast(d.error || '立即运行失败。', 'error');
        return;
      }
      showToast('自动备份运行完成。', 'success');
      await load();
    } catch {
      showToast('运行备份时发生网络错误。', 'error');
    } finally {
      setRunningNow(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {!hasSmbPermission && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          你的角色缺少 SMB 协议权限，在授予该权限前自动备份可能会失败。
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-4 border border-border rounded-2xl p-5 bg-gradient-to-br from-surface-alt to-surface shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-text-primary">配置</h2>
              <p className="text-xs text-text-secondary mt-0.5">单个定时任务，仅支持 SMB 目标。</p>
            </div>
            {!loading && (
              <button
                onClick={() => setShowConfigDetails((v) => !v)}
                className="px-3 py-1.5 border border-border rounded text-text-secondary hover:bg-surface-hover text-xs"
              >
                {showConfigDetails ? '收起' : '展开'}
              </button>
            )}
          </div>
          {loading ? (
            <p className="text-sm text-text-secondary">正在加载自动备份配置…</p>
          ) : (
            <>
              {!showConfigDetails && (
                <div className="rounded-xl border border-border bg-surface-hover/60 p-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-text-secondary">已启用</span>
                    <span className="text-text-primary">{config.enabled ? '是' : '否'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-text-secondary">目标模式</span>
                    <span className="text-text-primary">{config.destinationMode === 'saved' ? '已保存的 SMB 连接' : '临时 SMB 目标'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-text-secondary">计划</span>
                    <span className="text-text-primary">{config.scheduleType === 'weekly' ? `每周 ${config.scheduleTime}` : `每天 ${config.scheduleTime}`}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-text-secondary">保留期限</span>
                    <span className="text-text-primary">{config.retentionCount} 个备份</span>
                  </div>
                </div>
              )}

              {showConfigDetails && (
                <>
                  <div className="rounded-xl border border-border bg-surface-hover/60 p-3">
                    <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
                      <span className="text-sm font-medium text-text-primary">启用定时自动备份</span>
                      <Toggle checked={config.enabled} onChange={(v) => setConfig((p) => ({ ...p, enabled: v }))} />
                    </label>
                  </div>

                  <div className="rounded-xl border border-border bg-surface-hover/40 p-3 space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">全局密码</p>
                    <input type="password" value={globalPassword} onChange={(e) => setGlobalPassword(e.target.value)} placeholder={hasPassword ? '留空则保留现有全局密码' : '全局备份密码（至少 8 个字符）'} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm" />
                    <input type="password" value={globalPasswordConfirm} onChange={(e) => setGlobalPasswordConfirm(e.target.value)} placeholder="确认全局密码" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm" />
                  </div>

                  <div className="rounded-xl border border-border bg-surface-hover/40 p-3 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">目标模式</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfig((p) => ({ ...p, destinationMode: 'saved' }))}
                    className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${config.destinationMode === 'saved' ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-text-secondary hover:text-text-primary'}`}
                  >
                    已保存的 SMB 连接
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfig((p) => ({ ...p, destinationMode: 'adhoc' }))}
                    className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${config.destinationMode === 'adhoc' ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-text-secondary hover:text-text-primary'}`}
                  >
                    临时 SMB 目标
                  </button>
                </div>
                  </div>

                  {config.destinationMode === 'saved' && (
                <div className="rounded-xl border border-border bg-surface-hover/40 p-3 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">已保存的目标</p>
                  <select value={config.connectionId} onChange={(e) => setConfig((p) => ({ ...p, connectionId: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm">
                    <option value="">选择管理员拥有的 SMB 目标…</option>
                    {connections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.host}:{c.port})</option>)}
                  </select>
                </div>
                  )}

                  {config.destinationMode === 'adhoc' && (
                <details className="rounded-xl border border-border bg-surface-hover/40" open={adhocOpen} onToggle={(e) => setAdhocOpen((e.target as HTMLDetailsElement).open)}>
                  <summary className="px-3 py-2 text-sm cursor-pointer text-text-primary font-medium">可选的临时 SMB 设置</summary>
                  <div className="px-3 pb-3 space-y-2">
                    <input type="text" value={adhoc.host} onChange={(e) => setAdhoc((p) => ({ ...p, host: e.target.value }))} placeholder="SMB 主机" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm" />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" min="1" value={adhoc.port} onChange={(e) => setAdhoc((p) => ({ ...p, port: parseInt(e.target.value || '445', 10) }))} placeholder="端口" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm" />
                      <input type="text" value={adhoc.share} onChange={(e) => setAdhoc((p) => ({ ...p, share: e.target.value }))} placeholder="共享名" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm" />
                    </div>
                    <input type="text" value={adhoc.username} onChange={(e) => setAdhoc((p) => ({ ...p, username: e.target.value }))} placeholder="用户名" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm" />
                    <input type="password" value={adhoc.password} onChange={(e) => setAdhoc((p) => ({ ...p, password: e.target.value }))} placeholder={adhocHasPassword ? '留空则保留临时目标密码' : '临时目标密码'} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm" />
                    <input type="text" value={adhoc.domain} onChange={(e) => setAdhoc((p) => ({ ...p, domain: e.target.value }))} placeholder="域（可选）" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm" />
                  </div>
                </details>
                  )}

                  <div className="rounded-xl border border-border bg-surface-hover/40 p-3 space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">计划与保留</p>
                <input type="text" value={config.remotePath} onChange={(e) => setConfig((p) => ({ ...p, remotePath: e.target.value }))} placeholder="远程文件夹路径" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm" />

                <div className="grid grid-cols-2 gap-2">
                  <select value={config.scheduleType} onChange={(e) => setConfig((p) => ({ ...p, scheduleType: e.target.value as 'daily' | 'weekly' }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm">
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                  </select>
                  <input type="time" value={config.scheduleTime} onChange={(e) => setConfig((p) => ({ ...p, scheduleTime: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm" />
                </div>

                {config.scheduleType === 'weekly' && (
                  <select value={config.scheduleWeekday} onChange={(e) => setConfig((p) => ({ ...p, scheduleWeekday: parseInt(e.target.value, 10) }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm">
                    {weekdays.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                  </select>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <label className="flex items-center gap-3 cursor-pointer select-none w-fit">
                    <Toggle checked={config.includeRecordings} onChange={(v) => setConfig((p) => ({ ...p, includeRecordings: v }))} />
                    <span className="text-sm text-text-secondary">包含录像</span>
                  </label>

                  <div>
                    <label className="block text-sm text-text-secondary mb-1">保留数量</label>
                    <input type="number" min="1" max="365" value={config.retentionCount} onChange={(e) => setConfig((p) => ({ ...p, retentionCount: parseInt(e.target.value || '1', 10) }))} className="w-28 px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm" />
                  </div>
                </div>
                  </div>

                  <p className="text-xs text-text-secondary">服务器端限制备份大小上限为 4 GB。</p>

                  <div className="flex flex-wrap gap-2">
                    <button onClick={saveConfig} disabled={saving} className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium">{saving ? '保存中…' : '保存'}</button>
                    <button onClick={testDestination} disabled={testing} className="px-4 py-2 border border-border rounded text-text-secondary hover:bg-surface-hover disabled:opacity-50 text-sm font-medium">{testing ? '测试中…' : '测试目标'}</button>
                    <button onClick={runNow} disabled={runningNow} className="px-4 py-2 border border-border rounded text-text-secondary hover:bg-surface-hover disabled:opacity-50 text-sm font-medium">{runningNow ? '运行中…' : '立即运行'}</button>
                  </div>
                </>
              )}
            </>
          )}
        </section>

        <section className="space-y-4 border border-border rounded-lg p-4">
          <h2 className="text-base font-semibold text-text-primary">状态</h2>
          {!status ? (
            <p className="text-sm text-text-secondary">正在加载状态…</p>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-text-secondary">已启用</span><span className="text-text-primary">{status.enabled ? '是' : '否'}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">运行中</span><span className="text-text-primary">{status.runInProgress ? '是' : '否'}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">排队中的定时运行</span><span className="text-text-primary">{status.queuedScheduledRun ? '是' : '否'}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">已自动禁用</span><span className="text-text-primary">{status.autoDisabled ? '是' : '否'}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">连续失败次数</span><span className="text-text-primary">{status.consecutiveFailures}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">下次运行</span><span className="text-text-primary">{fmtDate(status.nextRunAt)}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">上次运行</span><span className="text-text-primary">{fmtDate(status.lastRunAt)}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">上次状态</span><span className="text-text-primary">{BACKUP_STATUS_LABEL[status.lastStatus] ?? (status.lastStatus || '-')}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">上次文件</span><span className="text-text-primary truncate max-w-[220px] text-right">{status.lastFilename || '-'}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">上次大小</span><span className="text-text-primary">{fmtBytes(status.lastSizeBytes)}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">最大文件大小</span><span className="text-text-primary">{fmtBytes(status.maxFileSizeBytes)}</span></div>
              {status.lastError && <p className="text-red-400 text-xs pt-2 border-t border-border">上次错误：{status.lastError}</p>}
            </div>
          )}
        </section>
      </div>

      <section className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">运行历史</h2>
          <button onClick={() => void loadHistory(historyPage)} className="px-3 py-1.5 border border-border rounded text-text-secondary hover:bg-surface-hover text-sm">刷新</button>
        </div>
        <p className="text-sm text-text-secondary">历史记录保留 90 天。</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-text-secondary border-b border-border">
                <th className="py-2 pr-3">开始时间</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2 pr-3">触发方式</th>
                <th className="py-2 pr-3">大小</th>
                <th className="py-2 pr-3">文件</th>
                <th className="py-2 pr-3">错误</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading && (
                <tr>
                  <td className="py-3 text-text-secondary" colSpan={6}>正在加载历史记录…</td>
                </tr>
              )}
              {!historyLoading && history.length === 0 && (
                <tr>
                  <td className="py-3 text-text-secondary" colSpan={6}>暂无运行记录。</td>
                </tr>
              )}
              {history.map((r) => (
                <tr key={r.id} className="border-b border-border/60 text-text-primary">
                  <td className="py-2 pr-3">{fmtDate(r.started_at)}</td>
                  <td className="py-2 pr-3">{BACKUP_STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="py-2 pr-3">{BACKUP_TRIGGER_LABEL[r.trigger_type] ?? r.trigger_type}</td>
                  <td className="py-2 pr-3">{fmtBytes(r.size_bytes ?? 0)}</td>
                  <td className="py-2 pr-3 max-w-[220px] truncate">{r.filename || '-'}</td>
                  <td className="py-2 pr-3 max-w-[260px] truncate text-red-400">{r.error_message || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-secondary">
            第 {history.length === 0 ? 0 : (historyPage - 1) * HISTORY_PAGE_SIZE + 1}
            {history.length > 0 ? `-${(historyPage - 1) * HISTORY_PAGE_SIZE + history.length}` : ''} 条，共 {historyTotal} 条
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void goToHistoryPage(historyPage - 1)}
              disabled={historyLoading || historyPage <= 1}
              className="px-3 py-1.5 border border-border rounded text-text-secondary hover:bg-surface-hover disabled:opacity-50 text-sm"
            >
              上一页
            </button>
            <span className="text-xs text-text-secondary min-w-[80px] text-center">第 {historyPage} / {totalHistoryPages} 页</span>
            <button
              onClick={() => void goToHistoryPage(historyPage + 1)}
              disabled={historyLoading || historyPage >= totalHistoryPages}
              className="px-3 py-1.5 border border-border rounded text-text-secondary hover:bg-surface-hover disabled:opacity-50 text-sm"
            >
              下一页
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
