'use strict';

const { buildRobloxCookieHeader } = require('./common');

async function getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');
  let allGames = [];
  let cursor = null;
  while (allGames.length < maxPlaceIds) {
    let url =
      creatorType === 'group'
        ? `https://games.roblox.com/v2/groups/${creatorId}/games?limit=50`
        : `https://games.roblox.com/v2/users/${creatorId}/games?sortOrder=Asc&limit=50`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    const resp = await fetch(url, { headers: { Cookie: cookieHeader } });
    if (!resp.ok) throw new Error(`Failed to get games (${resp.status})`);
    const data = await resp.json();
    if (!data?.data?.length) break;
    allGames = allGames.concat(data.data);
    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
  }
  const rootPlaces = allGames
    .slice(0, maxPlaceIds)
    .map(g => g.rootPlace?.id || g.id || null)
    .filter(Boolean);
  if (!rootPlaces.length) throw new Error('No root places found');
  return rootPlaces;
}

async function getMultiplePlaceIds(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  try {
    const places = await getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds);
    return Array.isArray(places) ? places : [places];
  } catch {
    return [];
  }
}

async function getAuthenticatedUserId(cookie) {
  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');
  const resp = await fetch('https://users.roblox.com/v1/users/authenticated', {
    headers: { Cookie: cookieHeader, 'User-Agent': 'RobloxStudio/WinInet' },
  });
  if (!resp.ok) throw new Error(`Failed to get user ID (${resp.status})`);
  const data = await resp.json();
  if (!data.id) throw new Error('No user ID in response');
  return String(data.id);
}

async function getAuthenticatedUserInfo(cookie) {
  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');
  const resp = await fetch('https://users.roblox.com/v1/users/authenticated', {
    headers: { Cookie: cookieHeader, 'User-Agent': 'RobloxStudio/WinInet' },
  });
  if (!resp.ok) throw new Error(`Failed to get user info (${resp.status})`);
  const data = await resp.json();
  if (!data.id) throw new Error('No user ID in response');
  const userId = String(data.id);
  let avatarUrl = null;
  try {
    const ar = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=48x48&format=Png&isCircular=true`,
      { headers: { 'User-Agent': 'RobloxStudio/WinInet' } }
    );
    if (ar.ok) avatarUrl = (await ar.json())?.data?.[0]?.imageUrl || null;
  } catch {}
  return {
    id: userId,
    name: data.name || '',
    displayName: data.displayName || data.name || '',
    avatarUrl,
  };
}

async function getUserGroups(cookie) {
  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');
  const userResp = await fetch('https://users.roblox.com/v1/users/authenticated', {
    headers: { Cookie: cookieHeader, 'User-Agent': 'RobloxStudio/WinInet' },
  });
  if (!userResp.ok) throw new Error(`Failed to get user ID (${userResp.status})`);
  const { id } = await userResp.json();
  if (!id) throw new Error('No user ID');
  const groupsResp = await fetch(`https://groups.roblox.com/v1/users/${id}/groups/roles`, {
    headers: { Cookie: cookieHeader, 'User-Agent': 'RobloxStudio/WinInet' },
  });
  if (!groupsResp.ok) throw new Error(`Failed to get groups (${groupsResp.status})`);
  return ((await groupsResp.json()).data || [])
    .map(item => ({
      id: String(item.group?.id || ''),
      name: item.group?.name || 'Unknown Group',
      role: item.role?.name || '',
    }))
    .filter(g => g.id);
}

async function canUploadToGroup(cookie, groupId, apiKey) {
  if (!cookie || !groupId || !apiKey) return { canUpload: false, reason: 'Missing credentials' };
  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) return { canUpload: false, reason: 'Invalid cookie' };
  try {
    const fd = new FormData();
    fd.append(
      'request',
      JSON.stringify({
        assetType: 'Animation',
        displayName: '__permission_test__',
        description: '',
        creationContext: { creator: { groupId: String(groupId) } },
      })
    );
    fd.append('fileContent', new Blob([new Uint8Array(0)], { type: 'model/x-rbxm' }), 'test.rbxm');
    const resp = await fetch('https://apis.roblox.com/assets/v1/assets', {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: fd,
    });
    if (resp.status === 401 || resp.status === 403) {
      const d = await resp.json();
      return { canUpload: false, reason: d?.error?.message || 'Permission denied' };
    }
    if (resp.status === 400) {
      const d = await resp.json();
      const msg = d?.error?.message || '';
      if (msg.includes('permission') || msg.includes('authorized'))
        return { canUpload: false, reason: msg };
    }
    return { canUpload: true };
  } catch (err) {
    return { canUpload: false, reason: err.message };
  }
}

module.exports = {
  getPlaceIdFromCreator,
  getMultiplePlaceIds,
  getAuthenticatedUserId,
  getAuthenticatedUserInfo,
  getUserGroups,
  canUploadToGroup,
};
