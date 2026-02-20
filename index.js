const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

let pool;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

app.get("/", (req, res) => res.send("Job Aggregator is running 🚀"));

app.get("/api/health", async (req, res) => {
  const envCheck = {
    DB_HOST: process.env.DB_HOST ? "set" : "missing",
    DB_PORT: process.env.DB_PORT ? "set" : "missing",
    DB_NAME: process.env.DB_NAME ? "set" : "missing",
    DB_USER: process.env.DB_USER ? "set" : "missing",
    DB_PASSWORD: process.env.DB_PASSWORD ? "set" : "missing",
  };

  try {
    const p = getPool();
    await p.query("SELECT 1");
    res.json({ ok: true, db: "connected", env: envCheck });
  } catch (e) {
    res.json({ ok: true, db: "not connected", env: envCheck, error: e.message });
  }
});

app.get("/api/jobs", async (req, res) => {
  try {
    const [rows] = await getPool().query(
      `SELECT id,title,organization,location,country,date_posted,url
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
app.listen(PORT, () => console.log("Server running on port", PORT));
