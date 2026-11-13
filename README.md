# YT Manager — a Quantumines tool

Manage all YouTube channels in one place: login homepage, owner + invited users, one tile per channel, and per-channel storage for Characters, Scripts, Sounds, Music, Thumbnails or any custom category — text and files together. Files are stored exactly as uploaded; downloads are byte-identical.

## Deploy on VPS Cloud Hostings
- App from GitHub → this repo → build: **Use my Dockerfile** → port **3000**
- Attach a **volume mounted at `/data`** — it holds the SQLite database and all uploaded files. Without it, a redeploy wipes everything.
- Optional env: `SESSION_SECRET` (any random string; auto-generated into the volume if unset).
- First visit shows "Create owner account".

## Run locally
npm install && npm start  → http://localhost:3000 (set DATA_DIR to choose where data lives)
