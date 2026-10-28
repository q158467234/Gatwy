import { useState } from 'react';
import { NotifConfigTab } from './notifications/NotifConfigTab';
import { NotifRulesTab } from './notifications/NotifRulesTab';
import { NotifHistoryTab } from './notifications/NotifHistoryTab';

type Tab = 'config' | 'rules' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'config', label: '配置' },
  { id: 'rules', label: '规则' },
  { id: 'history', label: '历史' },
];

export function NotificationsSettings() {
  const [tab, setTab] = useState<Tab>('config');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-text-primary">通知</h2>
        <p className="text-sm text-text-secondary mt-0.5">
          配置通知渠道并创建自动告警规则。
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'config'   && <NotifConfigTab />}
      {tab === 'rules'    && <NotifRulesTab />}
      {tab === 'history'  && <NotifHistoryTab />}
    </div>
  );
}
