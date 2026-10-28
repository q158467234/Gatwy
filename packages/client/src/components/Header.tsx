import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useSettings } from '../hooks/useSettings';

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-yellow-500',
  'bg-red-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function getAvatarColor(username: string) {
  return AVATAR_COLORS[hashStr(username) % AVATAR_COLORS.length];
}

function autoInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return displayName.slice(0, 2).toUpperCase();
}

export type SidebarMode = 'open' | 'closed' | 'hide';

interface HeaderProps {
  sidebarMode: SidebarMode;
  onCycleSidebarMode: () => void;
  onSidebarButtonHoverStart?: () => void;
  onSidebarButtonHoverEnd?: () => void;
  onOpenSettings: (section?: string) => void;
}

export function Header({
  sidebarMode,
  onCycleSidebarMode,
  onSidebarButtonHoverStart,
  onSidebarButtonHoverEnd,
  onOpenSettings,
}: HeaderProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { settings } = useSettings();
  const appVersion = __APP_VERSION__;

  const appName = settings['app.name'] ?? 'Gatwy';
  const appLogo = settings['app.logo'] ?? '';
  const username = user?.username ?? '';
  const displayName = user?.displayName ?? username;
  const initials = autoInitials(displayName || username);
  const avatarColor = getAvatarColor(username);

  // Sync browser tab title with app name
  useEffect(() => {
    document.title = appName;
  }, [appName]);

  return (
    <>
    <header className="sticky top-0 z-40 flex items-center justify-between h-[calc(3rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] px-4 bg-surface-alt border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <button
          onClick={onCycleSidebarMode}
          onMouseEnter={onSidebarButtonHoverStart}
          onMouseLeave={onSidebarButtonHoverEnd}
          className={`p-1.5 rounded hover:bg-surface-hover transition-colors ${
            sidebarMode === 'open'
              ? 'text-accent bg-surface-hover'
              : sidebarMode === 'hide'
              ? 'text-accent bg-surface-hover'
              : 'text-text-secondary'
          }`}
          title={`Sidebar: ${sidebarMode} — click to cycle (Ctrl+\`)`}
        >
          {sidebarMode === 'open' && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          )}
          {sidebarMode === 'hide' && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" strokeDasharray="3 2" />
            </svg>
          )}
          {sidebarMode === 'closed' && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" strokeOpacity="0.25" />
            </svg>
          )}
        </button>
        {appLogo ? (
          <img src={appLogo} alt={appName} className="h-7 w-auto max-w-[140px] object-contain" />
        ) : (
          <span className="text-lg font-bold text-text-primary tracking-tight">{appName}</span>
        )}
        {/*<span className="text-xs text-text-secondary opacity-60 font-mono">v{appVersion}</span>*/}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded hover:bg-surface-hover text-text-secondary"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {/* Gear / settings button */}
        <button
          onClick={() => onOpenSettings()}
          className="p-1.5 rounded hover:bg-surface-hover text-text-secondary"
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Avatar — opens profile section */}
        <button
          onClick={() => onOpenSettings('profile')}
          className={`w-7 h-7 rounded-full ${avatarColor} flex items-center justify-center text-white text-xs font-bold shrink-0 hover:opacity-80 transition-opacity`}
          title={`${displayName} — Profile`}
        >
          {initials}
        </button>

        <div className="flex items-center gap-1 text-sm">
          <span className="text-text-secondary">{displayName}</span>
          <button
            onClick={logout}
            className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded text-sm"
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
    </>
  );
}
