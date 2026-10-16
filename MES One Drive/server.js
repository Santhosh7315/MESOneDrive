const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");

const app = express();
const PORT = process.env.X_ZOHO_CATALYST_PORT || process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
const FILES_DIR = path.resolve(process.env.FILES_DIR || path.join(DATA_DIR, "uploads"));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, "users.db"));
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "Admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (IS_PRODUCTION && (!SESSION_SECRET || SESSION_SECRET.length < 32 || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12)) {
    throw new Error("Production requires SESSION_SECRET (32+ chars) and ADMIN_PASSWORD (12+ chars).");
}
if (!IS_PRODUCTION && !process.env.ADMIN_PASSWORD) {
    console.warn("Using development credentials. Set ADMIN_PASSWORD before hosting (default: Admin@123).");
}
const signingSecret = SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const adminPassword = ADMIN_PASSWORD || "Admin@123";

for (const dir of new Set([DATA_DIR, FILES_DIR, path.dirname(DB_PATH)])) fs.mkdirSync(dir, { recursive: true });
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT)");
    db.get("SELECT id FROM users WHERE username = ?", [ADMIN_USERNAME], (err, row) => {
        if (err) return console.error("Unable to inspect admin account:", err.message);
        if (!row) {
            const hash = hashPassword(adminPassword);
            db.run("INSERT INTO users(username, password) VALUES(?, ?)", [ADMIN_USERNAME, hash]);
        }
    });
});

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), { index: "login.html" }));

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
function verifyPassword(password, stored) {
    if (!stored || !stored.includes(":")) return false;
    const [salt, expectedHex] = stored.split(":");
    const expected = Buffer.from(expectedHex, "hex");
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function issueSession(username) {
    const payload = Buffer.from(JSON.stringify({ username, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })).toString("base64url");
    const signature = crypto.createHmac("sha256", signingSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
}
function getSession(req) {
    const token = (req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith("session="))?.slice(8);
    if (!token) return null;
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", signingSecret).update(payload).digest();
    let actual;
    try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    try {
        const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return session.exp > Math.floor(Date.now() / 1000) ? session : null;
    } catch { return null; }
}
function requireAuth(req, res, next) {
    if (!getSession(req)) return res.status(401).json({ success: false, message: "Authentication required" });
    next();
}
function safeFilePath(name) {
    const base = path.basename(String(name || ""));
    if (!base || base !== name || base === "." || base === "..") return null;
    return path.join(FILES_DIR, base);
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) => cb(null, path.basename(file.originalname).replace(/[\\/\0]/g, "_") || "upload"),
});
const upload = multer({ storage, limits: { fileSize: Number(process.env.MAX_FILE_SIZE_MB || 512) * 1024 * 1024, files: 20 } });

app.post("/login", (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ success: false });
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (err) return res.status(500).json({ success: false });
        let valid = row && verifyPassword(password, row.password);
        // Upgrade the legacy plaintext password format from the original app on successful login.
        if (row && !valid && row.password === password) {
            valid = true;
            db.run("UPDATE users SET password = ? WHERE id = ?", [hashPassword(password), row.id]);
        }
        if (!valid) return res.status(401).json({ success: false, message: "Invalid username or password" });
        const cookie = `session=${issueSession(row.username)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${IS_PRODUCTION ? "; Secure" : ""}`;
        res.setHeader("Set-Cookie", cookie);
        res.json({ success: true });
    });
});
app.post("/logout", (_req, res) => res.setHeader("Set-Cookie", `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${IS_PRODUCTION ? "; Secure" : ""}`).json({ success: true }));
app.get("/files", requireAuth, (_req, res) => {
    fs.readdir(FILES_DIR, { withFileTypes: true }, (err, entries) => {
        if (err) return res.status(500).json({ message: "Unable to list files" });
        const files = entries.filter(e => e.isFile()).map(e => {
            const stats = fs.statSync(path.join(FILES_DIR, e.name));
            return { name: e.name, size: `${(stats.size / 1024).toFixed(2)} KB`, date: stats.mtime.toLocaleDateString(), type: "File" };
        });
        res.json(files);
    });
});
app.post("/upload", requireAuth, (req, res, next) => upload.array("files", 20)(req, res, err => {
    if (err) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: err.message });
    res.json({ message: "File(s) uploaded successfully" });
}));
app.get("/download/:filename", requireAuth, (req, res) => {
    const filePath = safeFilePath(req.params.filename);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return res.status(404).send("File not found");
    res.download(filePath);
});
app.post("/download", requireAuth, (req, res) => {
    const files = req.body?.files;
    if (!Array.isArray(files) || files.length === 0) return res.status(400).send("No files selected");
    const existing = files.map(safeFilePath).filter(p => p && fs.existsSync(p) && fs.statSync(p).isFile());
    if (!existing.length) return res.status(404).send("No downloadable files found");
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", err => { if (!res.headersSent) res.status(500); res.end(); console.error("Archive error:", err.message); });
    res.attachment("files.zip");
    archive.pipe(res);
    existing.forEach(filePath => archive.file(filePath, { name: path.basename(filePath) }));
    archive.finalize();
});
app.delete("/delete/:filename", requireAuth, (req, res) => {
    const filePath = safeFilePath(req.params.filename);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return res.status(404).json({ success: false, message: "File not found" });
    fs.unlink(filePath, err => err ? res.status(500).json({ success: false, message: "Failed to delete file" }) : res.json({ success: true, message: "File deleted successfully" }));
});
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, HOST, () => console.log(`File portal listening on ${HOST}:${PORT}`));

process.on("SIGTERM", () => db.close(() => process.exit(0)));
process.on("SIGINT", () => db.close(() => process.exit(0)));
