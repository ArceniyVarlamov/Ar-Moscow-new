const ASSET_SOURCES = {
  lariskaModel: './assets/models/Lariska-2.glb',
  souzmultiparkModel: './assets/models/souzmultipark.glb',
  rabbitModel: './assets/models/rabbit.glb',
  orangeModel: './assets/models/orange.glb',
  noteModel: './assets/models/note.glb',
  cheeseModel: './assets/models/cheese.glb',
  ticketModel: './assets/models/ticket.glb',
  cuteStarModel: './assets/models/cute_little_star.glb',
  grassModel: './assets/models/grass.glb',
  grassFloorModel: './assets/models/grass_floor.glb',
  treeModel: './assets/models/tree.glb',
  sunModel: './assets/models/sun.glb',
  // audio assets
  birdsAudio: './assets/music/birds.mp3',
  genaAudio: './assets/music/gena.mp3',
  lariskaAudio: './assets/music/lariska.mp3',
  wolf2Audio: './assets/music/wolf_2.mp3',
  wolf3Audio: './assets/music/wolf_3.mp3',
};

const GROUP_MAP = {
  core: ['lariskaModel', 'souzmultiparkModel', 'rabbitModel'],
  step_intro: ['souzmultiparkModel', 'rabbitModel', 'wolf2Audio', 'wolf3Audio'],
  step_wolf: ['souzmultiparkModel', 'rabbitModel'],
  step_gena: ['noteModel', 'genaAudio'],
  step_cheburashka: ['orangeModel'],
  step_shapoklyak: ['cheeseModel', 'lariskaAudio'],
  step_cheburashkastand: ['ticketModel', 'cuteStarModel'],
  step_trio: ['grassModel', 'grassFloorModel', 'treeModel', 'sunModel', 'birdsAudio'],
  step_wolf: ['souzmultiparkModel', 'rabbitModel', 'wolf2Audio', 'wolf3Audio'],
  hero_cheburashka: ['orangeModel'],
  hero_gena: ['noteModel', 'genaAudio'],
  hero_shepoklak: ['cheeseModel', 'lariskaAudio'],
  hero_trio: ['grassModel', 'grassFloorModel', 'treeModel', 'sunModel'],
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

  const notify = () => {
    if (typeof onStateChange === 'function') {
      const payload = {};
      entries.forEach((entry, id) => { payload[id] = entry.status; });
      onStateChange({ active: !!active, queue: queue.map((item) => item.id), statusById: payload });
    }
  };

  const ensureEntry = (id) => {
    if (!entries.has(id)) {
      const existing = assetsEl.querySelector(`#${id}`);
      const src = ASSET_SOURCES[id];
      entries.set(id, {
        id,
        el: existing || null,
        src,
        status: src ? 'idle' : 'missing',
        promise: null,
      });
    }
    return entries.get(id);
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

    if (!entry.src) {
      finalize('error', new Error(`Missing src for asset ${entry.id}`));
      return;
    }

    const onLoad = () => { cleanup(); finalize('loaded'); };
    const onError = (ev) => { cleanup(); finalize('error', ev?.detail || ev); };
    const cleanup = () => {
      try { entry.el?.removeEventListener('loaded', onLoad); } catch(_) {}
      try { entry.el?.removeEventListener('error', onError); } catch(_) {}
    };

    // Create element if needed, set listeners, set src, then append to DOM
    try {
      if (!entry.el) {
        const isAudio = typeof entry.src === 'string' && /\.mp3(\?.*)?$/i.test(entry.src);
        entry.el = document.createElement(isAudio ? 'audio' : 'a-asset-item');
        entry.el.id = entry.id;
        if (isAudio) {
          try { entry.el.setAttribute('preload', 'auto'); } catch(_) {}
          try { entry.el.setAttribute('crossorigin', 'anonymous'); } catch(_) {}
        }
      }
      const isAudio = entry.el.tagName.toLowerCase() === 'audio';
      if (isAudio) {
        entry.el.addEventListener('canplaythrough', onLoad, { once: true });
        entry.el.addEventListener('loadeddata', onLoad, { once: true });
        entry.el.addEventListener('error', onError, { once: true });
        entry.el.setAttribute('src', entry.src);
        if (!entry.el.isConnected) assetsEl.appendChild(entry.el);
        // kick off load
        try { entry.el.load?.(); } catch(_) {}
      } else {
        entry.el.addEventListener('loaded', onLoad, { once: true });
        entry.el.addEventListener('error', onError, { once: true });
        entry.el.setAttribute('src', entry.src);
        if (!entry.el.isConnected) assetsEl.appendChild(entry.el);
      }
    } catch (error) {
      cleanup();
      finalize('error', error);
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

  const groupAssetIds = (groups=[]) => {
    const list = uniqueIds((Array.isArray(groups)?groups:[groups]).flatMap((g)=> GROUP_MAP[g] || []));
    return list;
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
  };
}
