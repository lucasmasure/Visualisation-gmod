# Visualisation Skin Gmod – serveur en ligne

Serveur utilisé par le site https://lucasmasure.github.io/Visualisation-gmod/ pour télécharger les addons Garry's Mod du Workshop (avec SteamCMD) et les envoyer au navigateur fichier par fichier.

Il est prévu pour Render (offre gratuite, voir `render.yaml` à la racine du dépôt), mais fonctionne sur n'importe quel hébergeur qui accepte un `Dockerfile`.

Les addons sont gardés au maximum 30 minutes après leur dernière utilisation, puis supprimés.

## Réglages (variables d'environnement)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `https://lucasmasure.github.io,http://localhost:8080` | sites autorisés à utiliser le serveur |
| `MAX_IDLE_MIN` | `30` | minutes avant suppression d'un addon inutilisé |
| `MAX_DISK_GB` | `20` | espace disque maximum utilisé par les addons |
| `MAX_ADDON_GB` | `4` | taille maximum d'un addon |
| `PORT` | `7860` | port d'écoute (fourni automatiquement par Render) |
