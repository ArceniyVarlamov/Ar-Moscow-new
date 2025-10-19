const ASSET_SOURCES = {
  lariskaModel: './assets/models/Lariska-2.glb',
  souzmultiparkModel: './assets/models/souzmultipark.glb',
  rabbitModel: './assets/models/rabbit.glb',
  orangeModel: './assets/models/orange.glb',
  noteModel: './assets/models/note.glb',
  cheeseModel: './assets/models/cheese.glb',
  ticketModel: './assets/models/ticket.glb',
  cuteStarModel: './assets/models/cute_little_star.glb',
  treeModel: './assets/models/tree.glb',
  sunModel: './assets/models/sun.glb',
  // audio assets
  birdsAudio: './assets/music/birds.mp3',
  genaAudio: './assets/music/gena.mp3',
  lariskaAudio: './assets/music/lariska.mp3',
  wolf2Audio: './assets/music/wolf_2.mp3',
  wolf3Audio: './assets/music/wolf_3.mp3',
  wolfAhAudio: './assets/music/wolf_ah.mp3',
  // mouse guide voiceovers
  mouse_helphimAudio: './assets/music/mouse_helphim.mp3',
  mouse_goodphotoAudio: './assets/music/mouse_goodphoto.mp3',
  mouse_gogenaAudio: './assets/music/mouse_gogena.mp3',
  mouse_gocheburAudio: './assets/music/mouse_gochebur.mp3',
  mouse_goshepokAudio: './assets/music/mouse_goshepok.mp3',
  mouse_gowolfAudio: './assets/music/mouse_gowolf.mp3',
  mouse_eatcheeseAudio: './assets/music/mouse_eatcheese.mp3',
  mouse_parkAudio: './assets/music/mouse_park.mp3',
  // mind targets
  wolfMind: './assets/targets/wolf.mind',
  genaMind: './assets/targets/gena.mind',
  cheburashkaMind: './assets/targets/cheburashka.mind',
  shepoklakMind: './assets/targets/shepoklak.mind',
  lariskaMind: './assets/targets/lariska.mind',
  trioMind: './assets/targets/trio.mind',
  cheburashkastandMind: './assets/targets/cheburashkastand.mind',
};

const GROUP_MAP = {
  core: ['lariskaModel', 'mouse_helphimAudio', 'wolfMind'],
  step_intro: ['souzmultiparkModel', 'rabbitModel', 'wolf2Audio', 'wolf3Audio', 'wolfAhAudio', 'mouse_gowolfAudio', 'mouse_goodphotoAudio', 'mouse_gogenaAudio', 'wolfMind', 'trioMind'],
  step_gena: ['noteModel', 'genaAudio', 'mouse_gocheburAudio', 'genaMind'],
  step_cheburashka: ['orangeModel', 'mouse_goshepokAudio', 'cheburashkaMind'],
  step_shapoklyak: ['cheeseModel', 'lariskaAudio', 'mouse_eatcheeseAudio', 'shepoklakMind'],
  step_trio: ['souzmultiparkModel', 'treeModel', 'sunModel', 'birdsAudio', 'mouse_parkAudio', 'trioMind'],
  step_cheburashkastand: ['ticketModel', 'cuteStarModel', 'mouse_parkAudio', 'cheburashkastandMind'],
  hero_cheburashka: ['orangeModel', 'cheburashkaMind'],
  hero_gena: ['noteModel', 'genaAudio', 'genaMind'],
  hero_shepoklak: ['cheeseModel', 'lariskaAudio', 'shepoklakMind'],
  hero_trio: ['souzmultiparkModel', 'treeModel', 'sunModel', 'trioMind'],
  hero_souzmultipark: ['ticketModel', 'cuteStarModel', 'mouse_parkAudio', 'cheburashkastandMind'],
  hero_wolf: ['souzmultiparkModel', 'rabbitModel', 'wolf2Audio', 'wolf3Audio', 'wolfAhAudio', 'wolfMind'],
  voice_mouse: [
    'mouse_helphimAudio','mouse_goodphotoAudio','mouse_gogenaAudio','mouse_gocheburAudio',
    'mouse_goshepokAudio','mouse_gowolfAudio','mouse_eatcheeseAudio','mouse_parkAudio'
  ],
};

function uniqueIds(list) {
  const seen = new Set();
  const result = [];
  for (const id of list) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function createAssetPreloader({ assetsEl = document.querySelector('a-assets'), onStateChange } = {}) {
  if (!assetsEl) throw new Error('a-assets element is required for preloader');

  const entries = new Map();
  const queue = [];
  let active = null;
  const stateListeners = new Set();
  const watchers = new Set();
  if (typeof onStateChange === 'function') stateListeners.add(onStateChange);

  const assetTypeFor = (src, existing) => {
    const elTag = existing?.tagName?.toLowerCase?.();
    if (elTag === 'audio') return 'audio';
    const candidate = (existing?.getAttribute?.('src') || src || '').toString();
    if (/\.mp3(\?.*)?$/i.test(candidate)) return 'audio';
    if (/\.mind(\?.*)?$/i.test(candidate)) return 'mind';
    return 'asset';
  };

  const summarizeIds = (ids = []) => {
    const detail = {};
    let loaded = 0;
    let loading = 0;
    let idle = 0;
    let error = 0;
    let missing = 0;
    ids.forEach((id) => {
      const entry = entries.get(id);
      let status = entry?.status;
      if (!status) {
        status = ASSET_SOURCES[id] ? 'idle' : 'missing';
      }
      detail[id] = status;
      if (status === 'loaded') loaded += 1;
      else if (status === 'loading') loading += 1;
      else if (status === 'error') error += 1;
      else if (status === 'missing') missing += 1;
      else idle += 1;
    });
    const total = ids.length;
    const pending = Math.max(0, total - loaded - error);
    return {
      ids: [...ids],
      total,
      loaded,
      loading,
      idle,
      error,
      missing,
      pending,
      progress: total === 0 ? 1 : loaded / total,
      ready: total > 0 ? loaded === total && error === 0 : true,
      statusById: detail,
    };
  };

  const notify = () => {
    const payload = {};
    entries.forEach((entry, id) => { payload[id] = entry.status; });
    const state = { active: !!active, queue: queue.map((item) => item.id), statusById: payload };
    Array.from(stateListeners).forEach((listener) => {
      try { listener(state); } catch (error) { console.warn('[Preloader] state listener failed', error); }
    });
    Array.from(watchers).forEach((watcher) => {
      try { watcher.callback(summarizeIds(watcher.ids)); } catch (error) { console.warn('[Preloader] watcher failed', error); }
    });
  };

  const ensureEntry = (id) => {
    if (!entries.has(id)) {
      const existing = assetsEl.querySelector(`#${id}`);
      const src = ASSET_SOURCES[id];
      const type = assetTypeFor(src, existing);
      entries.set(id, {
        id,
        el: existing || null,
        src,
        status: src ? 'idle' : 'missing',
        promise: null,
        type,
        objectUrl: null,
        buffer: null,
      });
    }
    const entry = entries.get(id);
    if (entry && !entry.type) {
      entry.type = assetTypeFor(entry.src, entry.el);
    }
    if (entry && !('objectUrl' in entry)) entry.objectUrl = null;
    if (entry && !('buffer' in entry)) entry.buffer = null;
    return entry;
  };

  const processQueue = () => {
    if (active || queue.length === 0) {
      notify();
      return;
    }
    const entry = queue.shift();
    active = entry;
    entry.status = 'loading';

    const finalize = (status, error) => {
      entry.status = status;
      active = null;
      notify();
      if (status === 'loaded') {
        entry.resolve?.();
      } else {
        entry.reject?.(error || new Error(`Failed to load asset ${entry.id}`));
      }
      processQueue();
    };

    let finished = false;
    const settle = (status, error) => {
      if (finished) return;
      finished = true;
      finalize(status, error);
    };

    if (!entry.src) {
      settle('error', new Error(`Missing src for asset ${entry.id}`));
      return;
    }

    if (entry.type === 'mind') {
      (async () => {
        try {
          const response = await fetch(entry.src, { cache: 'force-cache' });
          if (!response?.ok) {
            throw new Error(`Failed to fetch asset ${entry.id}: ${response?.status || 'no status'}`);
          }
          const buffer = await response.arrayBuffer();
          entry.buffer = buffer;
          if (!entry.objectUrl) {
            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            entry.objectUrl = URL.createObjectURL(blob);
          }
          settle('loaded');
        } catch (error) {
          settle('error', error);
        }
      })();
      return;
    }

    const onLoad = () => {
      cleanup();
      settle('loaded');
    };
    const onError = (ev) => {
      cleanup();
      settle('error', ev?.detail || ev);
    };
    const cleanup = () => {
      const el = entry.el;
      if (!el) return;
      try { el.removeEventListener('loaded', onLoad); } catch(_) {}
      try { el.removeEventListener('error', onError); } catch(_) {}
      try { el.removeEventListener('canplaythrough', onLoad); } catch(_) {}
      try { el.removeEventListener('loadeddata', onLoad); } catch(_) {}
      try { el.removeEventListener('loadedmetadata', onLoad); } catch(_) {}
    };
    const checkAlreadyReady = () => {
      if (finished) return true;
      const el = entry.el;
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'audio') {
        const ready = typeof el.readyState === 'number' && el.readyState >= 2;
        if (ready) {
          onLoad();
          return true;
        }
      } else {
        if (el.hasLoaded === true) {
          onLoad();
          return true;
        }
      }
      return false;
    };

    // Create element if needed, set listeners, set src, then append to DOM
    try {
      if (!entry.el) {
        const isAudio = entry.type === 'audio';
        entry.el = document.createElement(isAudio ? 'audio' : 'a-asset-item');
        entry.el.id = entry.id;
        if (isAudio) {
          try { entry.el.setAttribute('preload', 'auto'); } catch(_) {}
          try { entry.el.setAttribute('crossorigin', 'anonymous'); } catch(_) {}
        }
      }
      const isAudio = entry.type === 'audio' || entry.el.tagName.toLowerCase() === 'audio';
      if (isAudio) {
        entry.el.addEventListener('canplaythrough', onLoad, { once: true });
        entry.el.addEventListener('loadeddata', onLoad, { once: true });
        entry.el.addEventListener('loadedmetadata', onLoad, { once: true });
        entry.el.addEventListener('error', onError, { once: true });
        entry.el.setAttribute('src', entry.src);
        if (!entry.el.isConnected) assetsEl.appendChild(entry.el);
        // kick off load
        try { entry.el.load?.(); } catch(_) {}
        if (!checkAlreadyReady()) {
          setTimeout(checkAlreadyReady, 0);
        }
      } else {
        entry.el.addEventListener('loaded', onLoad, { once: true });
        entry.el.addEventListener('error', onError, { once: true });
        entry.el.setAttribute('src', entry.src);
        if (!entry.el.isConnected) assetsEl.appendChild(entry.el);
        if (!checkAlreadyReady()) {
          setTimeout(checkAlreadyReady, 0);
        }
      }
    } catch (error) {
      cleanup();
      settle('error', error);
    }
  };

  const loadAsset = (id) => {
    const entry = ensureEntry(id);
    if (entry.status === 'loaded') return entry.promise || Promise.resolve();
    if (entry.status === 'error') {
      entry.status = 'idle';
      entry.promise = null;
    }
    if (entry.promise) return entry.promise;
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    if (!queue.includes(entry)) queue.push(entry);
    processQueue();
    notify();
    return entry.promise;
  };

  const ensureGroups = async (groups = []) => {
    if (!Array.isArray(groups)) groups = [groups].filter(Boolean);
    const ids = uniqueIds(groups.flatMap((g) => GROUP_MAP[g] || []));
    const promises = ids.map((id) => loadAsset(id));
    await Promise.all(promises);
  };

  const ensureAssets = async (ids = []) => {
    const normalized = uniqueIds(Array.isArray(ids) ? ids : [ids]);
    const promises = normalized.map((id) => loadAsset(id));
    await Promise.all(promises);
  };

  const ensureCore = () => ensureGroups(['core']);

  const ensureForHero = async (heroKey) => {
    const groups = ['core'];
    const key = heroKey ? `hero_${heroKey}` : null;
    if (key && GROUP_MAP[key]) groups.push(key);
    await ensureGroups(groups);
  };

  const ensureForStep = async (stepKey = 'intro') => {
    const groups = ['core'];
    const normalized = stepKey === 'intro' ? 'step_intro' : `step_${stepKey}`;
    if (GROUP_MAP[normalized]) groups.push(normalized);
    await ensureGroups(groups);
  };

  const warmupGroups = (groups = []) => {
    const list = uniqueIds(Array.isArray(groups) ? groups : [groups]);
    list.forEach((group) => {
      if (!GROUP_MAP[group]) return;
      ensureGroups([group]).catch((err) => console.warn('[Preloader] warmup failed', group, err));
    });
  };

  const getStatus = () => {
    const status = {};
    entries.forEach((entry, id) => {
      status[id] = entry.status;
    });
    return {
      active: !!active,
      queue: queue.map((item) => item.id),
      statusById: status,
    };
  };

  const getAssetUrl = (id) => {
    const entry = entries.get(id);
    if (!entry) return null;
    if (entry.type === 'mind') {
      return entry.objectUrl || entry.src || null;
    }
    if (entry.el) {
      const tag = entry.el.tagName?.toLowerCase?.();
      if (tag === 'audio') {
        return entry.el.currentSrc || entry.el.src || entry.src || null;
      }
      const elSrc = entry.el.getAttribute?.('src');
      if (elSrc) return elSrc;
    }
    return entry.src || null;
  };

  const groupAssetIds = (groups=[]) => {
    const list = uniqueIds((Array.isArray(groups)?groups:[groups]).flatMap((g)=> GROUP_MAP[g] || []));
    return list;
  };

  const addStateListener = (listener) => {
    if (typeof listener !== 'function') return () => {};
    stateListeners.add(listener);
    return () => { stateListeners.delete(listener); };
  };

  const watchGroups = (groups, callback) => {
    if (typeof callback !== 'function') return () => {};
    const ids = groupAssetIds(groups);
    const watcher = { ids, callback };
    watchers.add(watcher);
    try { callback(summarizeIds(ids)); } catch (error) { console.warn('[Preloader] watcher init failed', error); }
    return () => { watchers.delete(watcher); };
  };

  const areGroupsLoaded = (groups = []) => summarizeIds(groupAssetIds(groups)).ready;

  const waitForGroups = (groups, { onProgress, signal, autoStart = true } = {}) => {
    const ids = groupAssetIds(groups);
    const initial = summarizeIds(ids);
    if (autoStart) {
      ensureGroups(groups).catch((error) => console.warn('[Preloader] ensureGroups failed during wait', error));
    }
    if (ids.length === 0) {
      if (typeof onProgress === 'function') {
        try { onProgress(initial); } catch (_) {}
      }
      return Promise.resolve(initial);
    }

    return new Promise((resolve, reject) => {
      let unsubscribe = null;
      const cleanup = () => {
        if (unsubscribe) {
          try { unsubscribe(); } catch (_) {}
          unsubscribe = null;
        }
        if (signal) {
          try { signal.removeEventListener('abort', onAbort); } catch (_) {}
        }
      };
      const onAbort = () => {
        cleanup();
        reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
      };
      const handleUpdate = (summary) => {
        if (typeof onProgress === 'function') {
          try { onProgress(summary); } catch (_) {}
        }
        if (summary.error > 0) {
          cleanup();
          reject(new Error(`Failed to load ${summary.error} asset(s)`));
        } else if (summary.ready) {
          cleanup();
          resolve(summary);
        }
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      unsubscribe = watchGroups(groups, handleUpdate);
      handleUpdate(initial);
    });
  };

  notify();

  return {
    ensureAssets,
    ensureGroups,
    ensureCore,
    ensureForHero,
    ensureForStep,
    warmupGroups,
    getStatus,
    groupAssetIds,
    addStateListener,
    watchGroups,
    waitForGroups,
    areGroupsLoaded,
    getAssetUrl,
  };
}
