# Visualisation Skin Gmod

Site pour prévisualiser en 3D les models (playermodels, NPC, props…) d'un addon Garry's Mod du Steam Workshop, avec leurs textures, leurs bodygroups et leurs skins.

## Lancer le site (Windows)

1. Téléchargez ou clonez le dépôt :
   ```bash
   git clone https://github.com/lucasmasure/Visualisation-gmod.git
   ```
2. Double-cliquez sur **`start.bat`**. Le site s'ouvre sur http://localhost:8080/.
3. Fermez la fenêtre noire pour arrêter le serveur.

Rien à installer : le serveur utilise PowerShell, qui est inclus dans Windows.
La première fois qu'un addon récent est demandé, SteamCMD (l'outil officiel de Valve) est installé automatiquement dans `%LOCALAPPDATA%\VisualisationSkinGmod\steamcmd`. Cela prend 1 à 2 minutes, une seule fois.

Pour changer de port : `start.bat -Port 9000`.

## Version en ligne (GitHub Pages + serveur Hugging Face)

Le site en ligne est en deux parties :

- **Le site** sur GitHub Pages (Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`). Le fichier `index.html` à la racine redirige vers `public/`.
- **Le serveur de téléchargement** (dossier `cloud/`) sur Hugging Face Spaces, gratuit. GitHub Pages ne peut pas exécuter de programme, et Steam empêche un site web de télécharger les addons lui-même : ce serveur le fait à sa place avec SteamCMD, puis envoie au navigateur **seulement les fichiers du model affiché** (quelques dizaines de Mo au lieu de l'addon entier). Les addons y sont supprimés 30 minutes après leur dernière utilisation.

### Mettre le serveur en ligne (une seule fois, ~5 minutes)

1. Créez un compte gratuit sur https://huggingface.co (aucune carte bancaire).
2. Cliquez sur **New → Space** :
   - *Space name* : `visualisation-gmod`
   - *SDK* : **Docker** → *Blank*
   - *Hardware* : **CPU basic (gratuit)**
   - Visibilité : **Public**
3. Dans le Space, onglet **Files** → **Add file → Upload files**, envoyez les 3 fichiers du dossier `cloud/` : `Dockerfile`, `server.py` et `README.md` (il remplace celui créé par défaut). Cliquez sur **Commit**.
4. Attendez la fin de la construction (3 à 5 minutes) : l'état passe à **Running**. Vérifiez que https://VOTRE-NOM-visualisation-gmod.hf.space/health affiche `{"ok": true, …}`.
5. Si votre nom d'utilisateur Hugging Face n'est pas `lucasmasure`, mettez l'adresse du Space dans `public/js/config.js` (`CLOUD_API`).

Le Space gratuit s'endort après 48 h sans visite : le premier chargement suivant prend alors 1 à 2 minutes (le site affiche « Démarrage du serveur en ligne… »).
Si le serveur ne répond pas, il reste possible d'ouvrir le fichier `.gma` de l'addon (bouton « Ouvrir un fichier .gma » ou glisser-déposer) ; il se trouve dans `Steam\steamapps\workshop\content\4000\<id de l'addon>\` après s'être abonné dans Garry's Mod.

## Utilisation

1. Sur la page d'accueil, collez un lien du Workshop (ou juste l'ID), puis cliquez sur **Voir les models**.
2. Choisissez un model dans la liste de gauche.
3. Gérez les bodygroups et les skins dans le panneau de droite.

Contrôles de la vue 3D :

| Action | Souris | Boutons à l'écran |
| --- | --- | --- |
| Tourner autour | clic gauche | ⟳ Rotation (automatique) |
| Déplacer le model | clic droit, ou Maj + clic, ou flèches du clavier | ▲ ◀ ▶ ▼ |
| Zoomer / dézoomer | molette | ＋ / － |
| Recentrer | | ⌖ |

## Confidentialité : aucun addon n'est conservé

**Version en ligne** : l'addon est gardé sur le serveur Hugging Face le temps de la visite, puis supprimé 30 minutes après sa dernière utilisation (et à chaque redémarrage du serveur).

**Version locale (`start.bat`)** : l'addon est téléchargé dans le dossier temporaire de Windows (`%TEMP%\VisualisationSkinGmod`), envoyé au navigateur, puis **supprimé aussitôt**.
Un addon téléchargé mais jamais récupéré est effacé au bout de 30 minutes, et tout le dossier temporaire est vidé à chaque démarrage et à l'arrêt du serveur.
Le décodage (models, textures) se fait entièrement en mémoire, dans le navigateur.

## Structure du projet

```
index.html         redirige vers public/ (GitHub Pages)
cloud/             serveur en ligne (Hugging Face Spaces, Docker + SteamCMD)
start.bat          lance le serveur
server.ps1         serveur local (site + récupération des addons)
public/
  index.html       page d'accueil
  viewer.html      visionneuse 3D
  css/style.css
  img/logo.svg
  js/
    app.js         interface de la visionneuse
    config.js      adresse du serveur en ligne
    viewer.js      scène 3D (three.js) et matériaux
    gma.js         lecture des archives d'addon (.gma)
    lzma.js        décompression des anciens addons
    mdl.js         models Source (.mdl, .vvd, .vtx), bodygroups, skins, yeux
    vmt.js         matériaux (.vmt)
    vtf.js         textures (.vtf)
```

## Dépannage

**Le bouton « Voir les models » ne fait rien / un bandeau rouge « Le site n'est pas lancé » apparaît**
La page a été ouverte directement depuis le fichier (adresse en `file:///…`) ou le serveur est arrêté.
Double-cliquez sur `start.bat` et utilisez la page qui s'ouvre : son adresse doit être http://localhost:8080/.
Laissez la fenêtre noire ouverte tant que vous utilisez le site.

## Limites

- Sur la version en ligne, coller un lien nécessite que le serveur Hugging Face soit en ligne (voir plus haut).
- Les models s'affichent dans leur pose de base (souvent en T), sans animation.
- Les textures absentes de l'addon (contenu du jeu ou d'un autre addon) s'affichent en gris et sont listées sous « Textures manquantes ».
- La teinte « couleur du joueur » de GMod n'est pas appliquée.

Projet non affilié à Valve ni à Facepunch Studios.
