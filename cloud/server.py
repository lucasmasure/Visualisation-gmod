"""
Visualisation Skin Gmod - serveur en ligne (Hugging Face Spaces, Docker)

Télécharge les addons du Workshop avec SteamCMD et les sert fichier par fichier
au site (GitHub Pages), pour que le navigateur ne charge que le model affiché.
Les addons sont gardés temporairement puis supprimés après MAX_IDLE_MIN minutes
sans utilisation.

Uniquement la bibliothèque standard de Python.
"""

import json
import lzma
import os
import re
import shutil
import struct
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "7860"))
DATA_DIR = os.environ.get("DATA_DIR", "/tmp/vsg")
STEAMCMD = os.environ.get("STEAMCMD", "/app/steamcmd/steamcmd.sh")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get(
    "ALLOWED_ORIGINS", "https://lucasmasure.github.io,http://localhost:8080").split(",") if o.strip()]
MAX_IDLE_MIN = float(os.environ.get("MAX_IDLE_MIN", "30"))
MAX_DISK_GB = float(os.environ.get("MAX_DISK_GB", "20"))
MAX_ADDON_GB = float(os.environ.get("MAX_ADDON_GB", "4"))
GMOD_APPID = 4000

ADDONS_DIR = os.path.join(DATA_DIR, "addons")
STEAM_DIR = os.path.join(DATA_DIR, "steam")
os.makedirs(ADDONS_DIR, exist_ok=True)
os.makedirs(STEAM_DIR, exist_ok=True)

jobs = {}             # id -> état du téléchargement
addons = {}           # id -> { path, index, name, time_updated, last }
lock = threading.Lock()
steamcmd_lock = threading.Lock()   # SteamCMD ne supporte pas plusieurs instances


def log(*args):
    print(time.strftime("%H:%M:%S"), *args, flush=True)


# ---------------------------------------------------------------- Steam Web API

def steam_post(method, fields):
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(
        f"https://api.steampowered.com/ISteamRemoteStorage/{method}/v1/", data=data)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)["response"]


def file_details(ids):
    fields = {"itemcount": len(ids)}
    for i, x in enumerate(ids):
        fields[f"publishedfileids[{i}]"] = x
    return steam_post("GetPublishedFileDetails", fields).get("publishedfiledetails", [])


def collection_children(id_):
    r = steam_post("GetCollectionDetails", {"collectioncount": 1, "publishedfileids[0]": id_})
    c = (r.get("collectiondetails") or [{}])[0]
    if c.get("result") != 1:
        return []
    return [ch["publishedfileid"] for ch in c.get("children", [])]


def workshop_id(text):
    if not text:
        return None
    m = re.search(r"[?&]id=(\d+)", text) or re.fullmatch(r"\s*(\d+)\s*", text) or re.search(r"/(\d{6,})", text)
    return m.group(1) if m else None


# ---------------------------------------------------------------- GMA

def read_gma_index(path):
    """Retourne (nom, {chemin_minuscule: (offset, taille)})."""
    with open(path, "rb") as f:
        head = f.read(4 * 1024 * 1024)
        if head[:4] != b"GMAD":
            raise ValueError("pas une archive GMA")
        p = 4
        version = head[p]
        p += 1 + 16

        def cstr():
            nonlocal p
            end = head.index(b"\0", p)
            s = head[p:end].decode("utf-8", "replace")
            p = end + 1
            return s

        if version > 1:
            while cstr():
                pass
        name = cstr()
        cstr()  # description
        cstr()  # auteur
        p += 4
        entries = []
        eof = len(head) < 4 * 1024 * 1024
        while True:
            # l'index peut dépasser le premier bloc lu
            if p + 4096 > len(head) and not eof:
                f.seek(0)
                bigger = f.read(len(head) * 4)
                eof = len(bigger) < len(head) * 4
                head = bigger
            (num,) = struct.unpack_from("<I", head, p)
            p += 4
            if num == 0:
                break
            fname = cstr()
            size, _crc = struct.unpack_from("<qI", head, p)
            p += 12
            entries.append((fname, size))
    index = {}
    offset = p
    for fname, size in entries:
        index[fname.replace("\\", "/").lower()] = (offset, size)
        offset += size
    return name, index


def lzma_to_file(src, dst):
    """Anciens addons : LZMA "alone" -> GMA."""
    dec = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE)
    with open(src, "rb") as fi, open(dst, "wb") as fo:
        while True:
            chunk = fi.read(1 << 20)
            if not chunk:
                break
            fo.write(dec.decompress(chunk))
            if dec.eof:
                break


def finalize(id_, raw_path, details):
    gma_path = os.path.join(ADDONS_DIR, f"{id_}.gma")
    with open(raw_path, "rb") as f:
        magic = f.read(4)
    if magic == b"GMAD":
        shutil.move(raw_path, gma_path)
    else:
        lzma_to_file(raw_path, gma_path)
        os.remove(raw_path)
    name, index = read_gma_index(gma_path)
    with lock:
        addons[id_] = {
            "path": gma_path, "index": index, "name": name,
            "time_updated": int(details.get("time_updated", 0)), "last": time.time(),
        }


# ---------------------------------------------------------------- téléchargements

def dir_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for fn in files:
            try:
                total += os.path.getsize(os.path.join(root, fn))
            except OSError:
                pass
    return total


def download_http(id_, url, details):
    tmp = os.path.join(ADDONS_DIR, f"{id_}.download")
    job = jobs[id_]
    with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            job["done"] += len(chunk)
    finalize(id_, tmp, details)


def download_steamcmd(id_, details):
    job = jobs[id_]
    job["method"] = "steamcmd"
    content = os.path.join(STEAM_DIR, "steamapps", "workshop", "content", str(GMOD_APPID), id_)
    downloads = os.path.join(STEAM_DIR, "steamapps", "workshop", "downloads", str(GMOD_APPID), id_)
    with steamcmd_lock:
        job["queued"] = False
        for attempt in range(1, 4):
            job["attempt"] = attempt
            cmd = [STEAMCMD, "+force_install_dir", STEAM_DIR, "+login", "anonymous",
                   "+workshop_download_item", str(GMOD_APPID), id_, "+quit"]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
            out = []

            def reader():
                for line in proc.stdout:
                    out.append(line.rstrip())

            t = threading.Thread(target=reader, daemon=True)
            t.start()
            while proc.poll() is None:
                job["done"] = dir_size(downloads) + dir_size(content)
                time.sleep(1)
            t.join(5)

            found = None
            if os.path.isdir(content):
                files = [os.path.join(content, f) for f in os.listdir(content)
                         if f.lower().endswith((".gma", ".bin"))]
                if files:
                    found = max(files, key=os.path.getsize)
            if found:
                raw = os.path.join(ADDONS_DIR, f"{id_}.raw")
                shutil.move(found, raw)
                shutil.rmtree(content, ignore_errors=True)
                finalize(id_, raw, details)
                return
            log(f"steamcmd {id_} essai {attempt} échoué :", " | ".join(out[-4:]))
            job["error"] = "\n".join(out[-6:])
    raise RuntimeError("steamcmd: " + (job.get("error") or "échec"))


def run_job(id_, details):
    job = jobs[id_]
    try:
        free_space(int(details.get("file_size", 0)))
        if details.get("file_url"):
            download_http(id_, details["file_url"], details)
        else:
            download_steamcmd(id_, details)
        job["state"] = "ready"
        log("prêt :", id_, details.get("title"))
    except Exception as e:  # noqa: BLE001
        log("erreur :", id_, e)
        job["state"] = "error"
        job["error"] = str(e)


def start_job(details):
    id_ = details["publishedfileid"]
    jobs[id_] = {
        "state": "downloading", "method": "http" if details.get("file_url") else "steamcmd",
        "done": 0, "size": int(details.get("file_size", 0)), "attempt": 0,
        "queued": True, "started": time.time(), "error": None,
    }
    threading.Thread(target=run_job, args=(id_, details), daemon=True).start()


def remove_addon(id_):
    with lock:
        a = addons.pop(id_, None)
    if a:
        try:
            os.remove(a["path"])
        except OSError:
            pass
        log("supprimé :", id_)


def free_space(needed):
    """Supprime les addons les moins récemment utilisés si le disque est trop rempli."""
    limit = MAX_DISK_GB * 1024 ** 3
    while True:
        with lock:
            used = sum(os.path.getsize(a["path"]) for a in addons.values() if os.path.exists(a["path"]))
            oldest = min(addons, key=lambda k: addons[k]["last"]) if addons else None
        if used + needed <= limit or not oldest:
            return
        remove_addon(oldest)


def cleaner():
    while True:
        time.sleep(60)
        now = time.time()
        with lock:
            idle = [k for k, a in addons.items() if now - a["last"] > MAX_IDLE_MIN * 60]
        for k in idle:
            remove_addon(k)
        for k, j in list(jobs.items()):
            if j["state"] != "downloading" and now - j["started"] > 3600:
                jobs.pop(k, None)


# ---------------------------------------------------------------- HTTP

def status_of(id_):
    with lock:
        a = addons.get(id_)
        if a:
            a["last"] = time.time()
            return {"status": "ready", "name": a["name"],
                    "files": [[p, s] for p, (_o, s) in a["index"].items()]}
    j = jobs.get(id_)
    if not j:
        return {"status": "unknown"}
    if j["state"] == "error":
        jobs.pop(id_, None)
        return {"status": "error", "error": j["error"]}
    return {"status": "downloading", "method": j["method"], "done": j["done"], "size": j["size"],
            "attempt": j["attempt"], "queued": j["queued"], "steamcmdReady": True,
            "elapsed": int(time.time() - j["started"])}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def cors(self):
        origin = self.headers.get("Origin")
        if origin and (origin in ALLOWED_ORIGINS or "*" in ALLOWED_ORIGINS):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        arg = lambda k: (q.get(k) or [""])[0]
        try:
            if u.path == "/api/addon":
                self.api_addon(arg("url"))
            elif u.path == "/api/status":
                self.send_json(status_of(workshop_id(arg("id")) or ""))
            elif u.path == "/api/file":
                self.api_file(workshop_id(arg("id")), arg("path"))
            elif u.path in ("/", "/health"):
                self.send_json({"ok": True, "service": "Visualisation Skin Gmod"})
            else:
                self.send_json({"error": "not_found"}, 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa: BLE001
            log("erreur requête :", e)
            try:
                self.send_json({"error": "server", "message": str(e)}, 500)
            except Exception:  # noqa: BLE001
                pass

    def api_addon(self, url):
        id_ = workshop_id(url)
        if not id_:
            return self.send_json({"error": "bad_url"}, 400)
        d = (file_details([id_]) or [{}])[0]
        if d.get("result") != 1:
            return self.send_json({"error": "not_found", "id": id_}, 404)

        if not d.get("file_url") and int(d.get("file_size", 0) or 0) == 0:
            children = collection_children(id_)
            if children:
                items = []
                for i in range(0, len(children), 50):
                    for c in file_details(children[i:i + 50]):
                        if c.get("result") == 1:
                            items.append({"id": c["publishedfileid"], "title": c.get("title"),
                                          "preview": c.get("preview_url")})
                return self.send_json({"id": id_, "title": d.get("title"), "collection": True, "children": items})

        if int(d.get("consumer_app_id", 0)) != GMOD_APPID:
            return self.send_json({"error": "not_gmod", "id": id_, "title": d.get("title")}, 400)
        if int(d.get("file_size", 0) or 0) > MAX_ADDON_GB * 1024 ** 3:
            return self.send_json({"error": "too_big", "id": id_}, 400)

        with lock:
            a = addons.get(id_)
            outdated = a and a["time_updated"] != int(d.get("time_updated", 0))
        if outdated:
            remove_addon(id_)
        with lock:
            if id_ not in addons and (id_ not in jobs or jobs[id_]["state"] == "error"):
                start_job(d)

        st = status_of(id_)
        st.pop("files", None)
        self.send_json({"id": id_, "title": d.get("title"), "preview": d.get("preview_url"),
                        "size": int(d.get("file_size", 0) or 0), **st})

    def api_file(self, id_, path):
        with lock:
            a = addons.get(id_ or "")
            if a:
                a["last"] = time.time()
        if not a:
            return self.send_json({"error": "not_ready"}, 404)
        entry = a["index"].get(path.replace("\\", "/").lower())
        if not entry:
            return self.send_json({"error": "no_file"}, 404)
        offset, size = entry
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Cache-Control", "public, max-age=3600")
        self.send_header("Content-Length", str(size))
        self.end_headers()
        with open(a["path"], "rb") as f:
            f.seek(offset)
            left = size
            while left > 0:
                chunk = f.read(min(left, 1 << 20))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)


if __name__ == "__main__":
    # dossier temporaire vide à chaque démarrage
    for fn in os.listdir(ADDONS_DIR):
        try:
            os.remove(os.path.join(ADDONS_DIR, fn))
        except OSError:
            pass
    threading.Thread(target=cleaner, daemon=True).start()
    log(f"Visualisation Skin Gmod - serveur en ligne sur le port {PORT}")

    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def handle_error(self, request, client_address):
            # un visiteur qui ferme la page n'est pas une erreur
            pass

    Server(("0.0.0.0", PORT), Handler).serve_forever()
