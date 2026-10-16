# Visualisation Skin Gmod - serveur en ligne (Hugging Face Spaces, SDK Docker)
FROM python:3.12-slim

# SteamCMD est un programme 32 bits
RUN apt-get update \
 && apt-get install -y --no-install-recommends lib32gcc-s1 lib32stdc++6 ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Hugging Face lance le conteneur avec l'utilisateur 1000
RUN useradd -m -u 1000 user
WORKDIR /app
RUN mkdir -p /app/steamcmd /data && chown -R user:user /app /data
USER user
ENV HOME=/home/user \
    STEAMCMD=/app/steamcmd/steamcmd.sh \
    DATA_DIR=/data \
    PORT=7860

# Installation et mise à jour de SteamCMD pendant la construction (démarrage plus rapide)
RUN curl -sSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar -xz -C /app/steamcmd \
 && (/app/steamcmd/steamcmd.sh +quit || true)

COPY --chown=user:user server.py /app/server.py

EXPOSE 7860
CMD ["python", "-u", "/app/server.py"]
