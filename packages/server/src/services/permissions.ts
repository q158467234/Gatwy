import { queryOne, queryAll } from '../db/helpers.js';

/** All recognised permission keys */
export const ALL_PERMISSIONS = [
  'connections.create', 'connections.edit_own', 'connections.delete_own',
  'connections.edit_any', 'connections.delete_any', 'connections.share', 'connections.import_export',
  'credentials.share', 'credentials.use_shared',
  'sessions.view_own', 'sessions.view_any', 'sessions.delete', 'sessions.view_active', 'sessions.disconnect',
  'audit.view_own', 'audit.view_any',
  'users.manage', 'settings.manage', 'settings.auth_providers', 'settings.security', 'settings.backup', 'settings.notifications',
  'roles.manage',
  'protocols.ssh', 'protocols.rdp', 'protocols.vnc', 'protocols.moonlight', 'protocols.smb', 'protocols.ftp', 'protocols.telnet',
  'protocols.postgres', 'protocols.mysql',
] as const;

export type PermissionKey = typeof ALL_PERMISSIONS[number];

/** Default permissions for built-in roles */
export const DEFAULT_BUILTIN_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: [...ALL_PERMISSIONS],
  user: [
    'connections.create', 'connections.edit_own', 'connections.delete_own', 'connections.share', 'connections.import_export',
    'sessions.view_own',
    'audit.view_own',
    'protocols.ssh', 'protocols.rdp', 'protocols.vnc', 'protocols.moonlight', 'protocols.smb', 'protocols.ftp', 'protocols.telnet',
    'protocols.postgres', 'protocols.mysql',
  ],
};

/** Human-friendly permission groups for UI */
export const PERMISSION_GROUPS: Record<string, { label: string; permissions: { key: PermissionKey; label: string }[] }> = {
  connections: {
    label: '连接',
    permissions: [
      { key: 'connections.create', label: '创建连接' },
      { key: 'connections.edit_own', label: '编辑自己的连接' },
      { key: 'connections.delete_own', label: '删除自己的连接' },
      { key: 'connections.edit_any', label: '编辑任意连接' },
      { key: 'connections.delete_any', label: '删除任意连接' },
      { key: 'connections.share', label: '共享连接' },
      { key: 'connections.import_export', label: '导入 / 导出连接' },
    ],
  },
  credentials: {
    label: '凭据库',
    permissions: [
      { key: 'credentials.share', label: '创建和管理共享凭据' },
      { key: 'credentials.use_shared', label: '在自己的连接中使用共享凭据' },
    ],
  },
  sessions: {
    label: '会话与录像',
    permissions: [
      { key: 'sessions.view_own', label: '查看自己的录像' },
      { key: 'sessions.view_any', label: '查看所有录像' },
      { key: 'sessions.delete', label: '删除 / 清除录像' },
      { key: 'sessions.view_active', label: '查看活动会话（实时）' },
      { key: 'sessions.disconnect', label: '断开其他用户的活动会话' },
    ],
  },
  audit: {
    label: '审计日志',
    permissions: [
      { key: 'audit.view_own', label: '查看自己的审计记录' },
      { key: 'audit.view_any', label: '查看所有审计记录' },
    ],
  },
  admin: {
    label: '管理',
    permissions: [
      { key: 'users.manage', label: '管理用户' },
      { key: 'settings.manage', label: '全局设置' },
      { key: 'settings.auth_providers', label: '身份验证提供方' },
      { key: 'settings.security', label: '安全设置' },
      { key: 'settings.backup', label: '备份与恢复' },
      { key: 'settings.notifications', label: '通知' },
      { key: 'roles.manage', label: '管理角色' },
    ],
  },
  protocols: {
    label: '协议',
    permissions: [
      { key: 'protocols.ssh', label: 'SSH' },
      { key: 'protocols.rdp', label: 'RDP' },
      { key: 'protocols.vnc', label: 'VNC' },
      { key: 'protocols.moonlight', label: 'Moonlight / Sunshine' },
      { key: 'protocols.smb', label: 'SMB' },
      { key: 'protocols.ftp', label: 'FTP' },
      { key: 'protocols.telnet', label: 'Telnet' },
      { key: 'protocols.postgres', label: 'PostgreSQL' },
      { key: 'protocols.mysql', label: 'MySQL / MariaDB' },
    ],
  },
};

/**
 * Resolve the permission set for a given role ID.
 * Returns the parsed JSON array from the roles table.
 */
export function getPermissionsForRole(roleId: string): string[] {
  const row = queryOne<{ permissions_json: string }>('SELECT permissions_json FROM roles WHERE id = ?', [roleId]);
  if (!row) return [];
  try {
    return JSON.parse(row.permissions_json) as string[];
  } catch {
    return [];
  }
}

/**
 * Check whether a role has a specific permission.
 */
export function roleHasPermission(roleId: string, perm: PermissionKey): boolean {
  return getPermissionsForRole(roleId).includes(perm);
}

/**
 * Check whether a user (by ID) has a specific permission.
 * Looks up their role from the users table then checks the role's permissions.
 */
export function userHasPermission(userId: string, perm: PermissionKey): boolean {
  const user = queryOne<{ role: string }>('SELECT role FROM users WHERE id = ?', [userId]);
  if (!user) return false;
  return roleHasPermission(user.role, perm);
}

/**
 * Whether the connection_groups row `groupId` exists and is owned by `ownerId`.
 * Single source of truth for the cross-owner nesting guard: a connection or a
 * sub-folder may only be filed under / reparented onto a folder its own owner
 * holds — never a folder merely shared to them — or it would be grafted into
 * whatever that folder is shared with.
 */
export function groupOwnedBy(groupId: string, ownerId: string): boolean {
  const row = queryOne<{ user_id: string }>('SELECT user_id FROM connection_groups WHERE id = ?', [groupId]);
  return !!row && row.user_id === ownerId;
}

/**
 * BFS from `rootIds` through connection_groups, descending into a child only when its
 * owner matches its parent's owner — a group grafted (via parent_id) under someone
 * else's folder must never inherit whatever that folder is reachable through.
 * Shared by accessibleSharedGroupIds (roots = directly-shared groups) and
 * descendantGroupIds (root = a single folder, e.g. the one just being shared).
 */
function ownerScopedDescendants(rootIds: string[]): string[] {
  if (rootIds.length === 0) return [];

  const allGroups = queryAll<{ id: string; parent_id: string | null; user_id: string }>(
    'SELECT id, parent_id, user_id FROM connection_groups',
  );
  const ownerOf = new Map(allGroups.map((g) => [g.id, g.user_id]));
  const childrenOf = new Map<string, string[]>();
  for (const g of allGroups) {
    if (!g.parent_id) continue;
    const list = childrenOf.get(g.parent_id) ?? [];
    list.push(g.id);
    childrenOf.set(g.parent_id, list);
  }

  // A root that no longer exists (deleted group, stale share row) seeds nothing.
  const validRoots = rootIds.filter((id) => ownerOf.has(id));
  if (validRoots.length === 0) return [];

  const result = new Set<string>();
  const queue = [...validRoots];
  while (queue.length > 0) {
    const gid = queue.pop()!;
    if (result.has(gid)) continue;
    result.add(gid);
    const owner = ownerOf.get(gid);
    for (const child of childrenOf.get(gid) ?? []) {
      if (ownerOf.get(child) === owner) queue.push(child);
    }
  }
  return [...result];
}

/**
 * All connection_group IDs reachable via a folder share to this user/role: the directly
 * shared groups plus every descendant. Resolved fresh on every call (never materialized
 * into per-connection rows), so a new sub-folder or a new connection dropped into an
 * already-shared folder inherits access immediately — no share row needs to be copied.
 */
export function accessibleSharedGroupIds(userId: string, role: string): string[] {
  const directRows = queryAll<{ resource_id: string }>(
    `SELECT DISTINCT resource_id FROM resource_shares WHERE resource_type = 'group' AND ((share_type = 'user' AND target_id = ?) OR (share_type = 'role' AND target_id = ?))`,
    [userId, role],
  );
  return ownerScopedDescendants(directRows.map((r) => r.resource_id));
}

/**
 * A folder plus every owner-scoped descendant beneath it — the full subtree that
 * becomes reachable when `rootId` itself is shared, regardless of who it's shared with.
 * Used to scan the about-to-be-shared subtree for connections whose credentials won't
 * actually be visible to the recipients (see connectionsWithUnshareableCredential).
 */
export function descendantGroupIds(rootId: string): string[] {
  return ownerScopedDescendants([rootId]);
}

/**
 * Every connection_group ID reachable via a folder share to this user/role at
 * `capability = 'edit'` — same shape as accessibleSharedGroupIds, filtered to editor
 * shares only. Used to gate the collaborator write routes (create/modify/delete inside
 * a shared folder); accessibleSharedGroupIds (any capability) still gates read access.
 */
export function editableSharedGroupIds(userId: string, role: string): string[] {
  const directRows = queryAll<{ resource_id: string }>(
    `SELECT DISTINCT resource_id FROM resource_shares
     WHERE resource_type = 'group' AND capability = 'edit'
       AND ((share_type = 'user' AND target_id = ?) OR (share_type = 'role' AND target_id = ?))`,
    [userId, role],
  );
  return ownerScopedDescendants(directRows.map((r) => r.resource_id));
}

/** True when `groupId` is writable by `userId` as an editor collaborator (not owner). */
export function canWriteSharedGroup(groupId: string, userId: string, role: string): boolean {
  return editableSharedGroupIds(userId, role).includes(groupId);
}

/**
 * Every directly-shared (capability='edit') group that is an ancestor-or-self of `groupId`
 * and grants this user/role write access to it — i.e. every distinct shared-folder "branch"
 * `groupId` is reachable through. Used to confine an editor's reparenting to sub-folders of
 * the SAME shared folder, within one such branch — canWriteSharedGroup alone only
 * proves a folder is writable, not that it's part of the specific branch being reorganized,
 * so an editor holding two independent edit-shares from the same owner could otherwise use
 * one to reach into the other.
 */
export function editableSharedRootsFor(groupId: string, userId: string, role: string): Set<string> {
  const directRows = queryAll<{ resource_id: string }>(
    `SELECT DISTINCT resource_id FROM resource_shares
     WHERE resource_type = 'group' AND capability = 'edit'
       AND ((share_type = 'user' AND target_id = ?) OR (share_type = 'role' AND target_id = ?))`,
    [userId, role],
  );
  const roots = new Set<string>();
  for (const row of directRows) {
    if (ownerScopedDescendants([row.resource_id]).includes(groupId)) roots.add(row.resource_id);
  }
  return roots;
}

/** True when `sourceGroupId` and `targetGroupId` share at least one common editable-share
 * branch (see editableSharedRootsFor) — the boundary that confines editor reparenting. */
export function sameSharedBranch(sourceGroupId: string, targetGroupId: string, userId: string, role: string): boolean {
  const sourceRoots = editableSharedRootsFor(sourceGroupId, userId, role);
  if (sourceRoots.size === 0) return false;
  const targetRoots = editableSharedRootsFor(targetGroupId, userId, role);
  for (const r of targetRoots) if (sourceRoots.has(r)) return true;
  return false;
}

/**
 * True when `groupId` is referenced by ANY folder share, regardless of who it was shared
 * with or who is asking — not just whichever share granted the current caller access.
 * Editor collaborators may write inside a shared folder's contents, but must never be able
 * to rename/delete the shared folder itself, or an independently-shared sub-folder nested
 * inside it (that would silently destroy someone else's share when resource_shares had no
 * FK left to cascade it automatically — see the cascade-delete cleanup in routes/connections.ts).
 */
export function isSharedGroup(groupId: string): boolean {
  return !!queryOne<{ id: string }>(
    `SELECT id FROM resource_shares WHERE resource_type = 'group' AND resource_id = ? LIMIT 1`,
    [groupId],
  );
}

/**
 * Same guard as isSharedGroup, for a single connection: true when `connectionId` carries
 * any share of its own. An editor collaborator may not delete a connection while this is
 * true — deleting it would silently destroy that share, since resource_shares has no FK
 * cascade to fall back on. The owner (or connections.delete_any) is never subject to this
 * check — see the DELETE routes in routes/connections.ts.
 */
export function isSharedConnection(connectionId: string): boolean {
  return !!queryOne<{ id: string }>(
    `SELECT id FROM resource_shares WHERE resource_type = 'connection' AND resource_id = ? LIMIT 1`,
    [connectionId],
  );
}

/**
 * Every connection_group ID that will actually be removed by SQLite's ON DELETE CASCADE
 * (connection_groups.parent_id → connection_groups.id) when `rootId` is deleted — the
 * root plus ALL descendants, regardless of owner. Unlike ownerScopedDescendants (used for
 * permission checks, where a cross-owner "planted" child must never inherit access), a
 * cleanup walk must not skip that child: SQLite will delete its row anyway, so any
 * resource_shares referencing it would be left orphaned if this walk stopped early.
 */
export function allDescendantGroupIdsUnscoped(rootId: string): string[] {
  const allGroups = queryAll<{ id: string; parent_id: string | null }>(
    'SELECT id, parent_id FROM connection_groups',
  );
  const childrenOf = new Map<string, string[]>();
  for (const g of allGroups) {
    if (!g.parent_id) continue;
    const list = childrenOf.get(g.parent_id) ?? [];
    list.push(g.id);
    childrenOf.set(g.parent_id, list);
  }
  if (!allGroups.some((g) => g.id === rootId)) return [];

  const result = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const gid = queue.pop()!;
    if (result.has(gid)) continue;
    result.add(gid);
    for (const child of childrenOf.get(gid) ?? []) queue.push(child);
  }
  return [...result];
}

export interface SharedResourceBlockers {
  connections: { id: string; name: string; shareCount: number }[];
  groups: { id: string; name: string; shareCount: number }[];
}

/**
 * Resources that deleting `ownerId` would take away from people they are shared with:
 * the user's own connections and folders that carry a share, plus any shared folder
 * anywhere beneath one of their folders (regardless of who owns it — the parent_id
 * cascade removes it too, see allDescendantGroupIdsUnscoped). Used to block user
 * deletion with a 409 until those shares are removed, same idea as
 * sharedCredentialsInUseByOthers.
 */
export function sharedResourcesOwnedBy(ownerId: string): SharedResourceBlockers {
  const connections = queryAll<{ id: string; name: string; shareCount: number }>(
    `SELECT c.id, c.name, COUNT(rs.id) AS shareCount
     FROM connections c
     JOIN resource_shares rs ON rs.resource_type = 'connection' AND rs.resource_id = c.id
     WHERE c.user_id = ?
     GROUP BY c.id
     ORDER BY c.name COLLATE NOCASE`,
    [ownerId],
  );

  const ownedGroupIds = queryAll<{ id: string }>('SELECT id FROM connection_groups WHERE user_id = ?', [ownerId]);
  const doomedGroupIds = [...new Set(ownedGroupIds.flatMap((g) => allDescendantGroupIdsUnscoped(g.id)))];
  const groups = doomedGroupIds.length === 0 ? [] : queryAll<{ id: string; name: string; shareCount: number }>(
    `SELECT g.id, g.name, COUNT(rs.id) AS shareCount
     FROM connection_groups g
     JOIN resource_shares rs ON rs.resource_type = 'group' AND rs.resource_id = g.id
     WHERE g.id IN (${doomedGroupIds.map(() => '?').join(',')})
     GROUP BY g.id
     ORDER BY g.name COLLATE NOCASE`,
    doomedGroupIds,
  );

  return { connections, groups };
}

/**
 * Walks UP from `groupId` through parent_id (the opposite direction of every other helper
 * in this file, which all walk down) to tell whether `groupId` or any ancestor is itself
 * shared as a folder. Used to extend the private-credential warning (see
 * connectionsWithUnshareableCredential) to connection create/update, not just to saving a
 * folder's shares: a connection filed under an already-shared folder is retroactively
 * affected the same way a newly-shared folder's existing connections are.
 */
export function isInsideSharedGroup(groupId: string | null): boolean {
  let current = groupId;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current)) return false; // defensive: a cyclic parent_id chain should never exist
    visited.add(current);
    if (isSharedGroup(current)) return true;
    const row = queryOne<{ parent_id: string | null }>(
      'SELECT parent_id FROM connection_groups WHERE id = ?', [current],
    );
    current = row?.parent_id ?? null;
  }
  return false;
}

/**
 * Build a SQL WHERE fragment + params: true when a connection is owned by, globally
 * shared to, individually shared to, or reachable via a shared parent folder for, the
 * given user/role. Single source of truth for connection access — every route that
 * gates connection access (SFTP/FTP/SMB/DB, sessions, WS proxies, the connections list)
 * must go through this rather than re-deriving the condition.
 */
export function connectionAccessWhere(alias: string, userId: string, role: string): { where: string; params: unknown[] } {
  const sharedGroups = accessibleSharedGroupIds(userId, role);
  // Require the connection's owner to match its folder's actual owner, not just group_id
  // membership — otherwise a connection "planted" (by direct DB write, or a bug elsewhere)
  // into someone else's shared folder would be reachable by everyone that folder is shared
  // with. Write-side routes already reject a mismatched groupId; this is defense in depth.
  const groupClause = sharedGroups.length > 0
    ? ` OR (${alias}.group_id IN (${sharedGroups.map(() => '?').join(',')}) AND ${alias}.user_id = (SELECT cg.user_id FROM connection_groups cg WHERE cg.id = ${alias}.group_id))`
    : '';
  return {
    where: `(${alias}.user_id = ? OR ${alias}.shared = 1 OR ${alias}.id IN (SELECT rs.resource_id FROM resource_shares rs WHERE rs.resource_type = 'connection' AND ((rs.share_type = 'user' AND rs.target_id = ?) OR (rs.share_type = 'role' AND rs.target_id = ?)))${groupClause})`,
    params: [userId, userId, role, ...sharedGroups],
  };
}

/**
 * Build SQL WHERE clause + params for connection access (used by WS proxies).
 * Checks ownership, shared=1, resource_shares, and shared-folder inheritance.
 */
export function wsCanAccess(userId: string): { where: string; params: unknown[] } {
  const user = queryOne<{ role: string }>('SELECT role FROM users WHERE id = ?', [userId]);
  const role = user?.role ?? '';
  return connectionAccessWhere('connections', userId, role);
}
