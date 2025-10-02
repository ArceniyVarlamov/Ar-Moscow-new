// Simple A-Frame effects/components used across scenes
/* global AFRAME */

(function(){
  if (!window.AFRAME) return;

  // Depth occlusion helper: writes only to depth buffer, no color
  AFRAME.registerComponent('mesh-occluder', {
    schema: { debug: { type: 'boolean', default: false } },
    init: function(){
      const apply = () => {
        const obj = this.el.getObject3D('mesh') || this.el.object3D;
        if (!obj) return;
        obj.traverse((n)=>{
          if (!n.isMesh) return;
          // Clone material to avoid affecting shared refs
          const m = n.material && n.material.clone ? n.material.clone() : new AFRAME.THREE.MeshStandardMaterial();
          m.depthTest = true;
          m.depthWrite = true;
          // Hide color output, keep depth writes
          if ('colorWrite' in m) m.colorWrite = false;
          // Ensure rendered in opaque pass for consistent depth ordering
          m.transparent = false;
          m.opacity = 1.0;
          m.side = AFRAME.THREE.DoubleSide;
          m.needsUpdate = true;
          n.material = m;
        });
        if (this.data.debug) console.log('[mesh-occluder] applied to', this.el);
      };
      this._apply = apply;
      // Apply now and when model is loaded
      apply();
      this.el.addEventListener('model-loaded', apply);
    },
    remove: function(){ this.el.removeEventListener('model-loaded', this._apply); }
  });

  // Transparent outline around a model by rendering backfaces of a slightly scaled clone
  AFRAME.registerComponent('mesh-outline', {
    schema: {
      color:   { type: 'color', default: '#FFD400' },
      opacity: { type: 'number', default: 0.35 },
      scale:   { type: 'number', default: 1.06 },
      double:  { type: 'boolean', default: false },
    },
    init: function(){
      this._apply = this._apply.bind(this);
      this._out = [];
      this.el.addEventListener('model-loaded', this._apply);
      this._apply();
    },
    remove: function(){
      this.el.removeEventListener('model-loaded', this._apply);
      // remove created outline meshes
      try { this._out.forEach(m=> m.parent && m.parent.remove(m)); } catch(_) {}
      this._out.length = 0;
    },
    _apply: function(){
      const obj = this.el.getObject3D('mesh');
      if (!obj) return;
      const params = this.data;
      const addOutline = (src)=>{
        if (!src.isMesh) return;
        const mat = new AFRAME.THREE.MeshBasicMaterial({
          color: new AFRAME.THREE.Color(params.color || '#FFD400'),
          transparent: true,
          opacity: Math.max(0, Math.min(1, params.opacity ?? 0.35)),
          depthTest: true,
          depthWrite: false,
          side: params.double ? AFRAME.THREE.DoubleSide : AFRAME.THREE.BackSide,
          toneMapped: false,
        });
        const m = new AFRAME.THREE.Mesh(src.geometry, mat);
        m.renderOrder = (src.renderOrder || 0) + 1;
        // inherit transforms and add as sibling
        src.parent.add(m);
        // start at 1 then scale slightly to peek from behind
        m.scale.copy(src.scale).multiplyScalar(params.scale || 1.06);
        m.position.copy(src.position);
        m.rotation.copy(src.rotation);
        this._out.push(m);
      };
      obj.traverse(addOutline);
    }
  });

  // Force GLTF model to render as opaque (helpful when source materials use alpha blending and "shine through").
  // Options: mode = 'alphaTest' (default) or 'opaque'; threshold for alphaTest; doubleSide to render both sides.
  AFRAME.registerComponent('force-opaque', {
    schema: {
      mode: { type: 'string', default: 'alphaTest' }, // 'alphaTest' | 'opaque'
      threshold: { type: 'number', default: 0.4 },    // alpha cutoff for alphaTest
      doubleSide: { type: 'boolean', default: true },
      renderOrder: { type: 'number', default: 2 }     // draw after occluders/hare
    },
    init: function(){
      this._apply = this._apply.bind(this);
      this.el.addEventListener('model-loaded', this._apply);
      this._apply();
    },
    remove: function(){ this.el.removeEventListener('model-loaded', this._apply); },
    _apply: function(){
      const obj = this.el.getObject3D('mesh');
      if (!obj) return;
      const params = this.data;
      obj.traverse((n)=>{
        if (!n.isMesh || !n.material) return;
        const m = n.material.clone ? n.material.clone() : new AFRAME.THREE.MeshStandardMaterial();
        if (params.mode === 'opaque') {
          m.transparent = false;
          m.opacity = 1.0;
          m.depthWrite = true;
          m.depthTest = true;
          if ('alphaTest' in m) m.alphaTest = 0.0;
        } else { // alphaTest cutout
          m.transparent = false;
          m.opacity = 1.0;
          m.depthWrite = true;
          m.depthTest = true;
          if ('alphaTest' in m) m.alphaTest = Math.max(0, Math.min(1, params.threshold ?? 0.4));
        }
        m.side = params.doubleSide ? AFRAME.THREE.DoubleSide : AFRAME.THREE.FrontSide;
        m.needsUpdate = true;
        n.material = m;
        if (Number.isFinite(params.renderOrder)) n.renderOrder = params.renderOrder;
      });
    }
  });

  // One-time falling sign behind the target (no bounce)
  AFRAME.registerComponent('sign-drop', {
    schema: {
      enabled: { type: 'boolean', default: true },
      startY:  { type: 'number',  default: 1.6 },
      endY:    { type: 'number',  default: 0.42 },
      behind:  { type: 'number',  default: -0.30 },
      sideX:   { type: 'number',  default: 0.0 },
      width:   { type: 'number',  default: 0.7 },
      height:  { type: 'number',  default: 0.35 },
      duration:{ type: 'number',  default: 1200 },
      delay:   { type: 'number',  default: 120 },
      texture: { type: 'string',  default: './assets/ui/logo-placeholder.svg' },
      gltf:    { type: 'string',  default: '' },
      signScale: { type: 'vec3',  default: {x:1,y:1,z:1} },
      fit:     { type: 'number',  default: 0.6 }, // target max dimension in meters; 0 = disabled
      recenter:{ type: 'boolean', default: true },
      once:    { type: 'boolean', default: true },
      debug:   { type: 'boolean', default: true }
    },
    init: function(){
      this._played = false;
      this.sign = document.createElement('a-entity');
      this.sign.setAttribute('visible', 'false');
      this.sign.setAttribute('position', `${this.data.sideX} ${this.data.startY} ${this.data.behind}`);
      if (this.data.gltf) {
        // Use inner node to allow recentring/scaling regardless of source model offsets
        this.model = document.createElement('a-entity');
        this.model.setAttribute('gltf-smart', this.data.gltf);
        this.sign.appendChild(this.model);
        const s = this.data.signScale || {x:1,y:1,z:1};
        this.sign.setAttribute('scale', `${s.x ?? s[0] ?? 1} ${s.y ?? s[1] ?? 1} ${s.z ?? s[2] ?? 1}`);
        if (this.data.debug) console.log('[sign-drop] using gltf', this.data.gltf, 'scale', this.sign.getAttribute('scale'));
        this.model.addEventListener('model-loaded', (e)=>{
          console.log('[sign-drop] model-loaded event fired', e.detail?.model);
          try {
            const obj = this.model.getObject3D('mesh');
            console.log('[sign-drop] got object3D mesh:', obj);
            if (!obj) {
              console.warn('[sign-drop] No mesh object found in model!');
              return;
            }
            const box = new AFRAME.THREE.Box3().setFromObject(obj);
            if (box && isFinite(box.min.x) && isFinite(box.max.x)) {
              const size = new AFRAME.THREE.Vector3(); box.getSize(size);
              console.log('[sign-drop] Model size:', size);
              const maxDim = Math.max(size.x, size.y, size.z) || 1;
              if (this.data.fit > 0 && isFinite(maxDim) && maxDim > 0) {
                const k = this.data.fit / maxDim;
                obj.scale.multiplyScalar(k);
                console.log('[sign-drop] fit applied', {maxDim, k, newScale: obj.scale});
              }
              if (this.data.recenter) {
                const center = new AFRAME.THREE.Vector3(); box.getCenter(center);
                obj.position.sub(center);
                console.log('[sign-drop] recentered by', center);
              }
            } else {
              console.warn('[sign-drop] Invalid bounding box:', box);
              const s = this.data.signScale || {x:1,y:1,z:1};
              this.sign.setAttribute('scale', `${s.x ?? s[0] ?? 1} ${s.y ?? s[1] ?? 1} ${s.z ?? s[2] ?? 1}`);
            }
          } catch(e2){ console.error('[sign-drop] fit/recenter error', e2); }
        });
        this.model.addEventListener('model-error', (e)=>{
          console.warn('[sign-drop] model-error', e?.detail || e);
          // Attach debug plane immediately on error (no timeout)
          const dbg = document.createElement('a-entity');
          dbg.setAttribute('geometry', `primitive: plane; width: ${this.data.width*2}; height: ${this.data.height*2}`);
          dbg.setAttribute('material', 'color: #ffcc00; opacity: 0.8; side: double');
          (this.model || this.sign).appendChild(dbg);
        });
      } else {
        this.sign.setAttribute('geometry', `primitive: plane; width: ${this.data.width}; height: ${this.data.height}`);
        this.sign.setAttribute('material', `src: url(${this.data.texture}); side: double; transparent: true`);
      }
      this.el.appendChild(this.sign);

      this._start = this._start.bind(this);
      this.el.addEventListener('sign-drop-start', this._start);
    },
    remove: function(){ this.el.removeEventListener('sign-drop-start', this._start); },
    _start: function(){
      if (!this.data.enabled) return;
      if (this._played && this.data.once) return;
      this._played = true;
      const { startY, endY, behind, sideX, duration, delay } = this.data;
      this.sign.setAttribute('visible', 'true');
      if (this.data.debug) {
        console.log('[sign-drop] start drop from', {x: sideX, y: startY, z: behind}, 'to', {x: sideX, y: endY, z: behind});
        console.log('[sign-drop] sign element:', this.sign);
        console.log('[sign-drop] model element:', this.model);
        console.log('[sign-drop] model object3D:', this.model?.getObject3D('mesh'));
      }
      this.sign.setAttribute('position', `${sideX} ${startY} ${behind}`);
      // Use A-Frame animation for simplicity
      this.sign.setAttribute('animation__drop', `property: position; to: ${sideX} ${endY} ${behind}; dur: ${duration}; easing: easeOutQuad; delay: ${delay}`);
      // small sway after landing
      this.sign.setAttribute('animation__sway', `property: rotation; to: 0 3 0; dir: alternate; loop: ${this.data.once ? 'false' : 'true'}; dur: 1400; easing: easeInOutSine; startEvents: animationcomplete__drop`);
    }
  });

  AFRAME.registerComponent('orange-rain', {
    schema: {
      enabled: { type: 'boolean', default: true },
      rate: { type: 'number', default: 2 }, // per second
      area: { type: 'number', default: 0.6 }, // spawn radius in XZ
      height: { type: 'number', default: 1.0 }, // spawn height above origin
      groundY: { type: 'number', default: -0.12 }, // ground level (local Y)
      scale: { type: 'number', default: 0.08 },
      max: { type: 'number', default: 20 },
      gravity: { type: 'number', default: 2.0 }, // m/s^2
      bounce: { type: 'boolean', default: true },
      collider: { type: 'selector', default: '#chebModel' },
      colliderRadius: { type: 'number', default: 0.22 },
      life: { type: 'number', default: 8 }, // seconds
      colliderType: { type: 'string', default: 'sphere' }, // sphere | box
      visualizeCollider: { type: 'boolean', default: false },
      // Rounded-box top shaping (only when colliderType = 'box')
      topRoundness: { type: 'number', default: 0.06 }, // height of dome over top plane (m)
      topOutward: { type: 'number', default: 0.28 },  // outward horizontal impulse on top hit
      topBounce: { type: 'number', default: 0.55 },    // vertical restitution on top hit
      topFriction: { type: 'number', default: 0.9 }    // horizontal damping on top hit
    },

    init: function () {
      this.pool = [];
      this.active = this.data.enabled;
      this.spawnAcc = 0;
      this.falling = [];
      this.tmpV = new AFRAME.THREE.Vector3();
      this.colliderEl = this.data.collider || (this.el.querySelector('#chebModel'));

      // container to avoid detach warnings
      this.container = document.createElement('a-entity');
      this.el.appendChild(this.container);

      // prepare box collider data
      this.boxLocal = null; // {min, max}
      const tryBuildBox = () => {
        if (!this.colliderEl || !this.colliderEl.object3D) return;
        const obj = this.colliderEl.object3D;
        const box = new AFRAME.THREE.Box3().setFromObject(obj);
        if (!box || !isFinite(box.min.x) || !isFinite(box.max.x)) return;
        const corners = [
          new AFRAME.THREE.Vector3(box.min.x, box.min.y, box.min.z),
          new AFRAME.THREE.Vector3(box.min.x, box.min.y, box.max.z),
          new AFRAME.THREE.Vector3(box.min.x, box.max.y, box.min.z),
          new AFRAME.THREE.Vector3(box.min.x, box.max.y, box.max.z),
          new AFRAME.THREE.Vector3(box.max.x, box.min.y, box.min.z),
          new AFRAME.THREE.Vector3(box.max.x, box.min.y, box.max.z),
          new AFRAME.THREE.Vector3(box.max.x, box.max.y, box.min.z),
          new AFRAME.THREE.Vector3(box.max.x, box.max.y, box.max.z)
        ];
        const inv = new AFRAME.THREE.Matrix4().copy(this.el.object3D.matrixWorld).invert();
        corners.forEach(v => v.applyMatrix4(inv));
        const b2 = new AFRAME.THREE.Box3().setFromPoints(corners);
        this.boxLocal = { min: b2.min.clone(), max: b2.max.clone() };
        if (this.data.visualizeCollider) this._ensureDebugBox();
      };
      if (this.colliderEl) {
        tryBuildBox();
        this.colliderEl.addEventListener('model-loaded', tryBuildBox);
      }

      // external control
      this.el.addEventListener('effect-start', () => { this.active = true; this.spawnAcc = 0; });
      this.el.addEventListener('effect-stop', () => {
        this.active = false;
        for (let i = this.falling.length - 1; i >= 0; i--) {
          const f = this.falling[i];
          f.setAttribute('visible', 'false');
          this.pool.push(f);
        }
        this.falling.length = 0;
      });
    },

    tick: function (time, dt) {
      if (!this.active) return;
      const dts = Math.max(16, dt || 16);
      const t = dts / 1000;

      // update existing
      for (let i = this.falling.length - 1; i >= 0; i--) {
        const f = this.falling[i];
        const o3d = f.object3D;
        const ud = f.userData;

        // integrate velocity
        ud.vy -= this.data.gravity * t; // gravity downward (y+ up)
        o3d.position.x += ud.vx * t;
        o3d.position.y += ud.vy * t;
        o3d.position.z += ud.vz * t;
        o3d.rotation.y += ud.vr * t;

        // bounce on character
        if (this.data.bounce && this.colliderEl && this.colliderEl.object3D) {
          // cooldown to avoid sticking
          if (ud.cool > 0) ud.cool -= t;
          if (this.data.colliderType === 'box' && this.boxLocal) {
            const min = this.boxLocal.min, max = this.boxLocal.max;
            const eps = 0.02;
            // top plane with slight rounding (spherical cap approximation)
            if (o3d.position.x > min.x && o3d.position.x < max.x &&
                o3d.position.z > min.z && o3d.position.z < max.z) {
              const cx = (min.x + max.x) * 0.5;
              const cz = (min.z + max.z) * 0.5;
              const hx = Math.max(0.001, (max.x - min.x) * 0.5);
              const hz = Math.max(0.001, (max.z - min.z) * 0.5);
              const lx = o3d.position.x - cx;
              const lz = o3d.position.z - cz;
              // normalized distance in ellipse [0..1]
              const rx = lx / hx, rz = lz / hz;
              const r2 = rx*rx + rz*rz;
              const k = Math.max(0, Math.min(1, 1 - r2));
              const ycap = max.y + Math.max(0, this.data.topRoundness || 0) * k;
              if (o3d.position.y <= ycap + eps && o3d.position.y >= ycap - 0.15) {
                o3d.position.y = ycap + eps;
                // vertical bounce
                const b = Math.max(0, Math.min(1, this.data.topBounce));
                ud.vy = Math.abs(ud.vy) * b + 0.18;
                // outward horizontal push + friction
                const len = Math.max(0.001, Math.hypot(rx, rz));
                const nx = rx / len, nz = rz / len; // outward dir
                const out = Math.max(0, this.data.topOutward || 0);
                const fr = Math.max(0, Math.min(1, this.data.topFriction || 0.9));
                ud.vx = ud.vx * fr + nx * out;
                ud.vz = ud.vz * fr + nz * out;
              }
            }
            // side planes X
            if (o3d.position.z > min.z && o3d.position.z < max.z && o3d.position.y > min.y && o3d.position.y < max.y) {
              if (o3d.position.x <= min.x + eps && ud.vx < 0) { ud.vx = -ud.vx * 0.6; o3d.position.x = min.x + eps; }
              if (o3d.position.x >= max.x - eps && ud.vx > 0) { ud.vx = -ud.vx * 0.6; o3d.position.x = max.x - eps; }
            }
            // side planes Z
            if (o3d.position.x > min.x && o3d.position.x < max.x && o3d.position.y > min.y && o3d.position.y < max.y) {
              if (o3d.position.z <= min.z + eps && ud.vz < 0) { ud.vz = -ud.vz * 0.6; o3d.position.z = min.z + eps; }
              if (o3d.position.z >= max.z - eps && ud.vz > 0) { ud.vz = -ud.vz * 0.6; o3d.position.z = max.z - eps; }
            }
          } else {
            // true 3D sphere collider
            const center = this.colliderEl.object3D.getWorldPosition(this.tmpV);
            this.el.object3D.worldToLocal(center);
            if (this.data.visualizeCollider) this._ensureDebugSphere(center, this.data.colliderRadius);
            const dx = o3d.position.x - center.x;
            const dy = o3d.position.y - center.y;
            const dz = o3d.position.z - center.z;
            const r = this.data.colliderRadius;
            const dist2 = dx*dx + dy*dy + dz*dz;
            if (ud.cool <= 0 && dist2 < r*r) {
              const len = Math.max(0.001, Math.sqrt(dist2));
              const nx = dx / len, ny = dy / len, nz = dz / len; // outward normal
              const dot = ud.vx*nx + ud.vy*ny + ud.vz*nz;
              // reflect velocity over the sphere normal and add radial impulse
              let radial = 0.8 + Math.random() * 0.6;
              if ((ud.hits|0) >= 1) radial *= 1.15; // escape faster after repeated hits
              const damp = 0.5; // damping on reflection
              ud.vx = (ud.vx - 2*dot*nx) * damp + nx * radial;
              ud.vy = (ud.vy - 2*dot*ny) * damp + ny * radial;
              ud.vz = (ud.vz - 2*dot*nz) * damp + nz * radial;
              // push slightly outside the collider to avoid immediate re-hit
              const push = r + 0.02;
              o3d.position.set(center.x + nx*push, center.y + ny*push, center.z + nz*push);
              ud.cool = 0.26; // cooldown
              ud.hits = (ud.hits|0) + 1;
              if (ud.hits >= 2 && ud.life > 3) ud.life = 2.8 + Math.random()*0.8; // limit hang time
            }
          }
        }

        // ground remove or life timeout
        ud.life -= t;
        if (o3d.position.y <= this.data.groundY || ud.life <= 0) {
          f.setAttribute('visible', 'false');
          this.pool.push(f);
          this.falling.splice(i, 1);
        }
      }

      if (this.falling.length >= this.data.max) return;

      // spawn new according to rate
      this.spawnAcc += dts;
      const interval = 1000 / Math.max(0.1, this.data.rate);
      while (this.spawnAcc >= interval) {
        this.spawnAcc -= interval;
        this._spawnOne();
        if (this.falling.length >= this.data.max) break;
      }
    },

    _spawnOne: function () {
      const ent = this.pool.pop() || document.createElement('a-entity');
      if (!ent.hasAttribute('gltf-model')) {
        ent.setAttribute('gltf-smart', '#orangeModel');
        ent.setAttribute('scale', `${this.data.scale} ${this.data.scale} ${this.data.scale}`);
      }
      const rx = (Math.random() * 2 - 1) * this.data.area;
      const rz = (Math.random() * 2 - 1) * this.data.area;
      ent.setAttribute('position', { x: rx, y: this.data.height, z: rz });
      ent.setAttribute('visible', 'true');
      const vh = 0.25; // initial horizontal speed magnitude
      const ang = Math.random() * Math.PI * 2;
      ent.userData = {
        vx: Math.cos(ang) * vh * (Math.random()*0.5 + 0.75),
        vy: 0, // start from rest, gravity accelerates
        vz: Math.sin(ang) * vh * (Math.random()*0.5 + 0.75),
        vr: (Math.random() * 2 - 1) * 2.0, // spin rad/s
        life: this.data.life,
        cool: 0,
        hits: 0
      };
      if (!ent.parentNode) this.container.appendChild(ent);
      else if (ent.parentNode !== this.container) this.container.appendChild(ent);
      this.falling.push(ent);
    }

    ,_ensureDebugBox: function(){
      if (!this.boxLocal) return;
      if (!this.debugBox){
        this.debugBox = document.createElement('a-entity');
        this.debugBox.setAttribute('material', 'color: #00e5ff; wireframe: true; opacity: 0.6');
        this.el.appendChild(this.debugBox);
      }
      const size = new AFRAME.THREE.Vector3().subVectors(this.boxLocal.max, this.boxLocal.min);
      const center = new AFRAME.THREE.Vector3().addVectors(this.boxLocal.min, this.boxLocal.max).multiplyScalar(0.5);
      this.debugBox.setAttribute('position', `${center.x} ${center.y} ${center.z}`);
      this.debugBox.setAttribute('geometry', `primitive: box; width: ${size.x}; height: ${size.y}; depth: ${size.z}`);
      this.debugBox.setAttribute('visible', this.data.visualizeCollider);
      // Show rounded cap apex as an ellipse ring, if any
      const round = Math.max(0, this.data.topRoundness || 0);
      if (round > 0) {
        if (!this.debugCap) {
          this.debugCap = document.createElement('a-entity');
          // Use circle scaled to ellipse
          const ring = document.createElement('a-entity');
          ring.setAttribute('geometry', 'primitive: circle; radius: 1');
          ring.setAttribute('material', 'color: #00e5ff; opacity: 0.25; side: double');
          ring.setAttribute('rotation', '-90 0 0');
          this.debugCap.appendChild(ring);
          this.el.appendChild(this.debugCap);
        }
        const hx = Math.max(0.001, size.x * 0.5);
        const hz = Math.max(0.001, size.z * 0.5);
        this.debugCap.setAttribute('position', `${center.x} ${this.boxLocal.max.y + round} ${center.z}`);
        this.debugCap.setAttribute('scale', `${hx} 1 ${hz}`);
        this.debugCap.setAttribute('visible', this.data.visualizeCollider);
      }
    }

    ,_ensureDebugSphere: function(center, r){
      if (!this.debugSphere){
        this.debugSphere = document.createElement('a-entity');
        // thin ring
        const ring = document.createElement('a-entity');
        ring.setAttribute('geometry', `primitive: ring; radiusInner: ${Math.max(0.001, r*0.98)}; radiusOuter: ${r}`);
        ring.setAttribute('rotation', '-90 0 0');
        ring.setAttribute('material', 'color: #00e5ff; opacity: 0.9; side: double');
        // faint disk fill
        const disk = document.createElement('a-entity');
        disk.setAttribute('geometry', `primitive: circle; radius: ${r}`);
        disk.setAttribute('rotation', '-90 0 0');
        disk.setAttribute('material', 'color: #00e5ff; opacity: 0.12; side: double');
        this.debugSphere.appendChild(disk);
        this.debugSphere.appendChild(ring);
        this.el.appendChild(this.debugSphere);
      }
      this.debugSphere.setAttribute('position', `${center.x} ${center.y} ${center.z}`);
      this.debugSphere.setAttribute('visible', this.data.visualizeCollider);
    }
  });

  // Floating music notes that spawn at center and travel away in a wavy path.
  // Emit 'gena-music-start' / 'gena-music-stop' on the container to toggle.
  AFRAME.registerComponent('music-notes', {
    schema: {
      enabled: { type: 'boolean', default: true },
      count: { type: 'int', default: 6 },
      baseY: { type: 'number', default: 0.02 },
      size: { type: 'number', default: 0.20 }, // увеличили в 2 раза
      // Параметры траектории
      // случайные задержки между появлениями
      spawnDelayMin: { type: 'number', default: 0.90 },
      spawnDelayMax: { type: 'number', default: 1.60 },
      speedZ: { type: 'number', default: 0.20 },        // м/сек в глубину (к -Z)
      maxDistance: { type: 'number', default: 1.8 },    // до какого Z улетают
      ampX: { type: 'number', default: 0.45 },          // амплитуда колебаний по X (шире в стороны)
      ampY: { type: 'number', default: 0.12 },          // амплитуда по Y
      freqX: { type: 'number', default: 1.2 },          // ниже частота = плавнее
      freqY: { type: 'number', default: 1.4 },
      swayZ: { type: 'number', default: 0.05 },         // небольшое покачивание по Z
      driftX: { type: 'number', default: 0.18 },        // больше дрейф — уходят далеко в стороны
      startOffsetX: { type: 'number', default: 0.20 },  // сильнее разводим стартом
      spinDurMin: { type: 'int', default: 2600 },       // медленнее вращение
      spinDurMax: { type: 'int', default: 5600 },
    },
    init: function(){
      this._notes = [];
      this._started = false;
      this._start = this._start.bind(this);
      this._stop = this._stop.bind(this);
      this.el.addEventListener('gena-music-start', this._start);
      this.el.addEventListener('gena-music-stop', this._stop);
      this._build();
      this._stop();
    },
    remove: function(){
      this.el.removeEventListener('gena-music-start', this._start);
      this.el.removeEventListener('gena-music-stop', this._stop);
    },
    _build: function(){
      const cfg = this.data;
      const n = Math.max(4, cfg.count|0);
      for (let i=0;i<n;i++){
        const note = document.createElement('a-entity');
      note.setAttribute('gltf-smart', '#noteModel');
        note.setAttribute('rotation', '0 90 0');
        // плавное вращение вокруг своей оси
        const spinDur = Math.floor(cfg.spinDurMin + Math.random()*Math.max(1,(cfg.spinDurMax - cfg.spinDurMin)));
        note.setAttribute('animation__spin', `property: rotation; to: 0 450 0; loop: true; easing: linear; dur: ${spinDur}`);
        this.el.appendChild(note);

        const onLoad = ()=>{
          try {
            const obj = note.getObject3D('mesh');
            if (!obj) return;
            const box = new AFRAME.THREE.Box3().setFromObject(obj);
            const size = new AFRAME.THREE.Vector3();
            box.getSize(size);
            const k = (cfg.size || 0.10) / (Math.max(size.x,size.y,size.z) || 1);
            if (isFinite(k) && k>0 && k<1000) obj.scale.multiplyScalar(k);
          } catch(_){}
        };
        if (note.getObject3D('mesh')) onLoad(); else note.addEventListener('model-loaded', onLoad, { once: true });

        // Инициализация состояния одной ноты
        const rand = (a,b)=> a + Math.random()*(b-a);
        const delay = rand(cfg.spawnDelayMin, cfg.spawnDelayMax) + Math.random()*((cfg.spawnDelayMax||0.4) * Math.max(1, n*0.6));
        const speedZ = cfg.speedZ * (0.9 + Math.random()*0.2);
        const ampX = cfg.ampX * (0.8 + Math.random()*0.4);
        const ampY = cfg.ampY * (0.8 + Math.random()*0.4);
        const freqX = cfg.freqX * (0.9 + Math.random()*0.3);
        const freqY = cfg.freqY * (0.9 + Math.random()*0.3);
        const swayZ = cfg.swayZ * (0.6 + Math.random()*0.8);
        // Случайные направления: часть уходит вглубь (-Z), часть — вперёд (+Z);
        // горизонталь тоже зеркалим, чтобы была разнонаправленность
        const dirZ = 1; // всегда в глубину, не на зрителя
        const signX = Math.random() < 0.5 ? -1 : 1;
        const driftX = cfg.driftX * (0.8 + Math.random()*0.4);
        const startOffsetX = cfg.startOffsetX * (0.8 + Math.random()*0.4);
        this._notes.push({ el: note, active: false, t: 0, delay, speedZ, ampX, ampY, freqX, freqY, swayZ, dirZ, signX, driftX, startOffsetX });
      }
    },
    _start: function(){
      if (!this.data.enabled || this._started) return;
      this._started = true;
      // Перезапуск последовательности
      const cfg = this.data;
      try {
        this._notes.forEach((n, i)=>{
          n.active = false;
          n.t = 0;
          const rand = (a,b)=> a + Math.random()*(b-a);
          n.delay = rand(cfg.spawnDelayMin, cfg.spawnDelayMax) + Math.random()*((cfg.spawnDelayMax||0.4) * Math.max(1, (this._notes.length||10)*0.6));
          n.el.object3D.visible = false;
          n.el.object3D.position.set(0, cfg.baseY || 0, 0);
        });
      } catch(_) {}
    },
    _stop: function(){
      this._started = false;
      try { this._notes.forEach(n=>{ n.active=false; n.el.object3D.visible = false; }); } catch(_) {}
    },
    tick: function(t, dt){
      if (!this._started) return;
      const dtSec = (dt||0)/1000;
      const cfg = this.data;
      const baseY = cfg.baseY || 0;
      const rand = (a,b)=> a + Math.random()*(b-a);
      const nextDelay = ()=> rand(cfg.spawnDelayMin, cfg.spawnDelayMax);
      for (let i=0;i<this._notes.length;i++){
        const n = this._notes[i];
        if (!n.active){
          n.delay -= dtSec;
          if (n.delay <= 0){
            n.active = true;
            n.t = 0;
            // рандомизируем направление и параметры на каждый новый запуск
            n.signX = Math.random() < 0.5 ? -1 : 1;
            n.startOffsetX = (this.data.startOffsetX || 0.2) * (0.8 + Math.random()*0.4);
            n.driftX = (this.data.driftX || 0.18) * (0.8 + Math.random()*0.4);
            n.el.object3D.visible = true;
            // стартуем чуть в сторону, чтобы поток сразу расходился
            n.el.object3D.position.set(n.signX * (n.startOffsetX||0), baseY, 0);
          }
          continue;
        }
        n.t += dtSec;
        const z = -n.dirZ * (n.speedZ * n.t) + n.swayZ * Math.sin(1.2 * n.t);
        // уводим в стороны: стартовый сдвиг + дрейф + волна
        const x = n.signX * ( (n.startOffsetX||0) + (n.driftX||0) * n.t + n.ampX * Math.sin(n.freqX * n.t) );
        const y = baseY + n.ampY * Math.sin(n.freqY * n.t);
        n.el.object3D.position.set(x, y, z);
        if (Math.abs(z) > Math.max(0.2, cfg.maxDistance)){
          // Дальний конец — скрываем и планируем следующий запуск
          n.active = false;
          n.el.object3D.visible = false;
          n.delay = nextDelay();
        }
      }
    }
  });

  // Radial star emitter for the Cheburashka stand: emits lots of small stars from center
  // Control with 'effect-start' / 'effect-stop' events on the entity this is attached to.
  AFRAME.registerComponent('star-emitter', {
    schema: {
      enabled: { type: 'boolean', default: true },
      // selector resolves to an Element; we will convert to '#id' when passing to gltf-model
      model: { type: 'selector', default: '#cuteStarModel' },
      rate: { type: 'number', default: 16 },       // stars per second
      max: { type: 'int', default: 120 },          // max active stars
      size: { type: 'number', default: 0.06 },     // target max dimension (m)
      baseY: { type: 'number', default: 0.00 },    // spawn Y offset
      speedMin: { type: 'number', default: 0.35 }, // m/s
      speedMax: { type: 'number', default: 0.85 },
      lifeMin: { type: 'number', default: 2.2 },   // seconds
      lifeMax: { type: 'number', default: 4.0 },
      outBias: { type: 'number', default: 1.0 },   // bias outward on -Z (toward scene depth)
      spinMin: { type: 'number', default: 120 },   // deg/s
      spinMax: { type: 'number', default: 480 },
    },
    init: function(){
      this._pool = [];
      this._active = [];
      this._acc = 0;
      this._running = !!this.data.enabled;
      this._start = () => { this._running = true; };
      this._stop = () => { this._running = false; this._reclaimAll(); };
      this.el.addEventListener('effect-start', this._start);
      this.el.addEventListener('effect-stop', this._stop);
      // Container to hold stars
      this._container = document.createElement('a-entity');
      this.el.appendChild(this._container);
    },
    remove: function(){
      this.el.removeEventListener('effect-start', this._start);
      this.el.removeEventListener('effect-stop', this._stop);
      try { while (this._container?.firstChild) this._container.removeChild(this._container.firstChild); } catch(_) {}
    },
    tick: function(time, dt){
      const dts = Math.max(16, dt||16) / 1000;
      if (this._running) {
        this._acc += this.data.rate * dts;
        const n = Math.floor(this._acc);
        if (n > 0) this._acc -= n;
        for (let i=0;i<n;i++) this._spawnOne();
      }
      // update actives
      for (let i=this._active.length-1; i>=0; i--) {
        const s = this._active[i];
        const o3d = s.el.object3D;
        s.life -= dts;
        if (s.life <= 0) { this._reclaimAt(i); continue; }
        // integrate
        o3d.position.x += s.vx * dts;
        o3d.position.y += s.vy * dts;
        o3d.position.z += s.vz * dts;
        s.vx *= 0.995; s.vy *= 0.995; s.vz *= 0.995; // mild damping
        s.spin += s.spinRate * dts;
        o3d.rotation.set(0, THREE.MathUtils.degToRad(s.spin), 0);
        // subtle twinkle via scale pulsation
        const tw = 1 + 0.08 * Math.sin((s.life*7) + s.seed);
        o3d.scale.setScalar(s.baseScale * tw);
      }
    },
    _reclaimAll: function(){
      for (let i=this._active.length-1;i>=0;i--) this._reclaimAt(i);
    },
    _reclaimAt: function(idx){
      const s = this._active[idx];
      if (!s) return;
      try { s.el.object3D.visible = false; } catch(_) {}
      this._pool.push(s.el);
      this._active.splice(idx,1);
    },
    _spawnOne: function(){
      if (this._active.length >= Math.max(1, this.data.max|0)) return;
      let el = this._pool.pop() || document.createElement('a-entity');
      if (!el.hasAttribute('gltf-model') && !el.hasAttribute('gltf-smart')) {
        const sel = (this.data.model && this.data.model.id)
          ? ('#' + this.data.model.id)
          : '#cuteStarModel';
        el.setAttribute('gltf-smart', sel);
        el.setAttribute('rotation', '0 90 0');
      }
      if (!el.parentNode) this._container.appendChild(el);
      el.object3D.visible = true;
      el.object3D.position.set(0, this.data.baseY || 0, 0);
      // Ensure high render order so stars draw over target plane
      try {
        const obj = el.getObject3D('mesh');
        if (obj) obj.traverse((n)=>{ if (n.isMesh) n.renderOrder = 10; });
      } catch(_) {}
      // compute scale to fit target size once (lazy on first load)
      const ensureFit = () => {
        try {
          const obj = el.getObject3D('mesh');
          if (!obj) return false;
          const box = new AFRAME.THREE.Box3().setFromObject(obj);
          const size = new AFRAME.THREE.Vector3();
          box.getSize(size);
          const k = (this.data.size || 0.06) / (Math.max(size.x,size.y,size.z) || 1);
          // Allow larger upscales for tiny models
          const s = Math.max(0.001, Math.min(12, k));
          obj.scale.multiplyScalar(s);
          el.object3D.userData._baseScale = s;
          return true;
        } catch(_) { return false; }
      };
      if (!ensureFit()) {
        const once = () => { el.removeEventListener('model-loaded', once); ensureFit(); };
        el.addEventListener('model-loaded', once, { once: true });
      }

      // random velocity, slightly biased toward -Z
      const ang = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.5 + 0.2; // upward bias
      const speed = this.data.speedMin + Math.random() * Math.max(0.01, (this.data.speedMax - this.data.speedMin));
      const biasZ = Math.max(0, this.data.outBias || 0);
      const vx = Math.cos(ang) * speed * 0.6;
      const vz = -Math.sin(ang) * speed * (0.4 + 0.6*biasZ);
      const vy = up * speed;
      const life = this.data.lifeMin + Math.random() * Math.max(0.1, (this.data.lifeMax - this.data.lifeMin));
      const spinRate = (this.data.spinMin + Math.random()*Math.max(1,(this.data.spinMax - this.data.spinMin))) * (Math.random()<0.5?-1:1);
      const baseScale = el.object3D.userData?._baseScale || 1;
      const seed = Math.random()*10;
      this._active.push({ el, vx, vy, vz, life, spin: 0, spinRate, baseScale, seed });
    }
  });
})();
  // Wrapper to safely set glTF from string '#assetId' only.
  // Use this instead of setting 'gltf-model' directly in dynamic code.
  AFRAME.registerComponent('gltf-smart', {
    schema: { type: 'string', default: '' },
    update: function(){
      let v = this.data;
      try {
        const urlParams = new URLSearchParams(location.search);
        const DEBUG = urlParams.has('debug') || ['1','true','yes','on'].includes((urlParams.get('debug')||'').toLowerCase());
        if (DEBUG) console.log('[GLTF-SMART][UPDATE]', { elId: this.el.id, value: v });
      } catch(_) {}
      if (!v) return;
      if (typeof v !== 'string') {
        if (v && v.id) v = `#${v.id}`; else return;
      }
      // Validate asset id exists if value is a selector
      if (v[0] === '#') {
        const id = v.slice(1);
        if (!document.getElementById(id)) {
          try { console.warn('[GLTF-SMART] Missing asset id', { id, elId: this.el.id }); } catch(_) {}
        }
      }
      this.el.setAttribute('gltf-model', v);
    }
  });
