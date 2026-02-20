const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

// MySQL pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10
});

// Home
app.get("/", (req, res) => {
  res.send("Job Aggregator is running 🚀");
});

// Health with DB check
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "connected" });
  } catch (e) {
    res.json({ ok: true, db: "not connected", error: e.message });
  }
});

// Jobs endpoint
app.get("/api/jobs", async (req, res) => {
  try {
    const [rows] = await pool.query(
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
app.listen(PORT, () => console.log("Server running"));
