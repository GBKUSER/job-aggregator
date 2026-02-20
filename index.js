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


// Simple admin key (set in Hostinger env vars)
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// Insert/update (upsert) one job
app.post("/api/admin/upsert-job", async (req, res) => {
  try {
    // Basic protection
    const key = req.headers["x-admin-key"];
    if (!ADMIN_KEY || key !== ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const job = req.body;

    // required fields for dedupe + minimum record
    const required = ["source", "external_id", "title", "url"];
    for (const f of required) {
      if (!job[f]) return res.status(400).json({ ok: false, error: `Missing ${f}` });
    }

    const p = await getPool();

    const sql = `
      INSERT INTO jobs
      (source, external_id, title, organization, location, country,
       date_posted, deadline, url, apply_url, description, raw_json,
       is_active, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
      ON DUPLICATE KEY UPDATE
        title=VALUES(title),
        organization=VALUES(organization),
        location=VALUES(location),
        country=VALUES(country),
        date_posted=VALUES(date_posted),
        deadline=VALUES(deadline),
        url=VALUES(url),
        apply_url=VALUES(apply_url),
        description=VALUES(description),
        raw_json=VALUES(raw_json),
        is_active=1,
        last_seen_at=NOW(),
        updated_at=NOW()
    `;

    const params = [
      job.source,
      job.external_id,
      job.title,
      job.organization || null,
      job.location || null,
      job.country || null,
      job.date_posted || null,
      job.deadline || null,
      job.url,
      job.apply_url || null,
      job.description || null,
      job.raw_json ? JSON.stringify(job.raw_json) : null
    ];

    const [result] = await p.query(sql, params);

    res.json({ ok: true, affectedRows: result.affectedRows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


const PORT = process.env.PORT || 3000;









app.get("/admin/test", (req, res) => {
  res.type("html").send(`
    <h2>Insert test job</h2>
    <p>This will call <code>/api/admin/upsert-job</code></p>

    <input id="key" placeholder="ADMIN_KEY" style="width:320px;padding:8px" />
    <button id="btn" style="padding:8px 12px;margin-left:8px">Insert</button>

    <pre id="out" style="margin-top:16px;background:#f5f5f5;padding:12px"></pre>

    <script>
      const btn = document.getElementById('btn');
      const out = document.getElementById('out');

      btn.onclick = async () => {
        out.textContent = "Sending...";
        const key = document.getElementById('key').value;

        const payload = {
          source: "test",
          external_id: "test-001",
          title: "Test Job Insert",
          organization: "Test Org",
          location: "Remote",
          country: "Global",
          date_posted: "2026-02-20 00:00:00",
          url: "https://example.com/job/test-001",
          apply_url: "https://example.com/apply/test-001",
          description: "This is a test insert from browser",
          raw_json: { hello: "world" }
        };

        const r = await fetch("/api/admin/upsert-job", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": key
          },
          body: JSON.stringify(payload)
        });

        const text = await r.text();
        out.textContent = text;
      };
    </script>
  `);
});







app.listen(PORT, "0.0.0.0", () => console.log("Listening on", PORT));
