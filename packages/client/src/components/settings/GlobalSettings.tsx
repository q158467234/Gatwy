import { useEffect, useState, type FormEvent } from 'react';
import type React from 'react';
import { useSettings, invalidateSettings } from '../../hooks/useSettings';
import { showToast } from '../../hooks/useToast';

type Tab = 'general' | 'recordings' | 'rdp';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: '常规' },
  { id: 'rdp', label: 'RDP' },
];

const RDP_GRAPHICS_MODES: { value: string; label: string; help: string }[] = [
  {
    value: 'legacy',
    label: '经典（RemoteFX）',
    help: '兼容性最好。所有画面更新都在浏览器中由 CPU 解码。',
  },
  {
    value: 'egfx',
    label: '图形管道（EGFX）',
    help: '不含 H.264 的新版 RDP 图形通道。部分服务器（如 GNOME Remote Desktop）必须使用此模式。',
  },
  {
    value: 'h264',
    label: '图形管道 + H.264',
    help: '由浏览器（WebCodecs）解码 H.264，可用时使用 GPU：视频和动态画面占用的带宽大幅降低。彩色文字会略显模糊（AVC420）。无法解码 H.264 的浏览器将改用不含 H.264 的图形管道。',
  },
  {
    value: 'h264-444',
    label: '图形管道 + H.264 4:4:4',
    help: '与 H.264 相同，但同时接受 AVC444：完整色彩分辨率，彩色文字保持清晰，解码开销约为两倍。仅当服务器启用“Prioritize H.264/AVC 444 graphics mode”时 Windows 才会发送此格式；否则效果与 H.264 相同。',
  },
];

// All IANA timezones supported by the runtime (Intl API).
// UTC is always pinned first since it is the system default and may not be
// returned by Intl.supportedValuesOf in all browser/environment combinations.
const TIMEZONES: string[] = (() => {
  try {
    const zones = Intl.supportedValuesOf('timeZone').filter((tz) => tz !== 'UTC');
    return ['UTC', ...zones];
  } catch {
    return ['UTC'];
  }
})();

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        value ? 'bg-accent' : 'bg-surface-hover border border-border'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function GlobalSettings() {
  const { settings, refresh } = useSettings();
  const [activeTab, setActiveTab] = useState<Tab>('general');

  // General
  const [appName, setAppName] = useState('Gatwy');
  const [timezone, setTimezone] = useState('UTC');
  const [healthMonitorEnabled, setHealthMonitorEnabled] = useState(true);
  const [autoCloseDisconnected, setAutoCloseDisconnected] = useState(true);
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Logo
  const [logoPreview, setLogoPreview] = useState<string>('');

  // Recordings
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [recordingRetention, setRecordingRetention] = useState('90');
  const [retentionDaysEnabled, setRetentionDaysEnabled] = useState(true);
  const [retentionSizeEnabled, setRetentionSizeEnabled] = useState(false);
  const [retentionMaxSizeGb, setRetentionMaxSizeGb] = useState('10');
  const [savingRecording, setSavingRecording] = useState(false);

  // RDP
  const [rdpGraphicsMode, setRdpGraphicsMode] = useState('legacy');
  const [rdpMetrics, setRdpMetrics] = useState(false);
  const [rdpGpuCompositing, setRdpGpuCompositing] = useState(false);
  const [rdpResolution, setRdpResolution] = useState('sharp');
  const [savingRdp, setSavingRdp] = useState(false);

  // Audit retention (shown in General tab)
  const [auditRetention, setAuditRetention] = useState('90');

  // Purge session history
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purging, setPurging] = useState(false);

  // Recording storage
  const [storageBytes, setStorageBytes] = useState<number | null>(null);

  useEffect(() => {
    setAppName(settings['app.name'] ?? 'Gatwy');
    setTimezone(settings['app.timezone'] || 'UTC');
    setLogoPreview(settings['app.logo'] ?? '');
    setAuditRetention(settings['audit.retention_days'] ?? '90');
    setHealthMonitorEnabled(settings['health_monitor.enabled'] !== 'false');
    setAutoCloseDisconnected(settings['session.auto_close_disconnected_enabled'] !== 'false');
    setRecordingEnabled(settings['session.recording_enabled'] === 'true');
    setRecordingRetention(settings['session.recording_retention_days'] ?? '90');
    setRetentionDaysEnabled(settings['session.recording_retention_days_enabled'] !== 'false');
    setRetentionSizeEnabled(settings['session.recording_retention_size_enabled'] === 'true');
    setRetentionMaxSizeGb(settings['session.recording_retention_max_size_gb'] ?? '10');
    setRdpGraphicsMode(settings['rdp.graphics_mode'] || 'legacy');
    setRdpMetrics(settings['rdp.metrics_enabled'] === 'true');
    setRdpGpuCompositing(settings['rdp.gpu_compositing'] === 'true');
    setRdpResolution(settings['rdp.resolution'] === 'saver' ? 'saver' : 'sharp');
  }, [settings]);

  useEffect(() => {
    if (activeTab !== 'recordings') return;
    fetch('/api/v1/sessions/storage', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { bytes: number } | null) => { if (d) setStorageBytes(d.bytes); })
      .catch(() => {});
  }, [activeTab]);

  async function saveSettings(updates: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/v1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      await refresh();
      invalidateSettings();
      return { ok: true };
    }
    const d = await res.json() as { error?: string };
    return { ok: false, error: d.error || '保存失败。' };
  }

  async function handleGeneralSave(e: FormEvent) {
    e.preventDefault();
    setSavingGeneral(true);
    try {
      const result = await saveSettings({
        'app.name': appName,
        'app.timezone': timezone,
        'app.logo': logoPreview,
        'audit.retention_days': auditRetention,
        'health_monitor.enabled': String(healthMonitorEnabled),
        'session.auto_close_disconnected_enabled': String(autoCloseDisconnected),
      });
      showToast(result.ok ? '已保存。' : result.error!, result.ok ? 'success' : 'error');
    } catch {
      showToast('网络错误。', 'error');
    } finally {
      setSavingGeneral(false);
    }
  }

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') setLogoPreview(reader.result); };
    reader.readAsDataURL(file);
    e.target.value = ''; // reset so same file can be re-selected
  }

  async function handlePurge() {
    setPurging(true);
    try {
      const res = await fetch('/api/v1/sessions', {
        method: 'DELETE',
        credentials: 'include',
      });
      const d = await res.json() as { ok?: boolean; deletedSessions?: number; deletedRecordings?: number; deletedFileSessions?: number; deletedQueryHistory?: number; error?: string };
      if (res.ok) {
        const fileNote = (d.deletedFileSessions ?? 0) > 0 ? `，以及 ${d.deletedFileSessions} 个文件操作会话` : '';
        const queryNote = (d.deletedQueryHistory ?? 0) > 0 ? `，以及 ${d.deletedQueryHistory} 条数据库查询历史` : '';
        showToast(`已删除 ${d.deletedSessions ?? 0} 个会话和 ${d.deletedRecordings ?? 0} 个录像${fileNote}${queryNote}。`, 'success');
        setShowPurgeConfirm(false);
        setStorageBytes(0);
      } else {
        showToast(d.error || '清除失败。', 'error');
      }
    } catch {
      showToast('网络错误。', 'error');
    } finally {
      setPurging(false);
    }
  }

  async function handleRdpSave(e: FormEvent) {
    e.preventDefault();
    setSavingRdp(true);
    try {
      const result = await saveSettings({
        'rdp.graphics_mode': rdpGraphicsMode,
        'rdp.metrics_enabled': String(rdpMetrics),
        'rdp.gpu_compositing': String(rdpGpuCompositing),
        'rdp.resolution': rdpResolution,
      });
      showToast(result.ok ? '已保存。将应用于此后打开的 RDP 会话。' : result.error!, result.ok ? 'success' : 'error');
    } catch {
      showToast('网络错误。', 'error');
    } finally {
      setSavingRdp(false);
    }
  }

  async function handleRecordingSave(e: FormEvent) {
    e.preventDefault();
    setSavingRecording(true);
    try {
      const result = await saveSettings({
        'session.recording_enabled': String(recordingEnabled),
        'session.recording_retention_days': recordingRetention,
        'session.recording_retention_days_enabled': String(retentionDaysEnabled),
        'session.recording_retention_size_enabled': String(retentionSizeEnabled),
        'session.recording_retention_max_size_gb': retentionMaxSizeGb,
      });
      showToast(result.ok ? '已保存。' : result.error!, result.ok ? 'success' : 'error');
    } catch {
      showToast('网络错误。', 'error');
    } finally {
      setSavingRecording(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-border mb-6 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.id
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* General */}
      {activeTab === 'general' && (
        <form onSubmit={handleGeneralSave} className="space-y-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">应用名称</label>
            <input
              type="text"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">时区</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            <p className="text-xs text-text-secondary mt-1">用于在整个应用中显示时间戳。</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">应用 Logo</label>
            <div className="flex items-center gap-3">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo 预览" className="h-9 w-auto max-w-[120px] object-contain rounded border border-border bg-surface p-1" />
              ) : (
                <div className="h-9 w-20 rounded border border-dashed border-border flex items-center justify-center text-xs text-text-secondary">无 Logo</div>
              )}
              <label className="px-3 py-1.5 bg-surface-hover border border-border rounded text-sm text-text-primary hover:bg-surface cursor-pointer">
                上传图片
                <input type="file" accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp" className="hidden" onChange={handleLogoFile} />
              </label>
              {logoPreview && (
                <button type="button" onClick={() => setLogoPreview('')}
                  className="px-3 py-1.5 border border-border rounded text-sm text-text-secondary hover:bg-surface-hover">
                  移除
                </button>
              )}
            </div>
            <p className="text-xs text-text-secondary mt-1">支持 PNG、JPEG、SVG 或 WebP，最大 4 MB。将替换页头中的文字标题。</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">审计日志保留期限（天）</label>
            <input
              type="number"
              min="1"
              value={auditRetention}
              onChange={(e) => setAuditRetention(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
          </div>
          <div className="flex items-center gap-3">
            <Toggle value={healthMonitorEnabled} onChange={setHealthMonitorEnabled} />
            <div>
              <span className="text-sm text-text-secondary">健康监测</span>
              <p className="text-xs text-text-secondary/60 mt-0.5">定期检查连接是否可达，并在侧边栏中显示绿色/红色圆点。</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Toggle value={autoCloseDisconnected} onChange={setAutoCloseDisconnected} />
            <div>
              <span className="text-sm text-text-secondary">自动关闭已断开的会话</span>
              <p className="text-xs text-text-secondary/60 mt-0.5">会话断开 15 秒后自动关闭其标签页。禁用后标签页将保持打开，直到用户手动关闭。</p>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingGeneral}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingGeneral ? '保存中…' : '保存'}
          </button>
        </form>
      )}

      {/* RDP */}
      {activeTab === 'rdp' && (
        <form onSubmit={handleRdpSave} className="space-y-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">图形模式</label>
            <select
              value={rdpGraphicsMode}
              onChange={(e) => setRdpGraphicsMode(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            >
              {RDP_GRAPHICS_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <p className="text-xs text-text-secondary mt-1">
              {RDP_GRAPHICS_MODES.find((m) => m.value === rdpGraphicsMode)?.help}
            </p>
            <p className="text-xs text-text-secondary/60 mt-1">应用于保存后打开的 RDP 会话；已打开的会话在重新连接前保持原有模式。</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">分辨率</label>
            <select
              value={rdpResolution}
              onChange={(e) => setRdpResolution(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            >
              <option value="sharp">清晰 — 与屏幕像素一致</option>
              <option value="saver">省流 — 更少像素</option>
            </select>
            <p className="text-xs text-text-secondary mt-1">
              {rdpResolution === 'sharp'
                ? '在高 DPI 屏幕（缩放高于 100%）上，远程桌面的每个像素对应一个屏幕像素，并由 Windows 相应缩放文字和界面，因此不会因放大而模糊。代价是更高的带宽和解码开销（150% 缩放时像素数为 2.25 倍）。'
                : '远程桌面的每个像素对应一个 CSS 像素，在高 DPI 屏幕上由浏览器放大：文字较模糊，但占用带宽更少。在 100% 缩放的屏幕上与“清晰”完全相同。'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Toggle value={rdpGpuCompositing} onChange={setRdpGpuCompositing} />
            <div>
              <span className="text-sm text-text-secondary">GPU 合成</span>
              <p className="text-xs text-text-secondary/60 mt-0.5">
                使用 WebGL2 合成画面，并直接绘制 H.264 图像而无需从 GPU 回读，可降低全屏动态画面下浏览器的 CPU
                占用。仅适用于图形管道模式；不支持硬件 WebGL2 的浏览器仍在 CPU 上合成。锐利边缘处的颜色可能与 CPU
                路径略有差异。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Toggle value={rdpMetrics} onChange={setRdpMetrics} />
            <div>
              <span className="text-sm text-text-secondary">性能统计</span>
              <p className="text-xs text-text-secondary/60 mt-0.5">
                将每个 RDP 会话的吞吐量记录到服务器日志，并将其帧率、绘制延迟和 H.264 解码器统计信息输出到浏览器控制台
                （<code className="text-xs bg-surface px-1 rounded">window.__gatwyRdpMetrics</code>）。
                仅用于故障排查，其他情况下请保持关闭。
              </p>
            </div>
          </div>
          <button
            type="submit"
            disabled={savingRdp}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingRdp ? '保存中…' : '保存'}
          </button>
        </form>
      )}

      {/* Recordings */}
      {activeTab === 'recordings' && (
        <div className="space-y-6 max-w-lg">
        <form onSubmit={handleRecordingSave} className="space-y-4">
          <div className="flex items-center gap-3">
            <Toggle value={recordingEnabled} onChange={setRecordingEnabled} />
            <span className="text-sm text-text-secondary">启用会话录像 <span className="text-xs text-text-secondary/60">(SSH &amp; RDP)</span></span>
          </div>

          {/* Retention by days */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Toggle value={retentionDaysEnabled} onChange={setRetentionDaysEnabled} />
              <span className="text-sm text-text-secondary">按时间保留</span>
            </div>
            {retentionDaysEnabled && (
              <div className="ml-12">
                <label className="block text-sm font-medium text-text-secondary mb-1">录像保留期限（天）</label>
                <p className="text-xs text-text-secondary mb-1">超过此期限的录像将被自动删除。</p>
                <input
                  type="number"
                  min="1"
                  value={recordingRetention}
                  onChange={(e) => setRecordingRetention(e.target.value)}
                  className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                />
              </div>
            )}
          </div>

          {/* Retention by size */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Toggle value={retentionSizeEnabled} onChange={setRetentionSizeEnabled} />
              <span className="text-sm text-text-secondary">按容量保留</span>
            </div>
            {retentionSizeEnabled && (
              <div className="ml-12">
                <label className="block text-sm font-medium text-text-secondary mb-1">录像最大存储空间（GB）</label>
                <p className="text-xs text-text-secondary mb-1">总存储量超过此限制时，将优先删除最早的录像。</p>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={retentionMaxSizeGb}
                  onChange={(e) => setRetentionMaxSizeGb(e.target.value)}
                  className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                />
              </div>
            )}
          </div>

          {retentionDaysEnabled && retentionSizeEnabled && (
            <p className="text-xs text-text-secondary bg-surface rounded px-3 py-2 border border-border">
              ℹ️ 两种保留策略均已启用，任一限制先达到即触发清理（FIFO）。
            </p>
          )}
          <button
            type="submit"
            disabled={savingRecording}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingRecording ? '保存中…' : '保存'}
          </button>
        </form>

        {/* Storage usage */}
        {storageBytes !== null && (
          <div className="border border-border rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                  <path d="M3 12a9 3 0 0 0 18 0" />
                </svg>
                录像存储
              </h3>
              <span className="text-xs font-mono text-text-secondary">{formatBytes(storageBytes)}</span>
            </div>
            <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: storageBytes > 0 ? `${Math.min(100, (storageBytes / (10 * 1024 ** 3)) * 100)}%` : '0%' }}
              />
            </div>
            <p className="text-xs text-text-secondary">所有录像文件在磁盘上占用的空间。</p>
          </div>
        )}

        {/* Danger zone */}
        <div className="mt-8 border border-red-500/20 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-red-400 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            危险操作
          </h3>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text-primary">删除所有录像</p>
              <p className="text-xs text-text-secondary mt-0.5">从磁盘永久删除所有录像文件及其会话记录。</p>
            </div>
            <button
              type="button"
              onClick={() => setShowPurgeConfirm(true)}
              className="shrink-0 px-3 py-1.5 border border-red-500/40 rounded text-sm text-red-400 hover:bg-red-500/10 font-medium"
            >
              删除历史
            </button>
          </div>
        </div>

        {/* Purge confirmation modal */}
        {showPurgeConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowPurgeConfirm(false); }}>
            <div className="bg-surface-alt border border-border rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-text-primary">删除所有录像？</h3>
                  <p className="text-sm text-text-secondary mt-1">
                    此操作将从磁盘永久删除<strong className="text-text-primary">所有录像文件及其会话记录</strong>。
                    此操作<strong className="text-red-400">无法撤销</strong>。
                  </p>
                  <p className="text-sm text-text-secondary mt-2">此次删除将被记录到审计日志中。</p>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handlePurge}
                  disabled={purging}
                  className="flex-1 py-2 px-4 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 font-medium text-sm"
                >
                  {purging ? '删除中…' : '是，全部删除'}
                </button>
                <button
                  onClick={() => setShowPurgeConfirm(false)}
                  className="px-4 py-2 border border-border rounded text-text-secondary hover:bg-surface-hover text-sm"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );
}
