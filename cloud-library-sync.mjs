import { getSupabaseClient } from './account-auth.mjs';

const FAVORITES_TABLE = 'wrld_user_favorites';
const PLAYLISTS_TABLE = 'wrld_user_playlists';
const GUEST_KEY = 'jw-cloud-library-guest-v1';
const GUEST_IMPORTED_KEY = 'jw-cloud-library-guest-imported-v1';
const CACHE_PREFIX = 'jw-cloud-library-cache-v1:';
const BASELINE_PREFIX = 'jw-cloud-library-baseline-v1:';

function emptyState() {
  return { favoriteIds: [], playlists: [] };
}

function readJson(key, fallback = null) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The app still keeps its primary library state in its existing local keys.
  }
}

function normalizeState(value) {
  const favoriteIds = [...new Set((Array.isArray(value?.favoriteIds) ? value.favoriteIds : [])
    .map(id => String(id || '').trim()).filter(Boolean))].sort();
  const seen = new Set();
  const playlists = (Array.isArray(value?.playlists) ? value.playlists : []).flatMap(item => {
    const id = String(item?.id || '').trim();
    const name = String(item?.name || '').trim().slice(0, 80);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name,
      trackIds: [...new Set((Array.isArray(item?.trackIds) ? item.trackIds : [])
        .map(trackId => String(trackId || '').trim()).filter(Boolean))].slice(0, 5000)
    }];
  });
  return { favoriteIds, playlists };
}

function signature(state) {
  return JSON.stringify(normalizeState(state));
}

function playlistMap(state) {
  return new Map(normalizeState(state).playlists.map(item => [item.id, item]));
}

function mergeFirstLogin(local, remote) {
  const playlists = playlistMap(local);
  for (const playlist of normalizeState(remote).playlists) playlists.set(playlist.id, playlist);
  return normalizeState({
    favoriteIds: [...normalizeState(local).favoriteIds, ...normalizeState(remote).favoriteIds],
    playlists: [...playlists.values()]
  });
}

function mergeLocalChanges(baseline, local, remote) {
  const base = normalizeState(baseline);
  const localState = normalizeState(local);
  const remoteState = normalizeState(remote);

  const baseFavorites = new Set(base.favoriteIds);
  const localFavorites = new Set(localState.favoriteIds);
  const mergedFavorites = new Set(remoteState.favoriteIds);
  for (const id of localFavorites) if (!baseFavorites.has(id)) mergedFavorites.add(id);
  for (const id of baseFavorites) if (!localFavorites.has(id)) mergedFavorites.delete(id);

  const basePlaylists = playlistMap(base);
  const localPlaylists = playlistMap(localState);
  const mergedPlaylists = playlistMap(remoteState);
  for (const [id, playlist] of localPlaylists) {
    const previous = basePlaylists.get(id);
    if (!previous || signature({ favoriteIds: [], playlists: [playlist] }) !== signature({ favoriteIds: [], playlists: [previous] })) {
      mergedPlaylists.set(id, playlist);
    }
  }
  for (const id of basePlaylists.keys()) {
    if (!localPlaylists.has(id)) mergedPlaylists.delete(id);
  }

  return normalizeState({ favoriteIds: [...mergedFavorites], playlists: [...mergedPlaylists.values()] });
}

function formatSyncError(error) {
  const message = String(error?.message || error || 'Unknown Supabase error');
  if (/relation .* does not exist|could not find the table|schema cache|permission denied/i.test(message)) {
    return 'Cloud sync needs its Supabase tables. Run supabase/cloud-library.sql in the project SQL Editor, then refresh.';
  }
  return `Cloud sync could not reach Supabase. Your changes remain on this device. (${message.slice(0, 180)})`;
}

export function initCloudLibrarySync({ getLocalState, applyRemoteState, onStatus = () => {} }) {
  let activeUserId = '';
  let activeClient = null;
  let timer = 0;
  let syncInFlight = false;
  let applyingRemote = false;
  let lastSyncedSignature = '';
  let authGeneration = 0;

  const userCacheKey = userId => `${CACHE_PREFIX}${userId}`;
  const userBaselineKey = userId => `${BASELINE_PREFIX}${userId}`;
  const currentState = () => normalizeState(getLocalState?.() || emptyState());
  const cacheUserState = (userId, state) => writeJson(userCacheKey(userId), normalizeState(state));
  const cacheGuestState = state => writeJson(GUEST_KEY, normalizeState(state));

  if (!localStorage.getItem(GUEST_KEY)) cacheGuestState(currentState());

  function setStatus(message, kind = 'info') {
    onStatus(message, kind);
  }

  function applyState(state) {
    applyingRemote = true;
    try {
      applyRemoteState?.(normalizeState(state));
    } finally {
      applyingRemote = false;
    }
  }

  async function readRemote(client, userId) {
    const [favoritesResult, playlistsResult] = await Promise.all([
      client.from(FAVORITES_TABLE).select('track_id').eq('user_id', userId),
      client.from(PLAYLISTS_TABLE).select('id,name,track_ids').eq('user_id', userId)
    ]);
    if (favoritesResult.error) throw favoritesResult.error;
    if (playlistsResult.error) throw playlistsResult.error;
    return normalizeState({
      favoriteIds: (favoritesResult.data || []).map(row => row.track_id),
      playlists: (playlistsResult.data || []).map(row => ({ id: row.id, name: row.name, trackIds: row.track_ids }))
    });
  }

  async function writeRemote(client, userId, desired, remote) {
    const wanted = normalizeState(desired);
    const existing = normalizeState(remote);
    const existingFavorites = new Set(existing.favoriteIds);
    const wantedFavorites = new Set(wanted.favoriteIds);
    const addFavorites = wanted.favoriteIds.filter(id => !existingFavorites.has(id));
    const removeFavorites = existing.favoriteIds.filter(id => !wantedFavorites.has(id));

    if (addFavorites.length) {
      const { error } = await client.from(FAVORITES_TABLE).upsert(
        addFavorites.map(trackId => ({ user_id: userId, track_id: trackId })),
        { onConflict: 'user_id,track_id', ignoreDuplicates: true }
      );
      if (error) throw error;
    }
    if (removeFavorites.length) {
      const { error } = await client.from(FAVORITES_TABLE).delete().eq('user_id', userId).in('track_id', removeFavorites);
      if (error) throw error;
    }

    const oldPlaylists = playlistMap(existing);
    const wantedPlaylists = playlistMap(wanted);
    const changedPlaylists = [...wantedPlaylists.values()].filter(playlist => {
      const previous = oldPlaylists.get(playlist.id);
      return !previous || signature({ playlists: [previous] }) !== signature({ playlists: [playlist] });
    });
    if (changedPlaylists.length) {
      const { error } = await client.from(PLAYLISTS_TABLE).upsert(
        changedPlaylists.map(playlist => ({
          user_id: userId,
          id: playlist.id,
          name: playlist.name,
          track_ids: playlist.trackIds,
          updated_at: new Date().toISOString()
        })),
        { onConflict: 'user_id,id' }
      );
      if (error) throw error;
    }
    const removePlaylists = [...oldPlaylists.keys()].filter(id => !wantedPlaylists.has(id));
    if (removePlaylists.length) {
      const { error } = await client.from(PLAYLISTS_TABLE).delete().eq('user_id', userId).in('id', removePlaylists);
      if (error) throw error;
    }
  }

  async function syncCurrentState(userId, client, generation) {
    if (!userId || syncInFlight) return;
    syncInFlight = true;
    try {
      const local = currentState();
      cacheUserState(userId, local);
      const remote = await readRemote(client, userId);
      if (generation !== authGeneration || userId !== activeUserId) return;

      const baseline = readJson(userBaselineKey(userId), null);
      const desired = baseline
        ? mergeLocalChanges(baseline, currentState(), remote)
        : mergeFirstLogin(local, remote);
      await writeRemote(client, userId, desired, remote);
      if (generation !== authGeneration || userId !== activeUserId) return;

      applyState(desired);
      writeJson(userCacheKey(userId), desired);
      writeJson(userBaselineKey(userId), desired);
      if (!baseline && !localStorage.getItem(GUEST_IMPORTED_KEY)) localStorage.setItem(GUEST_IMPORTED_KEY, userId);
      lastSyncedSignature = signature(desired);
      setStatus(`Synced ${desired.favoriteIds.length} favorites and ${desired.playlists.length} playlists to your account. Audio files stay on this device.`, 'success');
    } catch (error) {
      if (generation === authGeneration && userId === activeUserId) setStatus(formatSyncError(error), 'error');
    } finally {
      syncInFlight = false;
      if (userId === activeUserId && signature(currentState()) !== lastSyncedSignature) scheduleSync(250);
    }
  }

  function scheduleSync(delay = 500) {
    if (!activeUserId || !activeClient || applyingRemote) return;
    cacheUserState(activeUserId, currentState());
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (syncInFlight) return;
      void syncCurrentState(activeUserId, activeClient, authGeneration);
    }, delay);
  }

  async function handleAuthState(detail) {
    const user = detail?.user || null;
    const nextUserId = user?.id || '';
    if (nextUserId === activeUserId) return;

    const previousUserId = activeUserId;
    if (previousUserId) cacheUserState(previousUserId, currentState());
    activeUserId = nextUserId;
    activeClient = detail?.client || null;
    const generation = ++authGeneration;
    clearTimeout(timer);

    if (!nextUserId) {
      lastSyncedSignature = '';
      applyState(readJson(GUEST_KEY, emptyState()));
      setStatus('Sign in to sync favorites and playlists between devices. Audio files stay on this device.', 'info');
      return;
    }

    if (!activeClient) {
      try { activeClient = await getSupabaseClient(); } catch (error) {
        setStatus(formatSyncError(error), 'error');
        return;
      }
    }

    const cached = readJson(userCacheKey(nextUserId), null);
    const guestImported = Boolean(localStorage.getItem(GUEST_IMPORTED_KEY));
    if (cached) applyState(cached);
    else if (guestImported) applyState(emptyState());
    else applyState(readJson(GUEST_KEY, currentState()));

    setStatus('Syncing your favorites and playlists…', 'info');
    await syncCurrentState(nextUserId, activeClient, generation);
  }

  function localStateChanged() {
    if (applyingRemote) return;
    const state = currentState();
    if (activeUserId) {
      cacheUserState(activeUserId, state);
      if (signature(state) !== lastSyncedSignature) scheduleSync();
    } else {
      cacheGuestState(state);
    }
  }

  window.addEventListener('wrld-auth-state', event => {
    setTimeout(() => { void handleAuthState(event.detail); }, 0);
  });
  window.addEventListener('online', () => scheduleSync(100));
  window.addEventListener('focus', () => scheduleSync(100));

  return { localStateChanged };
}
