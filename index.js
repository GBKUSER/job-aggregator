const express = require('express');
const { getPool } = require('./src/db');
const { runDueSources, runSource } = require('./src/ingestion');

const app = express();
app.use(express.json({ limit: '2mb' }));

const ADMIN_KEY = process.env.ADMIN_KEY || '';
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

app.get('/', (req, res) => res.send('Job Aggregator is running 🚀'));

app.get('/api/health', async (req, res) => {
  try {
    const p = getPool();
    await p.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'not connected', error: e.message });
  }
});

app.get('/api/jobs', async (req, res) => {
  try {
    const p = getPool();
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

// Backwards-compatible endpoint used by existing n8n workflows.
app.post('/api/admin/upsert-job', requireAdmin, async (req, res) => {
  try {
    const job = req.body;
    for (const f of ['source', 'external_id', 'title', 'url']) {
      if (!job[f]) return res.status(400).json({ ok: false, error: `Missing ${f}` });
    }
    const p = getPool();
    const sql = `
      INSERT INTO jobs
      (source, external_id, title, organization, location, country,
       date_posted, deadline, url, apply_url, description, raw_json,
       is_active, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE
        title=VALUES(title), organization=VALUES(organization), location=VALUES(location),
        country=VALUES(country), date_posted=VALUES(date_posted), deadline=VALUES(deadline),
        url=VALUES(url), apply_url=VALUES(apply_url), description=VALUES(description),
        raw_json=VALUES(raw_json), is_active=1, last_seen_at=UTC_TIMESTAMP(), updated_at=UTC_TIMESTAMP()`;
    const [result] = await p.query(sql, [
      job.source, job.external_id, job.title, job.organization || null, job.location || null,
      job.country || null, job.date_posted || null, job.deadline || null, job.url,
      job.apply_url || null, job.description || null,
      job.raw_json ? JSON.stringify(job.raw_json) : null,
    ]);
    res.json({ ok: true, affectedRows: result.affectedRows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// n8n master scheduler calls this every 10 minutes.
app.post('/api/admin/run-due-sources', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.body?.limit || 5), 1), 20);
    const results = await runDueSources(limit);
    res.json({ ok: true, claimed: results.length, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Manual source run for debugging/admin without changing n8n.
app.post('/api/admin/run-source/:sourceCode', requireAdmin, async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query('SELECT * FROM ingestion_sources WHERE source_code = ? AND enabled = 1 LIMIT 1', [req.params.sourceCode]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Source not found or disabled' });
    const result = await runSource(rows[0]);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/admin/source-health', requireAdmin, async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query(
      `SELECT s.source_code, s.name, s.adapter_type, s.poll_interval_minutes, s.enabled,
              s.last_attempt_at, s.last_success_at, s.next_run_at, s.failure_count,
              r.status AS last_run_status, r.jobs_discovered, r.jobs_new, r.jobs_updated,
              r.jobs_unchanged, r.error_message
       FROM ingestion_sources s
       LEFT JOIN crawl_runs r ON r.id = (
         SELECT cr.id FROM crawl_runs cr WHERE cr.source_id = s.id ORDER BY cr.id DESC LIMIT 1
       )
       ORDER BY s.priority DESC, s.name ASC`
    );
    res.json({ ok: true, sources: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Listening on', PORT));
