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

## Version en ligne (GitHub Pages + serveur Render)

Le site en ligne est en deux parties :

- **Le site** sur GitHub Pages (Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`). Le fichier `index.html` à la racine redirige vers `public/`.
- **Le serveur de téléchargement** (dossier `cloud/`) sur Render, gratuit. GitHub Pages ne peut pas exécuter de programme, et Steam empêche un site web de télécharger les addons lui-même : ce serveur le fait à sa place avec SteamCMD, puis envoie au navigateur **seulement les fichiers du model affiché** (quelques dizaines de Mo au lieu de l'addon entier). Les addons y sont supprimés 30 minutes après leur dernière utilisation.

### Mettre le serveur en ligne (une seule fois, ~10 minutes)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/lucasmasure/Visualisation-gmod)

1. Cliquez sur le bouton ci-dessus et créez un compte Render avec **GitHub** (offre gratuite, sans carte bancaire).
2. Autorisez Render à lire le dépôt `Visualisation-gmod`.
3. Render lit `render.yaml` et propose le service **visualisation-gmod** (offre *Free*). Cliquez sur **Deploy Blueprint** / **Apply**.
4. Attendez la fin de la construction (5 à 10 minutes) : l'état passe à **Live**.
5. Notez l'adresse du service (ex. `https://visualisation-gmod.onrender.com`) et vérifiez que `…/health` affiche `{"ok": true, …}`.
   Si l'adresse est différente, mettez-la dans `public/js/config.js` (`CLOUD_API`).

L'offre gratuite de Render met le serveur en veille après 15 minutes sans visite : le chargement suivant prend alors 1 à 2 minutes (le site affiche « Démarrage du serveur en ligne… »).
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

**Version en ligne** : l'addon est gardé sur le serveur Render le temps de la visite, puis supprimé 30 minutes après sa dernière utilisation (et à chaque redémarrage du serveur).

**Version locale (`start.bat`)** : l'addon est téléchargé dans le dossier temporaire de Windows (`%TEMP%\VisualisationSkinGmod`), envoyé au navigateur, puis **supprimé aussitôt**.
Un addon téléchargé mais jamais récupéré est effacé au bout de 30 minutes, et tout le dossier temporaire est vidé à chaque démarrage et à l'arrêt du serveur.
Le décodage (models, textures) se fait entièrement en mémoire, dans le navigateur.

## Structure du projet

```
index.html         redirige vers public/ (GitHub Pages)
cloud/             serveur en ligne (Docker + SteamCMD)
render.yaml        configuration du serveur sur Render
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

- Sur la version en ligne, coller un lien nécessite que le serveur Render soit en ligne (voir plus haut).
- Les models s'affichent dans leur pose de base (souvent en T), sans animation.
- Les textures absentes de l'addon (contenu du jeu ou d'un autre addon) s'affichent en gris et sont listées sous « Textures manquantes ».
- La teinte « couleur du joueur » de GMod n'est pas appliquée.

Projet non affilié à Valve ni à Facepunch Studios.
