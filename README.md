# Visualisation Skin Gmod

Site pour prévisualiser en 3D les models (playermodels, NPC, props…) d'un addon Garry's Mod du Steam Workshop, avec leurs textures, leurs bodygroups et leurs skins.

## Lancer le site (Windows)

1. Téléchargez ou clonez le dépôt :
   ```bash
   git clone https://github.com/<votre-compte>/visualisation-skin-gmod.git
   ```
2. Double-cliquez sur **`start.bat`**. Le site s'ouvre sur http://localhost:8080/.
3. Fermez la fenêtre noire pour arrêter le serveur.

Rien à installer : le serveur utilise PowerShell, qui est inclus dans Windows.
La première fois qu'un addon récent est demandé, SteamCMD (l'outil officiel de Valve) est installé automatiquement dans `%LOCALAPPDATA%\VisualisationSkinGmod\steamcmd`. Cela prend 1 à 2 minutes, une seule fois.

Pour changer de port : `start.bat -Port 9000`.

## Version en ligne (GitHub Pages)

Le site peut aussi être publié avec GitHub Pages (Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`).
Le fichier `index.html` à la racine redirige vers `public/`.

GitHub Pages n'héberge que des fichiers : il ne peut pas faire tourner `server.ps1`, et Steam empêche un site web de télécharger les addons lui-même. Sur la version en ligne, **les liens du Workshop ne fonctionnent donc pas** ; on ouvre à la place le fichier `.gma` de l'addon (bouton « Ouvrir un fichier .gma » ou glisser-déposer).
Après s'être abonné à l'addon dans Garry's Mod, ce fichier se trouve dans `Steam\steamapps\workshop\content\4000\<id de l'addon>\`.
Le fichier est lu dans le navigateur et n'est envoyé nulle part.

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

## Confidentialité : aucun addon n'est stocké

L'addon est téléchargé dans le dossier temporaire de Windows (`%TEMP%\VisualisationSkinGmod`), envoyé au navigateur, puis **supprimé aussitôt**.
Un addon téléchargé mais jamais récupéré est effacé au bout de 30 minutes, et tout le dossier temporaire est vidé à chaque démarrage et à l'arrêt du serveur.
Le décodage (models, textures) se fait entièrement en mémoire, dans le navigateur.

## Structure du projet

```
index.html         redirige vers public/ (GitHub Pages)
start.bat          lance le serveur
server.ps1         serveur local (site + récupération des addons)
public/
  index.html       page d'accueil
  viewer.html      visionneuse 3D
  css/style.css
  img/logo.svg
  js/
    app.js         interface de la visionneuse
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

- Coller un lien du Workshop nécessite la version locale (`start.bat`). La version en ligne ne lit que les fichiers `.gma`.
- Les models s'affichent dans leur pose de base (souvent en T), sans animation.
- Les textures absentes de l'addon (contenu du jeu ou d'un autre addon) s'affichent en gris et sont listées sous « Textures manquantes ».
- La teinte « couleur du joueur » de GMod n'est pas appliquée.

Projet non affilié à Valve ni à Facepunch Studios.
