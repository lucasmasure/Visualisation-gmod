import { Viewer, MaterialLibrary } from './viewer.js';
import { parseGma, isGma, normPath } from './gma.js';
import { lzmaDecompress, isLzma } from './lzma.js';
import { loadModel } from './mdl.js';

const $ = (id) => document.getElementById(id);
const form = $('addon-form');
const input = $('addon-url');
const viewBtn = $('view-btn');
const modelsList = $('models-list');
const bodygroupsEl = $('bodygroups');
const skinsSection = $('skins-section');
const skinsEl = $('skins');
const missingSection = $('missing-section');
const missingEl = $('missing');
const stageTitle = $('stage-title');

const viewer = new Viewer($('viewport'));
let current = null; // { gma, materials, id }
let loadToken = 0;

const ERRORS = {
  bad_url: "Lien invalide. Collez un lien du type https://steamcommunity.com/sharedfiles/filedetails/?id=123456789",
  not_found: "Addon introuvable sur le Workshop (lien incorrect, addon privé ou supprimé).",
  not_gmod: "Cet élément du Workshop n'est pas un addon Garry's Mod.",
  server: "Erreur du serveur",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (n) => (n / 1048576).toFixed(1) + ' Mo';
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ---------------------------------------------------------------- statut

function setStatus(text, progress) {
  const s = $('status');
  s.classList.remove('hidden', 'error');
  $('status-text').textContent = text;
  const bar = $('status-bar');
  bar.parentElement.classList.toggle('hidden', progress === undefined);
  if (progress !== undefined) bar.style.width = Math.round(progress * 100) + '%';
}
function setError(text) {
  setStatus(text);
  $('status').classList.add('error');
}
function hideStatus() { $('status').classList.add('hidden'); }

// ---------------------------------------------------------------- addon

const NO_SERVER = "Le serveur ne répond pas. Double-cliquez sur start.bat dans le dossier du site, puis rechargez la page.";

// Le serveur (start.bat) est-il là ? Sinon (ex. GitHub Pages) seuls les fichiers .gma sont possibles.
const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const serverAvailable = fetch('/api/status?id=0', { cache: 'no-store' })
  .then((r) => r.json())
  .then((d) => !!(d && d.status))
  .catch(() => false);

const workshopIdOf = (text) => (text.match(/[?&]id=(\d+)/) || text.trim().match(/^(\d+)$/) || [])[1];

function staticModeMessage(url) {
  const id = workshopIdOf(url) || '<id>';
  return "La version en ligne ne peut pas télécharger les addons du Workshop (Steam bloque les navigateurs).\n\n"
    + "Cliquez sur « Ouvrir un fichier .gma » et choisissez le fichier de l'addon. Après vous y être abonné dans Garry's Mod, il se trouve dans :\n"
    + `Steam\\steamapps\\workshop\\content\\4000\\${id}\\\n\n`
    + "Pour coller directement un lien, utilisez la version à télécharger (start.bat).";
}

async function api(url) {
  let r;
  try { r = await fetch(url); } catch { throw new Error(NO_SERVER); }
  let data;
  try { data = await r.json(); } catch { throw new Error('Réponse invalide du serveur'); }
  if (data.error) {
    const msg = ERRORS[data.error] || data.error;
    throw new Error(data.message ? `${msg} : ${data.message}` : msg);
  }
  return data;
}

async function loadAddon(url) {
  const token = ++loadToken;
  const alive = () => token === loadToken;
  viewBtn.disabled = true;
  try {
    resetModelUi();
    modelsList.innerHTML = '';
    $('addon-info').classList.add('hidden');
    setStatus("Recherche de l'addon sur le Workshop…");

    if (!(await serverAvailable)) throw new Error(isLocalHost ? NO_SERVER : staticModeMessage(url));
    if (!alive()) return;

    const info = await api('/api/addon?url=' + encodeURIComponent(url));
    if (!alive()) return;

    if (info.collection) {
      showCollection(info);
      hideStatus();
      return;
    }

    showAddonInfo(info);

    // attente du téléchargement côté serveur
    let st = info;
    while (st.status !== 'ready') {
      if (st.status === 'error') throw new Error('Échec du téléchargement.\n' + (st.error || ''));
      if (st.status === 'unknown') throw new Error('Téléchargement interrompu, réessayez.');
      if (st.method === 'http' && st.size) {
        setStatus(`Téléchargement de l'addon… ${mb(st.done || 0)} / ${mb(st.size)}`, (st.done || 0) / st.size);
      } else if (st.method === 'steamcmd' && !st.steamcmdReady) {
        setStatus(`Installation de SteamCMD (première utilisation, ~1 à 2 min)… ${st.elapsed || 0} s`);
      } else if (st.method === 'steamcmd') {
        const retry = st.attempt > 1 ? ` (essai ${st.attempt})` : '';
        setStatus(`Téléchargement via SteamCMD${retry}… ${st.elapsed || 0} s` + (info.size ? ` · ${mb(info.size)}` : ''));
      } else {
        setStatus('Téléchargement…');
      }
      await sleep(1000);
      if (!alive()) return;
      st = await api('/api/status?id=' + info.id);
    }

    // récupération du fichier
    let bytes = await downloadWithProgress('/api/file?id=' + info.id, (done, total) => {
      setStatus(`Chargement de l'addon dans le navigateur… ${mb(done)} / ${mb(total)}`, total ? done / total : undefined);
    });
    if (!alive()) return;

    await openAddonBytes(bytes, info.id);
  } catch (e) {
    console.error(e);
    if (alive()) setError(e.message || String(e));
  } finally {
    if (alive()) viewBtn.disabled = false;
  }
}

// Décompresse si besoin (anciens addons), lit l'archive et affiche la liste des models
async function openAddonBytes(bytes, id) {
  if (!isGma(bytes)) {
    if (!isLzma(bytes)) throw new Error("Ce fichier n'est pas un addon Garry's Mod (.gma).");
    setStatus("Décompression de l'addon…");
    await sleep(30);
    bytes = lzmaDecompress(bytes);
  }
  const gma = parseGma(bytes);
  current = { id, gma, materials: new MaterialLibrary(gma) };
  $('addon-meta').textContent = `${gma.files.size} fichiers · ${mb(bytes.length)}`;
  hideStatus();
  listModels();
}

// Ouverture d'un fichier .gma (ou .bin) choisi par l'utilisateur : tout reste dans le navigateur
async function loadFile(file) {
  const token = ++loadToken;
  try {
    resetModelUi();
    modelsList.innerHTML = '';
    setStatus(`Lecture de ${file.name}…`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (token !== loadToken) return;
    showAddonInfo({ title: file.name.replace(/\.(gma|bin)$/i, ''), size: file.size });
    await openAddonBytes(bytes, null);
    const gmaName = current.gma.name;
    if (gmaName) $('addon-title').textContent = gmaName;
  } catch (e) {
    console.error(e);
    if (token === loadToken) setError(e.message || String(e));
  }
}

async function downloadWithProgress(url, onProgress) {
  let r;
  try { r = await fetch(url); } catch { throw new Error(NO_SERVER); }
  if (!r.ok) throw new Error("Impossible de récupérer le fichier de l'addon. Relancez « Voir les models ».");
  const total = Number(r.headers.get('content-length')) || 0;
  const out = total ? new Uint8Array(total) : null;
  const chunks = [];
  const reader = r.body.getReader();
  let done = 0;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    if (out) out.set(value, done); else chunks.push(value);
    done += value.length;
    onProgress(done, total);
  }
  if (out) return out;
  const all = new Uint8Array(done);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return all;
}

function showAddonInfo(info) {
  $('addon-info').classList.remove('hidden');
  $('addon-title').textContent = info.title || `Addon ${info.id}`;
  $('addon-meta').textContent = info.size ? mb(info.size) : '';
  const img = $('addon-preview');
  if (info.preview) { img.src = info.preview; img.classList.remove('hidden'); } else img.classList.add('hidden');
}

function showCollection(info) {
  modelsList.innerHTML = '';
  modelsList.append(el('p', 'muted', `« ${info.title} » est une collection de ${info.children.length} addons. Choisissez-en un :`));
  for (const child of info.children) {
    const b = el('button', 'model-btn');
    b.append(el('span', 'name', child.title), el('span', 'path', child.id));
    b.onclick = () => {
      input.value = `https://steamcommunity.com/sharedfiles/filedetails/?id=${child.id}`;
      history.replaceState(null, '', '?addon=' + child.id);
      loadAddon(child.id);
    };
    modelsList.append(b);
  }
}

// ---------------------------------------------------------------- liste des models

const isArms = (p) => /(^|[\/_])(c_)?arms|hands/.test(p);

function listModels() {
  const { gma } = current;
  const models = [...gma.files.keys()]
    .filter((p) => p.endsWith('.mdl') && gma.has(p.replace(/\.mdl$/, '.vvd')))
    .sort((a, b) => (isArms(a) - isArms(b)) || a.localeCompare(b));

  modelsList.innerHTML = '';
  if (!models.length) {
    modelsList.append(el('p', 'muted', 'Aucun model trouvé dans cet addon.'));
    return;
  }
  for (const path of models) {
    const b = el('button', 'model-btn');
    const name = el('span', 'name', path.split('/').pop().replace(/\.mdl$/, ''));
    if (isArms(path)) name.append(el('span', 'tag', 'bras'));
    b.append(name, el('span', 'path', path));
    b.title = path;
    b.onclick = () => selectModel(path, b);
    modelsList.append(b);
  }
  selectModel(models[0], modelsList.querySelector('.model-btn'));
}

function resetModelUi() {
  viewer.clear();
  stageTitle.textContent = '';
  bodygroupsEl.innerHTML = '<p class="muted">Sélectionnez un model pour gérer ses bodygroups.</p>';
  skinsSection.classList.add('hidden');
  missingSection.classList.add('hidden');
}

function selectModel(path, button) {
  for (const b of modelsList.querySelectorAll('.model-btn')) b.classList.toggle('active', b === button);
  const { gma, materials } = current;
  const base = path.replace(/\.mdl$/, '');
  try {
    const vtxPath = ['.dx90.vtx', '.vtx', '.dx80.vtx', '.sw.vtx'].map((e) => base + e).find((p) => gma.has(p));
    if (!vtxPath) throw new Error('Fichier .vtx manquant pour ce model');
    const model = loadModel(gma.get(path), gma.get(base + '.vvd'), gma.get(vtxPath));
    const ctl = viewer.show(model, materials);
    stageTitle.textContent = path.split('/').pop();
    buildBodygroups(model, ctl);
    buildSkins(model, ctl);
    showMissing(model);
    hideStatus();
  } catch (e) {
    console.error(e);
    resetModelUi();
    setError(`Impossible d'afficher ce model : ${e.message}`);
  }
}

// ---------------------------------------------------------------- bodygroups / skins

const cleanName = (n) => n.split(/[\/\\]/).pop().replace(/\.(smd|dmx)$/i, '');

function buildBodygroups(model, ctl) {
  bodygroupsEl.innerHTML = '';
  const groups = model.bodyparts.map((p, i) => ({ p, i })).filter(({ p }) => p.models.length > 1);
  if (!groups.length) {
    bodygroupsEl.append(el('p', 'muted', "Ce model n'a pas de bodygroups."));
    return;
  }
  for (const { p, i } of groups) {
    const card = el('div', 'bodygroup');
    const title = el('div', 'bodygroup-name', p.name);
    const count = el('span', null, `${ctl.state.bodygroups[i]} / ${p.models.length - 1}`);
    title.append(count);
    const chips = el('div', 'chips');
    p.models.forEach((sub, k) => {
      const c = el('button', 'chip', sub.empty ? 'Aucun' : cleanName(sub.name) || `Option ${k}`);
      c.title = `${p.name} = ${k}`;
      if (k === ctl.state.bodygroups[i]) c.classList.add('active');
      c.onclick = () => {
        ctl.setBodygroup(i, k);
        for (const x of chips.children) x.classList.toggle('active', x === c);
        count.textContent = `${k} / ${p.models.length - 1}`;
      };
      chips.append(c);
    });
    card.append(title, chips);
    bodygroupsEl.append(card);
  }
}

function buildSkins(model, ctl) {
  skinsEl.innerHTML = '';
  if (model.skins.length <= 1) { skinsSection.classList.add('hidden'); return; }
  skinsSection.classList.remove('hidden');
  model.skins.forEach((_, k) => {
    const c = el('button', 'chip' + (k === ctl.state.skin ? ' active' : ''), `Skin ${k}`);
    c.onclick = () => {
      ctl.setSkin(k);
      for (const x of skinsEl.children) x.classList.toggle('active', x === c);
    };
    skinsEl.append(c);
  });
}

function showMissing(model) {
  const { gma, materials } = current;
  const missing = new Set();
  model.textures.forEach((t) => {
    const vmtPath = materials.findVmt(model, t);
    if (!vmtPath) { missing.add(normPath(`materials/${t}.vmt`)); return; }
    const vmt = materials.loadVmt(vmtPath);
    const tex = vmt && (vmt.params.$basetexture || vmt.params.$iris);
    if (tex && !gma.has(normPath(`materials/${tex.replace(/\.vtf$/i, '')}.vtf`))) missing.add(normPath(`materials/${tex}.vtf`));
  });
  missingEl.innerHTML = '';
  missingSection.classList.toggle('hidden', missing.size === 0);
  for (const m of missing) missingEl.append(el('li', null, m));
}

// ---------------------------------------------------------------- événements

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  history.replaceState(null, '', '?addon=' + encodeURIComponent(url));
  loadAddon(url);
});

// fichier .gma : bouton ou glisser-déposer sur la page
const fileInput = $('gma-file');
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
  fileInput.value = '';
});
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); }
});
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

// version en ligne : on l'indique tout de suite
serverAvailable.then((ok) => {
  if (ok || isLocalHost) return;
  document.body.classList.add('static-mode');
  if (!new URLSearchParams(location.search).get('addon')) {
    modelsList.innerHTML = '';
    modelsList.append(el('p', 'muted', "Version en ligne : ouvrez le fichier .gma d'un addon avec le bouton « Ouvrir un fichier .gma », ou glissez-le sur la page."));
  }
});

// les flèches servent à déplacer la vue, sauf pendant la saisie du lien
input.addEventListener('keydown', (e) => e.stopPropagation());

for (const b of document.querySelectorAll('[data-zoom]')) {
  b.addEventListener('click', () => viewer.zoom(parseFloat(b.dataset.zoom)));
}
for (const b of document.querySelectorAll('[data-pan]')) {
  const [dx, dy] = b.dataset.pan.split(',').map(Number);
  b.addEventListener('click', () => viewer.pan(dx, dy));
}

// lien venant de la page d'accueil : viewer.html?addon=...
const fromHome = new URLSearchParams(location.search).get('addon');
if (fromHome) {
  input.value = fromHome;
  loadAddon(fromHome);
}

$('btn-rotate').addEventListener('click', (e) => {
  const on = !e.currentTarget.classList.contains('active');
  e.currentTarget.classList.toggle('active', on);
  viewer.setAutoRotate(on);
});
$('btn-reset').addEventListener('click', () => viewer.frame());
