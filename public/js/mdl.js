// Lecture des models Source (.mdl + .vvd + .dx90.vtx)

const latin1 = new TextDecoder('latin1');

function cstr(u8, offset, maxLen = 512) {
  let end = offset;
  const lim = Math.min(u8.length, offset + maxLen);
  while (end < lim && u8[end] !== 0) end++;
  return latin1.decode(u8.subarray(offset, end));
}

const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

// ---------------------------------------------------------------- MDL

function parseMdlHeader(u8) {
  const dv = view(u8);
  const id = cstr(u8, 0, 4);
  if (id !== 'IDST') throw new Error("Fichier MDL invalide");
  const version = dv.getInt32(4, true);
  const i = (o) => dv.getInt32(o, true);

  const h = {
    version,
    name: cstr(u8, 12, 64),
    numbones: i(156), boneindex: i(160),
    numtextures: i(204), textureindex: i(208),
    numcdtextures: i(212), cdtextureindex: i(216),
    numskinref: i(220), numskinfamilies: i(224), skinindex: i(228),
    numbodyparts: i(232), bodypartindex: i(236),
  };

  // textures (noms de matériaux)
  h.textures = [];
  for (let t = 0; t < h.numtextures; t++) {
    const o = h.textureindex + t * 64;
    h.textures.push(cstr(u8, o + i(o)));
  }

  // dossiers de recherche des matériaux
  h.cdtextures = [];
  for (let c = 0; c < h.numcdtextures; c++) {
    h.cdtextures.push(cstr(u8, i(h.cdtextureindex + c * 4)));
  }

  // table des skins : [famille][skinref] -> index de texture
  h.skins = [];
  for (let f = 0; f < h.numskinfamilies; f++) {
    const row = [];
    for (let r = 0; r < h.numskinref; r++) row.push(dv.getInt16(h.skinindex + (f * h.numskinref + r) * 2, true));
    h.skins.push(row);
  }

  // os : matrice pose -> os (3x4), inversée pour obtenir os -> model
  h.bones = [];
  for (let b = 0; b < h.numbones; b++) {
    const o = h.boneindex + b * 216;
    const m = [];
    for (let k = 0; k < 12; k++) m.push(dv.getFloat32(o + 96 + k * 4, true));
    h.bones.push({ name: cstr(u8, o + i(o)), parent: i(o + 4), boneToModel: invert34(m) });
  }

  // parties du corps (bodygroups)
  h.bodyparts = [];
  for (let b = 0; b < h.numbodyparts; b++) {
    const bo = h.bodypartindex + b * 16;
    const part = { name: cstr(u8, bo + i(bo)), base: i(bo + 8), models: [] };
    const nummodels = i(bo + 4);
    const modelindex = i(bo + 12);
    for (let m = 0; m < nummodels; m++) {
      const mo = bo + modelindex + m * 148;
      const model = {
        name: cstr(u8, mo, 64),
        nummeshes: i(mo + 72),
        numvertices: i(mo + 80),
        vertexStart: i(mo + 84) / 48,
        meshes: [],
        eyeballs: [],
      };
      const meshindex = i(mo + 76);
      for (let k = 0; k < model.nummeshes; k++) {
        const me = mo + meshindex + k * 116;
        model.meshes.push({
          material: i(me),
          numvertices: i(me + 8),
          vertexoffset: i(me + 12),
          materialtype: i(me + 24),
          materialparam: i(me + 28),
        });
      }
      const numeyeballs = i(mo + 100);
      const eyeballindex = i(mo + 104);
      const f = (o) => dv.getFloat32(o, true);
      for (let e = 0; e < numeyeballs; e++) {
        const eo = mo + eyeballindex + e * 172;
        model.eyeballs.push({
          bone: i(eo + 4),
          org: [f(eo + 8), f(eo + 12), f(eo + 16)],
          zoffset: f(eo + 20),
          radius: f(eo + 24),
          up: [f(eo + 28), f(eo + 32), f(eo + 36)],
          forward: [f(eo + 40), f(eo + 44), f(eo + 48)],
          texture: i(eo + 52),
          irisScale: f(eo + 60),
        });
      }
      part.models.push(model);
    }
    h.bodyparts.push(part);
  }
  return h;
}

// inverse d'une matrice 3x4 (rotation + translation), stockée ligne par ligne
function invert34(m) {
  // rotation transposée (on suppose une rotation orthonormée)
  const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const t = [m[3], m[7], m[11]];
  return [
    r[0], r[1], r[2], -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]),
    r[3], r[4], r[5], -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]),
    r[6], r[7], r[8], -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]),
  ];
}

const xformPoint = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
  m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
  m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
];
const xformDir = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
  m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
];

// ---------------------------------------------------------------- VVD

function parseVvd(u8) {
  const dv = view(u8);
  if (cstr(u8, 0, 4) !== 'IDSV') throw new Error('Fichier VVD invalide');
  const numLod0 = dv.getInt32(16, true);
  const numFixups = dv.getInt32(48, true);
  const fixupStart = dv.getInt32(52, true);
  const dataStart = dv.getInt32(56, true);

  // table de correspondance (les "fixups" réordonnent les sommets par LOD)
  let map;
  if (numFixups > 0) {
    map = new Int32Array(numLod0);
    let n = 0;
    for (let f = 0; f < numFixups; f++) {
      const o = fixupStart + f * 12;
      const lod = dv.getInt32(o, true);
      const src = dv.getInt32(o + 4, true);
      const count = dv.getInt32(o + 8, true);
      if (lod < 0) continue;
      for (let k = 0; k < count && n < numLod0; k++) map[n++] = src + k;
    }
  }

  const count = numLod0;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let v = 0; v < count; v++) {
    const s = map ? map[v] : v;
    const o = dataStart + s * 48;
    pos[v * 3] = dv.getFloat32(o + 16, true);
    pos[v * 3 + 1] = dv.getFloat32(o + 20, true);
    pos[v * 3 + 2] = dv.getFloat32(o + 24, true);
    nrm[v * 3] = dv.getFloat32(o + 28, true);
    nrm[v * 3 + 1] = dv.getFloat32(o + 32, true);
    nrm[v * 3 + 2] = dv.getFloat32(o + 36, true);
    uv[v * 2] = dv.getFloat32(o + 40, true);
    uv[v * 2 + 1] = dv.getFloat32(o + 44, true);
  }
  return { count, pos, nrm, uv };
}

// ---------------------------------------------------------------- VTX

// Les strip groups font 25 octets (Source 2006/2013) ou 33 (modèles CS:GO/L4D2)
function parseVtx(u8, mdl) {
  for (const sgSize of [25, 33]) {
    try {
      return parseVtxWith(u8, mdl, sgSize);
    } catch (e) {
      if (sgSize === 33) throw e;
    }
  }
}

function parseVtxWith(u8, mdl, sgSize) {
  const dv = view(u8);
  const i = (o) => {
    if (o < 0 || o + 4 > u8.length) throw new Error('VTX hors limites');
    return dv.getInt32(o, true);
  };
  if (i(0) !== 7) throw new Error('Version VTX non supportée');
  const numBodyParts = i(28);
  const bpOffset = i(32);
  if (numBodyParts !== mdl.bodyparts.length) throw new Error('VTX ne correspond pas au MDL');

  const result = [];
  for (let b = 0; b < numBodyParts; b++) {
    const bp = bpOffset + b * 8;
    const numModels = i(bp);
    const modelOffset = i(bp + 4);
    const models = [];
    for (let m = 0; m < numModels; m++) {
      const mo = bp + modelOffset + m * 8;
      const numLods = i(mo);
      const lodOffset = i(mo + 4);
      const meshes = [];
      const mdlModel = mdl.bodyparts[b].models[m];
      if (numLods > 0) {
        const lod = mo + lodOffset;
        const numMeshes = i(lod);
        const meshOffset = i(lod + 4);
        for (let k = 0; k < numMeshes; k++) {
          const me = lod + meshOffset + k * 9;
          const numSG = i(me);
          const sgOffset = i(me + 4);
          const mdlMesh = mdlModel?.meshes[k];
          const groups = [];
          for (let g = 0; g < numSG; g++) {
            const sg = me + sgOffset + g * sgSize;
            const numVerts = i(sg);
            const vertOffset = i(sg + 4);
            const numIndices = i(sg + 8);
            const indexOffset = i(sg + 12);
            if (numVerts < 0 || numIndices < 0 || numIndices % 3 !== 0) throw new Error('strip group invalide');
            if (sg + vertOffset + numVerts * 9 > u8.length || sg + indexOffset + numIndices * 2 > u8.length) throw new Error('strip group hors limites');
            const verts = new Uint16Array(numVerts);
            for (let v = 0; v < numVerts; v++) {
              const id = dv.getUint16(sg + vertOffset + v * 9 + 4, true);
              if (mdlMesh && id >= mdlMesh.numvertices) throw new Error('sommet invalide');
              verts[v] = id;
            }
            const indices = new Uint16Array(numIndices);
            for (let x = 0; x < numIndices; x++) {
              const id = dv.getUint16(sg + indexOffset + x * 2, true);
              if (id >= numVerts) throw new Error('index invalide');
              indices[x] = id;
            }
            groups.push({ verts, indices });
          }
          meshes.push(groups);
        }
      }
      models.push(meshes);
    }
    result.push(models);
  }
  return result;
}

// ---------------------------------------------------------------- Assemblage

// Calcule les UV des yeux (dans Source elles sont projetées par le shader)
function eyeUvs(eye, bones, pos, idxs) {
  const bone = bones[eye.bone];
  const m = bone ? bone.boneToModel : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const org = xformPoint(m, eye.org);
  const up = xformDir(m, eye.up);
  const fwd = xformDir(m, eye.forward);
  // droite = avant x haut
  const right = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
  const scale = eye.irisScale > 0 ? 1 / eye.irisScale + eye.zoffset : eye.radius * 2 || 1;
  const out = new Float32Array(idxs.length * 2);
  for (let k = 0; k < idxs.length; k++) {
    const v = idxs[k] * 3;
    const d = [pos[v] - org[0], pos[v + 1] - org[1], pos[v + 2] - org[2]];
    out[k * 2] = 0.5 - (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / scale;
    out[k * 2 + 1] = 0.5 - (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / scale;
  }
  return out;
}

/**
 * Lit un model complet.
 * Retourne { name, textures, cdtextures, skins, bodyparts:[{ name, models:[{ name, meshes:[{ skinref, isEye, positions, normals, uvs, indices }] }] }] }
 */
export function loadModel(mdlBytes, vvdBytes, vtxBytes) {
  const mdl = parseMdlHeader(mdlBytes);
  const vvd = parseVvd(vvdBytes);
  const vtx = parseVtx(vtxBytes, mdl);

  const bodyparts = mdl.bodyparts.map((part, b) => ({
    name: part.name,
    models: part.models.map((model, m) => {
      const vtxMeshes = vtx[b]?.[m] || [];
      const meshes = [];
      model.meshes.forEach((mesh, k) => {
        const groups = vtxMeshes[k] || [];
        let nv = 0, ni = 0;
        for (const g of groups) { nv += g.verts.length; ni += g.indices.length; }
        if (ni === 0) return;

        const src = new Uint32Array(nv); // index dans le VVD
        const indices = new Uint32Array(ni);
        let vo = 0, io = 0;
        const base = model.vertexStart + mesh.vertexoffset;
        for (const g of groups) {
          for (let v = 0; v < g.verts.length; v++) src[vo + v] = base + g.verts[v];
          // Source utilise l'ordre horaire : on inverse pour three.js
          for (let x = 0; x < g.indices.length; x += 3) {
            indices[io++] = vo + g.indices[x];
            indices[io++] = vo + g.indices[x + 2];
            indices[io++] = vo + g.indices[x + 1];
          }
          vo += g.verts.length;
        }

        const positions = new Float32Array(nv * 3);
        const normals = new Float32Array(nv * 3);
        let uvs = new Float32Array(nv * 2);
        for (let v = 0; v < nv; v++) {
          const s = src[v];
          if (s >= vvd.count) continue;
          positions.set(vvd.pos.subarray(s * 3, s * 3 + 3), v * 3);
          normals.set(vvd.nrm.subarray(s * 3, s * 3 + 3), v * 3);
          uvs.set(vvd.uv.subarray(s * 2, s * 2 + 2), v * 2);
        }

        const isEye = mesh.materialtype === 1 && model.eyeballs[mesh.materialparam];
        if (isEye) uvs = eyeUvs(model.eyeballs[mesh.materialparam], mdl.bones, vvd.pos, src);

        meshes.push({ skinref: mesh.material, isEye: !!isEye, positions, normals, uvs, indices });
      });
      return { name: model.name, empty: model.nummeshes === 0 || meshes.length === 0, meshes };
    }),
  }));

  return {
    name: mdl.name,
    version: mdl.version,
    textures: mdl.textures,
    cdtextures: mdl.cdtextures,
    skins: mdl.skins,
    bodyparts,
  };
}
