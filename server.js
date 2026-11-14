// YT Manager — manage YouTube channel assets (characters, scripts, sounds, anything)
// Files are stored as the exact bytes uploaded; downloads are byte-identical.
const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const cookieSession = require("cookie-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- session secret (persisted) ----------
const secretFile = path.join(DATA_DIR, ".secret");
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString("hex"));
  SECRET = fs.readFileSync(secretFile, "utf8").trim();
}

// ---------- db ----------
const db = new Database(path.join(DATA_DIR, "ytmanager.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS channels(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, handle TEXT, notes TEXT, color TEXT DEFAULT '#e53935',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  category TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  orig_name TEXT NOT NULL, stored_name TEXT NOT NULL,
  size INTEGER, mime TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS schedule(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL, planned_date TEXT NOT NULL, note TEXT,
  status TEXT NOT NULL DEFAULT 'planned', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sched_files(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedule(id) ON DELETE CASCADE,
  orig_name TEXT NOT NULL, stored_name TEXT NOT NULL,
  size INTEGER, mime TEXT, created_at TEXT DEFAULT (datetime('now'))
);
`);
db.pragma("foreign_keys = ON");

// ---------- app ----------
const app = express();
app.use(express.urlencoded({ extended: true, limit: "10mb" })); // big bulk pastes welcome
app.use(cookieSession({
  name: "ytm",
  secret: SECRET,
  httpOnly: true,
  sameSite: "lax",
  maxAge: 30 * 24 * 3600 * 1000,
}));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + "-" + crypto.randomBytes(6).toString("hex")),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB per file
});

const userCount = () => db.prepare("SELECT COUNT(*) c FROM users").get().c;
const me = (req) => (req.session.uid ? db.prepare("SELECT * FROM users WHERE id=?").get(req.session.uid) : null);

function requireAuth(req, res, next) {
  if (userCount() === 0) return res.redirect("/setup");
  if (!me(req)) return res.redirect("/");
  next();
}
function requireOwner(req, res, next) {
  const u = me(req);
  if (!u || u.role !== "owner") return res.status(403).send("Owners only.");
  next();
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DEFAULT_CATS = ["Characters", "Scripts", "Sounds", "Music", "Thumbnails", "Branding", "Ideas", "Other"];
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : n > 1024 ? (n / 1024).toFixed(0) + " KB" : n + " B";

// ---------- layout ----------
function page(title, body, u) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — YT Manager</title>
<style>
:root{--bg:#0f1115;--card:#1a1d24;--card2:#22262f;--line:#2c313c;--txt:#e8eaf0;--mut:#9aa3b2;--red:#e53935;--accent:#4e8ef0}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh}
a{color:var(--accent);text-decoration:none}
header{display:flex;align-items:center;gap:14px;padding:14px 26px;border-bottom:1px solid var(--line);background:var(--card)}
header .logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;color:var(--txt)}
header .logo .tv{width:30px;height:22px;background:var(--red);border-radius:6px;position:relative}
header .logo .tv:after{content:"";position:absolute;left:11px;top:5px;border-left:9px solid #fff;border-top:6px solid transparent;border-bottom:6px solid transparent}
header nav{margin-left:auto;display:flex;gap:18px;align-items:center;color:var(--mut)}
.wrap{max-width:1100px;margin:0 auto;padding:30px 22px}
h1{font-size:24px;margin-bottom:6px} h2{font-size:18px;margin:22px 0 10px}
.mut{color:var(--mut);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;margin-top:20px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;display:block;color:var(--txt);transition:.15s}
.tile:hover{border-color:var(--accent);transform:translateY(-2px)}
.tile .dot{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;color:#fff;margin-bottom:10px}
.tile h3{font-size:16px} .tile .mut{margin-top:4px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-top:14px}
input,select,textarea{width:100%;background:var(--card2);border:1px solid var(--line);border-radius:9px;color:var(--txt);padding:10px 12px;font-size:14px;margin:6px 0 12px}
textarea{min-height:110px;resize:vertical;font-family:inherit}
label{font-size:13px;color:var(--mut)}
button,.btn{background:var(--red);border:0;color:#fff;border-radius:9px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;display:inline-block}
button.sec,.btn.sec{background:var(--card2);border:1px solid var(--line);color:var(--txt)}
button.danger{background:transparent;border:1px solid #713;color:#f88;padding:6px 12px;font-size:12px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 4px}
.tabs a{padding:7px 14px;border-radius:999px;background:var(--card2);border:1px solid var(--line);color:var(--mut);font-size:13px}
.tabs a.on{background:var(--red);color:#fff;border-color:var(--red)}
.item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:12px}
.item h3{font-size:15px}
.item .body{white-space:pre-wrap;margin-top:8px;font-size:14px;color:#cdd3de;background:var(--card2);border-radius:8px;padding:10px;max-height:260px;overflow:auto}
.file{display:flex;gap:10px;align-items:center;margin-top:8px;font-size:13px}
.badge{font-size:11px;background:var(--card2);border:1px solid var(--line);color:var(--mut);padding:3px 9px;border-radius:999px}
table{width:100%;border-collapse:collapse;margin-top:10px}
td,th{padding:9px 10px;border-bottom:1px solid var(--line);font-size:14px;text-align:left}
footer{text-align:center;color:var(--mut);font-size:12px;padding:26px}
.center{max-width:420px;margin:8vh auto;padding:0 20px}
details summary{cursor:pointer;color:var(--accent);font-size:14px;margin:14px 0 6px}
</style></head><body>
<header>
  <a class="logo" href="/dashboard"><span class="tv"></span> YT Manager</a>
  ${u ? `<nav>
    <a href="/dashboard">Channels</a>
    ${u.role === "owner" ? `<a href="/users">Users</a>` : ""}
    <span class="mut">${esc(u.name)}</span>
    <form method="post" action="/logout" style="margin:0"><button class="sec" style="padding:6px 12px;font-size:12px">Logout</button></form>
  </nav>` : ""}
</header>
${body}
<footer>YT Manager · a Quantumines tool · files stored & downloaded in original quality</footer>
</body></html>`;
}

// ---------- auth ----------
app.get("/", (req, res) => {
  if (userCount() === 0) return res.redirect("/setup");
  if (me(req)) return res.redirect("/dashboard");
  res.send(page("Login", `
  <div class="center"><div class="card">
    <h1 style="text-align:center">Welcome back</h1>
    <p class="mut" style="text-align:center;margin-bottom:14px">Sign in to your YouTube control room</p>
    ${req.query.e ? `<p style="color:#f88;font-size:13px;margin-bottom:10px">Wrong email or password.</p>` : ""}
    <form method="post" action="/login">
      <label>Email</label><input name="email" type="email" required>
      <label>Password</label><input name="password" type="password" required>
      <button style="width:100%">Login</button>
    </form>
  </div></div>`, null));
});

app.get("/setup", (req, res) => {
  if (userCount() > 0) return res.redirect("/");
  res.send(page("Setup", `
  <div class="center"><div class="card">
    <h1 style="text-align:center">Create owner account</h1>
    <p class="mut" style="text-align:center;margin-bottom:14px">First run — this account controls everything.</p>
    <form method="post" action="/setup">
      <label>Full name</label><input name="name" required>
      <label>Email</label><input name="email" type="email" required>
      <label>Password</label><input name="password" type="password" minlength="8" required>
      <button style="width:100%">Create & login</button>
    </form>
  </div></div>`, null));
});

app.post("/setup", (req, res) => {
  if (userCount() > 0) return res.redirect("/");
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 8) return res.redirect("/setup");
  const r = db.prepare("INSERT INTO users(name,email,pass_hash,role) VALUES(?,?,?,'owner')")
    .run(name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(password, 10));
  req.session.uid = r.lastInsertRowid;
  res.redirect("/dashboard");
});

app.post("/login", (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE email=?").get((req.body.email || "").trim().toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || "", u.pass_hash)) return res.redirect("/?e=1");
  req.session.uid = u.id;
  res.redirect("/dashboard");
});

app.post("/logout", (req, res) => { req.session = null; res.redirect("/"); });

// ---------- dashboard: channel tiles ----------
app.get("/dashboard", requireAuth, (req, res) => {
  const u = me(req);
  const channels = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.channel_id=c.id) itemCount
    FROM channels c ORDER BY c.name COLLATE NOCASE`).all();
  res.send(page("Channels", `
  <div class="wrap">
    <h1>Your YouTube channels</h1>
    <p class="mut">Each tile is one channel — open it to store characters, scripts, sounds and everything else.</p>
    <div class="grid">
      ${channels.map(c => `
        <a class="tile" href="/channels/${c.id}">
          <div class="dot" style="background:${esc(c.color)}">${esc(c.name[0].toUpperCase())}</div>
          <h3>${esc(c.name)}</h3>
          <div class="mut">${esc(c.handle || "")}</div>
          <div class="mut">${c.itemCount} item${c.itemCount === 1 ? "" : "s"}</div>
        </a>`).join("")}
    </div>
    <details ${channels.length === 0 ? "open" : ""}><summary>+ Add a channel</summary>
      <div class="card" style="max-width:460px">
        <form method="post" action="/channels">
          <label>Channel name</label><input name="name" placeholder="e.g. Dundle Doo" required>
          <label>Handle (optional)</label><input name="handle" placeholder="@DundleDoo">
          <label>Notes (optional)</label><textarea name="notes" placeholder="Niche, login hints, upload schedule…"></textarea>
          <button>Create channel</button>
        </form>
      </div>
    </details>
  </div>`, u));
});

const PALETTE = ["#e53935", "#4e8ef0", "#2fbd8f", "#f0a53d", "#9b59d0", "#f065b8", "#26c6da", "#8d6e63"];
app.post("/channels", requireAuth, (req, res) => {
  const { name, handle, notes } = req.body;
  if (!name) return res.redirect("/dashboard");
  const used = db.prepare("SELECT color FROM channels").all().map(c => c.color);
  const color = PALETTE.find(c => !used.includes(c)) || PALETTE[used.length % PALETTE.length];
  const r = db.prepare("INSERT INTO channels(name,handle,color,notes) VALUES(?,?,?,?)")
    .run(name.trim(), (handle || "").trim(), color, notes || "");
  res.redirect("/channels/" + r.lastInsertRowid);
});

app.post("/channels/:id/delete", requireAuth, requireOwner, (req, res) => {
  const files = db.prepare(`SELECT f.stored_name FROM files f JOIN items i ON f.item_id=i.id WHERE i.channel_id=?`).all(req.params.id);
  db.prepare("DELETE FROM channels WHERE id=?").run(req.params.id);
  for (const f of files) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f.stored_name)); } catch {} }
  res.redirect("/dashboard");
});

// ---------- channel page ----------
app.get("/channels/:id", requireAuth, (req, res) => {
  const u = me(req);
  const c = db.prepare("SELECT * FROM channels WHERE id=?").get(req.params.id);
  if (!c) return res.redirect("/dashboard");
  const cats = db.prepare("SELECT DISTINCT category FROM items WHERE channel_id=? ORDER BY category").all(c.id).map(r => r.category);
  const allCats = [...new Set([...DEFAULT_CATS.filter(d => cats.includes(d)), ...cats])];
  const active = req.query.cat || "";
  const q = (req.query.q || "").trim();
  let sql = "SELECT * FROM items WHERE channel_id=?", args = [c.id];
  if (active) { sql += " AND category=?"; args.push(active); }
  if (q) { sql += " AND (title LIKE ? OR body LIKE ?)"; args.push(`%${q}%`, `%${q}%`); }
  const sortKey = { new: "created_at DESC", old: "created_at ASC", title: "title COLLATE NOCASE ASC", cat: "category COLLATE NOCASE ASC, created_at DESC" }[req.query.sort] || "created_at DESC";
  sql += " ORDER BY " + sortKey;
  const items = db.prepare(sql).all(...args);
  const sched = db.prepare("SELECT * FROM schedule WHERE channel_id=? ORDER BY (status='done') ASC, planned_date ASC").all(c.id);
  const sfilesFor = db.prepare("SELECT * FROM sched_files WHERE schedule_id=?");
  const today = new Date().toISOString().slice(0, 10);
  const fileRows = db.prepare("SELECT * FROM files WHERE item_id=?");

  res.send(page(c.name, `
  <div class="wrap">
    <div class="row" style="justify-content:space-between">
      <div>
        <h1><span style="color:${esc(c.color)}">●</span> ${esc(c.name)} <span class="mut" style="font-size:14px">${esc(c.handle || "")}</span></h1>
        ${c.notes ? `<p class="mut" style="margin-top:4px;white-space:pre-wrap">${esc(c.notes)}</p>` : ""}
      </div>
      ${u.role === "owner" ? `<form method="post" action="/channels/${c.id}/delete" onsubmit="return confirm('Delete this channel and ALL its items & files?')"><button class="danger">Delete channel</button></form>` : ""}
    </div>

    <h2>&#128197; Upcoming schedule</h2>
    <div class="card">
      ${sched.length === 0 ? `<p class="mut">Nothing planned yet.</p>` : `<table>
        <tr><th>Date</th><th>Title</th><th>Note</th><th></th><th></th></tr>
        ${sched.map(sc => {
          const overdue = sc.status === "planned" && sc.planned_date < today;
          return `<tr style="${sc.status === "done" ? "opacity:.45" : ""}">
            <td style="white-space:nowrap;${overdue ? "color:#f88;font-weight:600" : ""}">${esc(sc.planned_date)}${overdue ? " &#9888;" : ""}</td>
            <td>${sc.status === "done" ? "<s>" + esc(sc.title) + "</s>" : esc(sc.title)}${sfilesFor.all(sc.id).map(f => `<div class="file" style="margin-top:4px">&#128206; <a href="/sfiles/${f.id}/download">${esc(f.orig_name)}</a> <span class="mut">${fmtSize(f.size)}</span></div>`).join("")}</td>
            <td class="mut">${esc(sc.note || "")}</td>
            <td><form method="post" action="/schedule/${sc.id}/done" style="margin:0"><button class="sec" style="padding:4px 10px;font-size:12px">${sc.status === "done" ? "Undo" : "Done"}</button></form></td>
            <td><form method="post" action="/schedule/${sc.id}/delete" style="margin:0" onsubmit="return confirm('Delete this entry?')"><button class="danger">&#10005;</button></form></td>
          </tr>`;
        }).join("")}
      </table>`}
      <details><summary>+ Add to schedule</summary>
        <form method="post" action="/channels/${c.id}/schedule" enctype="multipart/form-data" class="row" style="align-items:flex-end">
          <div><label>Date</label><input type="date" name="planned_date" required style="margin:6px 0 0"></div>
          <div style="flex:1;min-width:180px"><label>Title</label><input name="title" placeholder="e.g. Wheels on the Bus" required style="margin:6px 0 0"></div>
          <div style="flex:1;min-width:140px"><label>Note (optional)</label><input name="note" style="margin:6px 0 0"></div>
          <div style="flex:1;min-width:180px"><label>Files (PDF, audio, anything)</label><input type="file" name="files" multiple style="margin:6px 0 0"></div>
          <button>Add</button>
        </form>
        <form method="post" action="/channels/${c.id}/schedule/bulk">
          <label>Bulk add &mdash; one per line: <code>YYYY-MM-DD | Title | optional note</code></label>
          <textarea name="lines" placeholder="2026-11-20 | Wheels on the Bus
2026-11-24 | ABC Song | with Didi"></textarea>
          <button class="sec">Add all</button>
        </form>
      </details>
    </div>

    <h2>&#128230; Stored items</h2>
    <div class="tabs">
      <a href="/channels/${c.id}" class="${!active ? "on" : ""}">All</a>
      ${allCats.map(cat => `<a href="/channels/${c.id}?cat=${encodeURIComponent(cat)}" class="${active === cat ? "on" : ""}">${esc(cat)}</a>`).join("")}
    </div>

    <form method="get" action="/channels/${c.id}" class="row" style="margin-top:8px">
      ${active ? `<input type="hidden" name="cat" value="${esc(active)}">` : ""}
      <input name="q" value="${esc(q)}" placeholder="Search titles & text…" style="max-width:320px;margin:0">
      <select name="sort" style="max-width:160px;margin:0">
        <option value="new" ${req.query.sort === "old" || req.query.sort === "title" || req.query.sort === "cat" ? "" : "selected"}>Newest first</option>
        <option value="old" ${req.query.sort === "old" ? "selected" : ""}>Oldest first</option>
        <option value="title" ${req.query.sort === "title" ? "selected" : ""}>Title A&ndash;Z</option>
        <option value="cat" ${req.query.sort === "cat" ? "selected" : ""}>Category</option>
      </select>
      <button class="sec">Apply</button>
    </form>

    <details><summary>+ Add item (text, files, or both)</summary>
      <div class="card" style="max-width:560px">
        <form method="post" action="/channels/${c.id}/items" enctype="multipart/form-data">
          <label>Category</label>
          <input name="category" list="cats" value="${esc(active)}" placeholder="Characters / Scripts / Sounds / …" required>
          <datalist id="cats">${DEFAULT_CATS.map(d => `<option value="${d}">`).join("")}</datalist>
          <label>Title</label><input name="title" placeholder="e.g. Baby Doo character sheet" required>
          <label>Text (script, lyrics, notes — optional)</label><textarea name="body"></textarea>
          <label>Files (optional, up to 10 — PDF, audio, video, images, anything; stored exactly as uploaded)</label>
          <input type="file" name="files" multiple>
          <button>Save item</button>
        </form>
      </div>
    </details>

    ${items.length === 0 ? `<p class="mut" style="margin-top:20px">Nothing here yet.</p>` : ""}
    ${items.map(it => {
      const fls = fileRows.all(it.id);
      return `<div class="item">
        <div class="row" style="justify-content:space-between">
          <h3>${esc(it.title)} <span class="badge">${esc(it.category)}</span></h3>
          <form method="post" action="/items/${it.id}/delete" onsubmit="return confirm('Delete this item?')"><button class="danger">Delete</button></form>
        </div>
        <div class="mut">${esc(it.created_at)} · ${esc(it.created_by || "")}</div>
        ${it.body ? `<div class="body">${esc(it.body)}</div>` : ""}
        ${fls.map(f => `<div class="file">📎 <a href="/files/${f.id}/download">${esc(f.orig_name)}</a> <span class="mut">${fmtSize(f.size)}</span></div>`).join("")}
      </div>`;
    }).join("")}
  </div>`, u));
});

app.post("/channels/:id/items", requireAuth, upload.array("files", 10), (req, res) => {
  const u = me(req);
  const c = db.prepare("SELECT id FROM channels WHERE id=?").get(req.params.id);
  if (!c) return res.redirect("/dashboard");
  const { category, title, body } = req.body;
  if (!category || !title) return res.redirect("/channels/" + c.id);
  const r = db.prepare("INSERT INTO items(channel_id,category,title,body,created_by) VALUES(?,?,?,?,?)")
    .run(c.id, category.trim(), title.trim(), body || "", u.name);
  for (const f of req.files || []) {
    db.prepare("INSERT INTO files(item_id,orig_name,stored_name,size,mime) VALUES(?,?,?,?,?)")
      .run(r.lastInsertRowid, f.originalname, f.filename, f.size, f.mimetype);
  }
  res.redirect(`/channels/${c.id}?cat=${encodeURIComponent(category.trim())}`);
});

app.post("/items/:id/delete", requireAuth, (req, res) => {
  const it = db.prepare("SELECT * FROM items WHERE id=?").get(req.params.id);
  if (!it) return res.redirect("/dashboard");
  const fls = db.prepare("SELECT stored_name FROM files WHERE item_id=?").all(it.id);
  db.prepare("DELETE FROM items WHERE id=?").run(it.id);
  for (const f of fls) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f.stored_name)); } catch {} }
  res.redirect("/channels/" + it.channel_id);
});

// ---------- schedule ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
app.post("/channels/:id/schedule", requireAuth, upload.array("files", 10), (req, res) => {
  const c = db.prepare("SELECT id FROM channels WHERE id=?").get(req.params.id);
  const { planned_date, title, note } = req.body;
  if (c && title && DATE_RE.test(planned_date || "")) {
    const r = db.prepare("INSERT INTO schedule(channel_id,title,planned_date,note) VALUES(?,?,?,?)")
      .run(c.id, title.trim(), planned_date, (note || "").trim());
    for (const f of req.files || []) {
      db.prepare("INSERT INTO sched_files(schedule_id,orig_name,stored_name,size,mime) VALUES(?,?,?,?,?)")
        .run(r.lastInsertRowid, f.originalname, f.filename, f.size, f.mimetype);
    }
  }
  res.redirect("/channels/" + req.params.id);
});
app.post("/channels/:id/schedule/bulk", requireAuth, (req, res) => {
  const c = db.prepare("SELECT id FROM channels WHERE id=?").get(req.params.id);
  if (c) {
    const ins = db.prepare("INSERT INTO schedule(channel_id,title,planned_date,note) VALUES(?,?,?,?)");
    for (const line of (req.body.lines || "").split(/\r?\n/)) {
      const parts = line.split("|").map(p => p.trim());
      if (parts.length >= 2 && DATE_RE.test(parts[0]) && parts[1]) ins.run(c.id, parts[1], parts[0], parts[2] || "");
    }
  }
  res.redirect("/channels/" + req.params.id);
});
app.post("/schedule/:id/done", requireAuth, (req, res) => {
  const sc = db.prepare("SELECT * FROM schedule WHERE id=?").get(req.params.id);
  if (sc) db.prepare("UPDATE schedule SET status=? WHERE id=?").run(sc.status === "done" ? "planned" : "done", sc.id);
  res.redirect("/channels/" + (sc ? sc.channel_id : ""));
});
app.post("/schedule/:id/delete", requireAuth, (req, res) => {
  const sc = db.prepare("SELECT channel_id FROM schedule WHERE id=?").get(req.params.id);
  if (sc) {
    const fls = db.prepare("SELECT stored_name FROM sched_files WHERE schedule_id=?").all(req.params.id);
    db.prepare("DELETE FROM schedule WHERE id=?").run(req.params.id);
    for (const f of fls) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f.stored_name)); } catch {} }
  }
  res.redirect("/channels/" + (sc ? sc.channel_id : ""));
});

app.get("/sfiles/:id/download", requireAuth, (req, res) => {
  const f = db.prepare("SELECT * FROM sched_files WHERE id=?").get(req.params.id);
  if (!f) return res.status(404).send("Not found");
  const p = path.join(UPLOAD_DIR, path.basename(f.stored_name));
  if (!fs.existsSync(p)) return res.status(404).send("File missing on disk");
  res.download(p, f.orig_name);
});

// ---------- original-quality download ----------
app.get("/files/:id/download", requireAuth, (req, res) => {
  const f = db.prepare("SELECT * FROM files WHERE id=?").get(req.params.id);
  if (!f) return res.status(404).send("Not found");
  const p = path.join(UPLOAD_DIR, path.basename(f.stored_name));
  if (!fs.existsSync(p)) return res.status(404).send("File missing on disk");
  res.download(p, f.orig_name); // streams the exact original bytes
});

// ---------- users (owner) ----------
app.get("/users", requireAuth, requireOwner, (req, res) => {
  const u = me(req);
  const users = db.prepare("SELECT id,name,email,role,created_at FROM users ORDER BY id").all();
  res.send(page("Users", `
  <div class="wrap">
    <h1>Users</h1>
    <p class="mut">People who can log in and manage channel data. Only you (owner) can add or remove users.</p>
    <div class="card">
      <table>
        <tr><th>Name</th><th>Email</th><th>Role</th><th>Since</th><th></th></tr>
        ${users.map(x => `<tr>
          <td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${esc(x.role)}</td><td class="mut">${esc(x.created_at)}</td>
          <td>${x.role !== "owner" ? `<form method="post" action="/users/${x.id}/delete" onsubmit="return confirm('Remove ${esc(x.name)}?')"><button class="danger">Remove</button></form>` : ""}</td>
        </tr>`).join("")}
      </table>
    </div>
    <details><summary>+ Invite a user</summary>
      <div class="card" style="max-width:460px">
        <form method="post" action="/users">
          <label>Full name</label><input name="name" required>
          <label>Email</label><input name="email" type="email" required>
          <label>Password (share it with them)</label><input name="password" minlength="8" required>
          <button>Create user</button>
        </form>
      </div>
    </details>
  </div>`, u));
});

app.post("/users", requireAuth, requireOwner, (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 8) return res.redirect("/users");
  try {
    db.prepare("INSERT INTO users(name,email,pass_hash,role) VALUES(?,?,?,'member')")
      .run(name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(password, 10));
  } catch {}
  res.redirect("/users");
});

app.post("/users/:id/delete", requireAuth, requireOwner, (req, res) => {
  db.prepare("DELETE FROM users WHERE id=? AND role!='owner'").run(req.params.id);
  res.redirect("/users");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("YT Manager running on port " + PORT));
