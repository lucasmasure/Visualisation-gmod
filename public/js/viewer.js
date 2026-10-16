// Scène three.js : affichage d'un model Source avec ses matériaux
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseVmt } from './vmt.js';
import { parseVtf } from './vtf.js';
import { normPath } from './gma.js';

const latin1 = new TextDecoder('latin1');

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
    this.camera.position.set(0, 60, 150);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotateSpeed = 2;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.zoomSpeed = 1.2;
    this.controls.keyPanSpeed = 20;
    this.controls.listenToKeyEvents(window); // flèches du clavier : déplacer

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(1, 2, 2);
    this.camera.add(key);
    const rim = new THREE.DirectionalLight(0xbfd8ff, 0.8);
    rim.position.set(-2, 1, -2);
    this.scene.add(rim);
    this.scene.add(this.camera);

    this.grid = new THREE.GridHelper(200, 20, 0x3a4350, 0x262c35);
    this.scene.add(this.grid);

    // Source : Z vers le haut -> three.js : Y vers le haut
    this.root = new THREE.Group();
    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    for (const child of [...this.root.children]) {
      child.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.root.remove(child);
    }
  }

  /**
   * Construit le model. Retourne un objet pour piloter bodygroups et skins.
   */
  show(model, materials) {
    this.clear();
    const group = new THREE.Group();
    this.root.add(group);

    const parts = model.bodyparts.map((part) => part.models.map((sub) => {
      const g = new THREE.Group();
      g.visible = false;
      for (const mesh of sub.meshes) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
        geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        const m = new THREE.Mesh(geo, materials.placeholder);
        m.userData = { skinref: mesh.skinref, isEye: mesh.isEye };
        g.add(m);
      }
      group.add(g);
      return g;
    }));

    const state = {
      bodygroups: model.bodyparts.map(() => 0),
      skin: 0,
    };

    const applySkin = (skin) => {
      state.skin = skin;
      const row = model.skins[skin] || model.skins[0] || [];
      group.traverse((o) => {
        if (!o.isMesh) return;
        const texIndex = row[o.userData.skinref] ?? o.userData.skinref;
        o.material = materials.get(model, texIndex, o.userData.isEye);
      });
    };

    const setBodygroup = (part, index) => {
      state.bodygroups[part] = index;
      parts[part].forEach((g, k) => { g.visible = k === index; });
    };

    model.bodyparts.forEach((_, p) => setBodygroup(p, 0));
    applySkin(0);
    this.frame();

    return { state, setBodygroup, setSkin: applySkin };
  }

  frame() {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 50;
    // distance pour que le model tienne en hauteur et en largeur
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const width = Math.max(size.x, size.z);
    const dist = Math.max(size.y / 2 / Math.tan(vfov / 2), width / 2 / Math.tan(hfov / 2)) * 1.2 + width / 2;
    this.controls.target.copy(center);
    this.camera.position.set(center.x + dist * 0.3, center.y + size.y * 0.08, center.z + dist * 0.95);
    this.camera.near = Math.max(0.1, dist / 200);
    this.camera.far = dist * 200;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.05;
    this.controls.maxDistance = dist * 25;
    this.controls.update();

    this.grid.position.y = box.min.y;
    const gridSize = Math.max(50, Math.ceil(radius * 4 / 10) * 10);
    this.grid.scale.setScalar(gridSize / 200);
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  // factor < 1 : zoom avant, > 1 : zoom arrière
  zoom(factor) {
    const c = this.controls;
    const offset = this.camera.position.clone().sub(c.target);
    const len = THREE.MathUtils.clamp(offset.length() * factor, c.minDistance, c.maxDistance);
    this.camera.position.copy(c.target).add(offset.setLength(len));
    c.update();
  }

  // déplace la vue (et donc le model à l'écran) d'une fraction de la distance
  pan(dx, dy) {
    const c = this.controls;
    const step = this.camera.position.distanceTo(c.target) * 0.1;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const move = right.multiplyScalar(-dx * step).add(up.multiplyScalar(-dy * step));
    this.camera.position.add(move);
    c.target.add(move);
    c.update();
  }
}

/**
 * Gestion des matériaux : lecture des VMT/VTF depuis l'archive de l'addon.
 */
export class MaterialLibrary {
  constructor(gma) {
    this.gma = gma;
    this.textures = new Map();
    this.materials = new Map();
    this.missing = new Set();
    this.placeholder = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.9 });
  }

  readText(path) {
    const b = this.gma.get(path);
    return b ? latin1.decode(b) : null;
  }

  findVmt(model, texName) {
    const name = normPath(texName).replace(/\.vmt$/, '');
    const dirs = [...model.cdtextures, ''];
    for (const dir of dirs) {
      const p = normPath(`materials/${dir}/${name}.vmt`);
      if (this.gma.has(p)) return p;
    }
    return null;
  }

  loadVmt(path, depth = 0) {
    const text = this.readText(path);
    if (!text) return null;
    const vmt = parseVmt(text);
    if (!vmt) return null;
    if (vmt.shader === 'patch' && vmt.params.include && depth < 4) {
      const base = this.loadVmt(normPath(vmt.params.include), depth + 1);
      if (base) {
        Object.assign(base.params, vmt.params.insert || {}, vmt.params.replace || {});
        return base;
      }
    }
    return vmt;
  }

  texture(name) {
    if (!name) return null;
    const path = normPath(`materials/${name.replace(/\.vtf$/i, '')}.vtf`);
    if (this.textures.has(path)) return this.textures.get(path);
    let tex = null;
    const bytes = this.gma.get(path);
    if (bytes) {
      try {
        const img = parseVtf(bytes);
        tex = new THREE.DataTexture(img.rgba, img.width, img.height, THREE.RGBAFormat);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
      } catch (e) {
        console.warn('Texture illisible', path, e);
      }
    } else {
      this.missing.add(path);
    }
    this.textures.set(path, tex);
    return tex;
  }

  get(model, texIndex, isEye) {
    const texName = model.textures[texIndex];
    if (texName === undefined) return this.placeholder;
    const vmtPath = this.findVmt(model, texName);
    const key = (vmtPath || 'missing:' + texName) + (isEye ? '#eye' : '');
    if (this.materials.has(key)) return this.materials.get(key);

    let mat;
    const vmt = vmtPath ? this.loadVmt(vmtPath) : null;
    if (!vmt) {
      this.missing.add(normPath(`materials/${texName}.vmt`));
      mat = this.placeholder;
    } else {
      const p = vmt.params;
      const on = (k) => p[k] !== undefined && parseFloat(p[k]) !== 0;
      const eyeShader = vmt.shader === 'eyerefract' || vmt.shader === 'eyes';
      const texPath = eyeShader && p.$iris ? p.$iris : p.$basetexture;
      const map = this.texture(texPath);

      mat = new THREE.MeshStandardMaterial({
        map,
        color: map ? 0xffffff : 0xb0b0b0,
        roughness: 0.8,
        metalness: 0,
        side: on('$nocull') ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (map && on('$translucent')) {
        mat.transparent = true;
        mat.depthWrite = false;
      } else if (map && on('$alphatest')) {
        mat.alphaTest = parseFloat(p.$alphatestreference) || 0.5;
      }
      if (on('$additive')) {
        mat.transparent = true;
        mat.blending = THREE.AdditiveBlending;
        mat.depthWrite = false;
      }
      if (p.$alpha !== undefined && parseFloat(p.$alpha) < 1) {
        mat.transparent = true;
        mat.opacity = parseFloat(p.$alpha);
      }
      if (map && !mat.transparent && !mat.alphaTest) {
        // l'alpha sert souvent de masque (spéculaire, couleur du joueur) : on l'ignore
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.a = 1.0;');
        };
        mat.customProgramCacheKey = () => 'opaque';
      }
    }
    this.materials.set(key, mat);
    return mat;
  }
}
