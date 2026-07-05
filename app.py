# -*- coding: utf-8 -*-
"""NeonTube — локальный GUI для скачивания видео с YouTube (yt-dlp + Flask)."""
import json
import os
import subprocess
import sys
import threading
import uuid
import time

from flask import Flask, jsonify, request, send_from_directory
import yt_dlp

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(BASE_DIR, "downloads")
FFMPEG_DIR = os.path.join(BASE_DIR, "bin")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

os.makedirs(DOWNLOAD_DIR, exist_ok=True)


def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


config = load_config()


def _apply_proxy(opts):
    proxy = (config.get("proxy") or "").strip()
    if proxy:
        opts["proxy"] = proxy
    return opts

app = Flask(__name__, static_folder="static", static_url_path="/static")

# ---------------------------------------------------------------- очередь ---

jobs = {}          # id -> job dict
jobs_lock = threading.Lock()
job_queue = []     # id-шники в порядке добавления
queue_cv = threading.Condition(jobs_lock)


def _public_job(job):
    return {k: job[k] for k in (
        "id", "url", "title", "thumbnail", "mode", "quality", "status",
        "progress", "speed", "eta", "error", "filename", "added_at",
    )}


def _build_cmd(job):
    mode = job["mode"]
    q = job["quality"]  # число (высота) или "best"
    hsel = "" if q == "best" else f"[height<={q}]"

    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--newline", "--no-playlist", "--no-warnings",
        "--ffmpeg-location", FFMPEG_DIR,
        "--socket-timeout", "15", "--retries", "3",
        "--js-runtimes", "node",
        "-o", os.path.join(DOWNLOAD_DIR, "%(title).150B [%(id)s].%(ext)s"),
        "--progress-template",
        ("download:PROG|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|"
         "%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s"),
        "--print", "after_move:DEST|%(filepath)s",
        "--no-simulate",  # --print сам по себе включает режим симуляции
    ]

    proxy = (config.get("proxy") or "").strip()
    if proxy:
        cmd += ["--proxy", proxy]

    # Приоритет H.264 (avc1) + AAC (m4a): AV1/Opus в mp4 многие плееры
    # не воспроизводят («нет звука»). Фоллбеки — если нужной высоты в
    # совместимых кодеках нет (напр. 4K бывает только в VP9/AV1).
    if mode == "audio":
        cmd += ["-f", "bestaudio/best", "-x",
                "--audio-format", "mp3", "--audio-quality", "192K"]
    elif mode == "video":
        cmd += ["-f", (f"bestvideo{hsel}[vcodec^=avc1]/"
                       f"bestvideo{hsel}[ext=mp4]/bestvideo{hsel}/best{hsel}")]
    else:  # full
        cmd += ["-f", (f"bestvideo{hsel}[vcodec^=avc1]+bestaudio[ext=m4a]/"
                       f"bestvideo{hsel}+bestaudio[ext=m4a]/"
                       f"bestvideo{hsel}+bestaudio/best{hsel}/best"),
                "--merge-output-format", "mp4",
                # если аудио всё же не AAC — перекодировать только звук
                "--postprocessor-args", "Merger:-c:v copy -c:a aac -b:a 192k"]

    cmd.append(job["url"])
    return cmd


def _kill_tree(proc):
    """Убивает yt-dlp вместе с дочерним ffmpeg."""
    subprocess.run(
        ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
        capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)


def _run_job(job):
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.Popen(
        _build_cmd(job),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        encoding="utf-8", errors="replace",
        creationflags=subprocess.CREATE_NO_WINDOW, env=env)
    with jobs_lock:
        job["_proc"] = proc

    stderr_tail = []

    def read_stderr():
        for line in proc.stderr:
            line = line.strip()
            if line:
                stderr_tail.append(line)
                del stderr_tail[:-5]

    t_err = threading.Thread(target=read_stderr, daemon=True)
    t_err.start()

    dest = None
    for line in proc.stdout:
        line = line.strip()
        if line.startswith("PROG|"):
            parts = line.split("|")
            done = float(parts[1]) if parts[1] not in ("NA", "") else 0
            total = next((float(p) for p in (parts[2], parts[3])
                          if p not in ("NA", "")), 0)
            speed = float(parts[4]) if parts[4] not in ("NA", "") else 0
            eta = int(float(parts[5])) if parts[5] not in ("NA", "") else None
            with jobs_lock:
                if total:
                    pct = round(done * 100.0 / total, 1)
                    job["progress"] = pct
                    # 100% сегмента, но файл ещё склеивается/конвертируется
                    job["status"] = "processing" if pct >= 100 else "downloading"
                job["speed"] = speed
                job["eta"] = eta
        elif line.startswith("DEST|"):
            dest = line[5:].strip()
            with jobs_lock:
                job["status"] = "processing"

    proc.wait()
    t_err.join(timeout=5)

    with jobs_lock:
        job["_proc"] = None
        job["speed"] = 0
        job["eta"] = None
        if job.get("cancelled"):
            job["status"] = "cancelled"
        elif proc.returncode == 0 and dest:
            job["status"] = "done"
            job["progress"] = 100.0
            job["filename"] = os.path.basename(dest)
        else:
            job["status"] = "error"
            job["error"] = " · ".join(stderr_tail)[-300:] or \
                f"yt-dlp завершился с кодом {proc.returncode}"


def worker():
    while True:
        with queue_cv:
            while not job_queue:
                queue_cv.wait()
            job_id = job_queue.pop(0)
            job = jobs.get(job_id)
            if job is None or job.get("cancelled"):
                if job is not None:
                    job["status"] = "cancelled"
                continue
            job["status"] = "downloading"

        try:
            _run_job(job)
        except Exception as e:  # noqa: BLE001 — показываем причину в UI
            with jobs_lock:
                job["_proc"] = None
                job["status"] = "error"
                job["error"] = str(e)[:300]


threading.Thread(target=worker, daemon=True).start()

# ------------------------------------------------------------------- API ---


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/info", methods=["POST"])
def api_info():
    url = (request.json or {}).get("url", "").strip()
    if not url:
        return jsonify({"error": "Пустая ссылка"}), 400
    try:
        opts = _apply_proxy({"quiet": True, "no_warnings": True,
                             "noplaylist": True, "skip_download": True,
                             "socket_timeout": 15, "retries": 1,
                             "extractor_retries": 1,
                             "js_runtimes": {"node": {}},
                             "ffmpeg_location": FFMPEG_DIR})
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Не удалось получить информацию: {e}"}), 422

    heights = sorted({
        f["height"] for f in info.get("formats", [])
        if f.get("height") and f.get("vcodec") not in (None, "none")
    }, reverse=True)

    return jsonify({
        "url": info.get("webpage_url") or url,
        "title": info.get("title"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader"),
        "view_count": info.get("view_count"),
        "heights": heights,
    })


@app.route("/api/download", methods=["POST"])
def api_download():
    data = request.json or {}
    url = data.get("url", "").strip()
    mode = data.get("mode", "full")
    quality = data.get("quality", "best")
    if not url:
        return jsonify({"error": "Пустая ссылка"}), 400
    if mode not in ("full", "video", "audio"):
        return jsonify({"error": "Неверный режим"}), 400
    if quality != "best":
        try:
            quality = int(quality)
        except (TypeError, ValueError):
            return jsonify({"error": "Неверное качество"}), 400

    job = {
        "id": uuid.uuid4().hex[:12],
        "url": url,
        "title": data.get("title") or url,
        "thumbnail": data.get("thumbnail"),
        "mode": mode,
        "quality": quality,
        "status": "queued",
        "progress": 0.0,
        "speed": 0,
        "eta": None,
        "error": None,
        "filename": None,
        "cancelled": False,
        "added_at": time.time(),
        "_proc": None,
    }
    with queue_cv:
        jobs[job["id"]] = job
        job_queue.append(job["id"])
        queue_cv.notify()
    return jsonify(_public_job(job))


@app.route("/api/queue")
def api_queue():
    with jobs_lock:
        items = sorted(jobs.values(), key=lambda j: j["added_at"])
        return jsonify([_public_job(j) for j in items])


@app.route("/api/cancel/<job_id>", methods=["POST"])
def api_cancel(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Нет такой задачи"}), 404
        if job["status"] in ("queued", "downloading", "processing"):
            job["cancelled"] = True
            if job["status"] == "queued":
                job["status"] = "cancelled"
            proc = job.get("_proc")
        else:
            proc = None
    if proc is not None:
        _kill_tree(proc)
    with jobs_lock:
        return jsonify(_public_job(job))


@app.route("/api/clear", methods=["POST"])
def api_clear():
    with jobs_lock:
        for jid in [j["id"] for j in jobs.values()
                    if j["status"] in ("done", "error", "cancelled")]:
            del jobs[jid]
    return jsonify({"ok": True})


@app.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    if request.method == "POST":
        config["proxy"] = ((request.json or {}).get("proxy") or "").strip()
        save_config(config)
    return jsonify({"proxy": config.get("proxy", "")})


@app.route("/downloads/<path:name>")
def serve_download(name):
    return send_from_directory(DOWNLOAD_DIR, name, as_attachment=True)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    app.run(host="127.0.0.1", port=port, debug=False)
