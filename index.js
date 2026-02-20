const express = require("express");
const app = express();
app.use(express.json());

let pool = null;

async function getPool() {
  if (pool) return pool;

  const mysql = require("mysql2/promise");
  pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 5000,
  });

  return pool;
}

app.get("/", (req, res) => res.send("Job Aggregator is running 🚀"));

app.get("/api/health", async (req, res) => {
  try {
    const p = await getPool();
    await p.query("SELECT 1");
    res.json({ ok: true, db: "connected" });
  } catch (e) {
    res.json({ ok: true, db: "not connected", error: e.message });
  }
});

app.get("/api/jobs", async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query(
      `SELECT id, source, external_id, title, organization, location, country,
              date_posted, deadline, url, apply_url, is_active,
              last_seen_at, created_at, updated_at
       FROM jobs
       ORDER BY COALESCE(date_posted, created_at) DESC
       LIMIT 20`
    );
    res.json({ ok: true, count: rows.length, jobs: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Listening on", PORT));
