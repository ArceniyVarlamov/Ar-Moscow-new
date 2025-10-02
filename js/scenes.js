let sceneConfig = null;

export async function loadSceneConfig(url = './config/scenes.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sceneConfig = await res.json();
    console.log('[CFG] Loaded scenes.json', sceneConfig);
    return sceneConfig;
  } catch (error) {
    console.warn('[CFG] Unable to load scenes.json, using inline defaults', error);
    return null;
  }
}

export function setSceneConfig(cfg) {
  sceneConfig = cfg;
}

export function getSceneConfig() {
  return sceneConfig;
}

export function applySceneConfig(cfg = sceneConfig) {
  if (!cfg) return;

  try {
    const chebRoot = document.getElementById('scene-cheb');
    const rain = cfg?.cheb?.effects?.['orange-rain'];
    if (chebRoot && rain) {
      const entries = [];
      for (const [k, v] of Object.entries(rain)) entries.push(`${k}: ${v}`);
      chebRoot.setAttribute('orange-rain', entries.join('; '));
      console.log('[CFG] Applied orange-rain config');
    }
  } catch (error) {
    console.warn('[CFG] cheb apply failed', error);
  }

  const applyModel = (containerId, modelCfg) => {
    const container = document.getElementById(containerId);
    if (!container || !modelCfg) return;
    let el = container.querySelector(`[gltf-model="${modelCfg.gltf}"]`) || container.querySelector(`[gltf-smart="${modelCfg.gltf}"]`);
    if (!el) {
      el = document.createElement('a-entity');
      el.setAttribute('gltf-smart', modelCfg.gltf);
      el.setAttribute('animation-mixer', '');
      container.appendChild(el);
    }
    if (modelCfg.position) el.setAttribute('position', modelCfg.position);
    if (modelCfg.scale) el.setAttribute('scale', modelCfg.scale);
    if (modelCfg.rotation) el.setAttribute('rotation', modelCfg.rotation);
    if (!el.hasAttribute('animation-mixer')) el.setAttribute('animation-mixer', '');
    if (modelCfg.animation) {
      const a = modelCfg.animation;
      const parts = [];
      if (a.property) parts.push(`property: ${a.property}`);
      if (a.from) parts.push(`from: ${a.from}`);
      if (a.to) parts.push(`to: ${a.to}`);
      if (a.dur) parts.push(`dur: ${a.dur}`);
      if (a.dir) parts.push(`dir: ${a.dir}`);
      if (a.loop !== undefined) parts.push(`loop: ${a.loop}`);
      if (a.easing) parts.push(`easing: ${a.easing}`);
      el.setAttribute('animation__idle', parts.join('; '));
    }
  };

  try {
    const shapModels = cfg?.shap?.models || [];
    shapModels.forEach((model) => applyModel('scene-shap', model));
  } catch (error) {
    console.warn('[CFG] shap apply failed', error);
  }

  try {
    const wolfModels = cfg?.wolf?.models || [];
    wolfModels.forEach((model) => applyModel('scene-wolf', model));
  } catch (error) {
    console.warn('[CFG] wolf apply failed', error);
  }
}
