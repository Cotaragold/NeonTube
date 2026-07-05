# NeonTube

**English** | [Русский](README.ru.md)

Local GUI for downloading YouTube videos. Neon interface, download queue with progress, video preview, quality selection and three modes: video+audio / video only / audio only (mp3). UI in English and Russian (switchable).

Under the hood: Flask + [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg. Each download runs as a separate process, so cancellation is instant. Format selection prefers H.264 + AAC so files play in any player.

## Installation

```powershell
git clone https://github.com/Cotaragold/NeonTube.git
cd NeonTube
pip install -r requirements.txt
powershell -ExecutionPolicy Bypass -File get-ffmpeg.ps1   # downloads ffmpeg into bin/
```

Requires Python 3.10+ and Node.js (yt-dlp uses it as a JS runtime for YouTube).

## Running

Double-click `start.bat` — a browser opens at `http://127.0.0.1:8765`.

Or manually: `python app.py`

## Usage

1. Paste a link → **ANALYZE** — a preview appears with the thumbnail and available qualities.
2. Pick a mode (video+audio / video only / audio only) and quality.
3. **DOWNLOAD** — the job goes into the queue; you see progress, speed and ETA. Open the finished file right from its card.

Files are saved to `downloads/`.

## If YouTube is blocked by your ISP

The app connects directly, bypassing browser VPN extensions. Options:

- run a VPN client that tunnels all system traffic (TUN mode);
- or open "⚙ network settings" in the UI and enter your VPN client's local proxy,
  e.g. `socks5://127.0.0.1:1080`. The setting is stored in `config.json`.

## Disclaimer

A tool for personal use. Only download content you have the rights to, and respect YouTube's Terms of Service.
