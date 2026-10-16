---
title: Visualisation Skin Gmod API
emoji: 🎮
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# Visualisation Skin Gmod – serveur en ligne

Serveur utilisé par le site https://lucasmasure.github.io/Visualisation-gmod/ pour télécharger les addons Garry's Mod du Workshop (avec SteamCMD) et les envoyer au navigateur fichier par fichier.

Les addons sont gardés au maximum 30 minutes après leur dernière utilisation, puis supprimés.

## Réglages (Settings → Variables)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `https://lucasmasure.github.io,http://localhost:8080` | sites autorisés à utiliser le serveur |
| `MAX_IDLE_MIN` | `30` | minutes avant suppression d'un addon inutilisé |
| `MAX_DISK_GB` | `20` | espace disque maximum utilisé par les addons |
| `MAX_ADDON_GB` | `4` | taille maximum d'un addon |
