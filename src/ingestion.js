const crypto = require('crypto');
const { getPool } = require('./db');
const { fetchUnCareers } = require('./adapters/unCareers');

const adapters = {
  un_careers: fetchUnCareers,
};

function hashJob(job) {
  const stable = [
    job.source,
    job.external_id,
    job.title,
    job.organization || '',
    job.location || '',
    job.country || '',
    job.date_posted || '',
    job.deadline || '',
    job.url || '',
    job.apply_url || '',
    job.description || '',
  ].join('|');
  return crypto.createHash('sha256').update(stable).digest('hex');
}

async function claimDueSources(limit = 5) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT *
       FROM ingestion_sources
       WHERE enabled = 1
         AND next_run_at <= UTC_TIMESTAMP()
         AND (lock_until IS NULL OR lock_until < UTC_TIMESTAMP())
       ORDER BY priority DESC, next_run_at ASC
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [Number(limit)]
    );

    if (rows.length) {
      const ids = rows.map(r => r.id);
      await conn.query(
        `UPDATE ingestion_sources
         SET lock_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE),
             last_attempt_at = UTC_TIMESTAMP()
         WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
    }
    await conn.commit();
    return rows;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function runSource(source) {
  const pool = getPool();
  const adapter = adapters[source.adapter_type];
  if (!adapter) throw new Error(`Unsupported adapter_type: ${source.adapter_type}`);

  const [runResult] = await pool.query(
    `INSERT INTO crawl_runs (source_id, started_at, status)
     VALUES (?, UTC_TIMESTAMP(), 'running')`,
    [source.id]
  );
  const runId = runResult.insertId;

  try {
    const jobs = await adapter(source);

    const [prevRows] = await pool.query(
      `SELECT jobs_discovered
       FROM crawl_runs
       WHERE source_id = ? AND status = 'success' AND id <> ?
       ORDER BY id DESC LIMIT 1`,
      [source.id, runId]
    );
    const prev = prevRows[0];

    if (prev?.jobs_discovered >= 50 && jobs.length < Math.floor(prev.jobs_discovered * 0.3)) {
      throw new Error(`Suspicious job-count drop: ${prev.jobs_discovered} -> ${jobs.length}; reconciliation blocked`);
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const job of jobs) {
      const contentHash = hashJob(job);
      const [existingRows] = await pool.query(
        `SELECT id, content_hash FROM jobs WHERE source = ? AND external_id = ? LIMIT 1`,
        [job.source, job.external_id]
      );
      const existing = existingRows[0];

      await pool.query(
        `INSERT INTO jobs
          (source, external_id, title, organization, location, country,
           date_posted, deadline, url, apply_url, description, raw_json,
           content_hash, is_active, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           title=VALUES(title), organization=VALUES(organization), location=VALUES(location),
           country=VALUES(country), date_posted=VALUES(date_posted), deadline=VALUES(deadline),
           url=VALUES(url), apply_url=VALUES(apply_url), description=COALESCE(VALUES(description), description),
           raw_json=VALUES(raw_json), content_hash=VALUES(content_hash), is_active=1,
           last_seen_at=UTC_TIMESTAMP(),
           updated_at=IF(NOT (content_hash <=> VALUES(content_hash)), UTC_TIMESTAMP(), updated_at)`,
        [
          job.source, job.external_id, job.title, job.organization, job.location, job.country,
          job.date_posted, job.deadline, job.url, job.apply_url, job.description,
          JSON.stringify(job.raw_json || {}), contentHash,
        ]
      );

      await pool.query(
        `INSERT INTO source_jobs
          (source_id, source_job_id, canonical_url, apply_url, source_hash,
           first_seen_at, last_seen_at, last_seen_crawl_id, active, missing_streak, raw_summary)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, 1, 0, ?)
         ON DUPLICATE KEY UPDATE
           canonical_url=VALUES(canonical_url), apply_url=VALUES(apply_url), source_hash=VALUES(source_hash),
           last_seen_at=UTC_TIMESTAMP(), last_seen_crawl_id=VALUES(last_seen_crawl_id),
           active=1, missing_streak=0, raw_summary=VALUES(raw_summary)`,
        [source.id, job.external_id, job.url, job.apply_url, contentHash, runId, JSON.stringify(job.raw_json || {})]
      );

      if (!existing) created += 1;
      else if (existing.content_hash !== contentHash) updated += 1;
      else unchanged += 1;
    }

    await pool.query(
      `UPDATE source_jobs
       SET missing_streak = missing_streak + 1
       WHERE source_id = ? AND active = 1
         AND (last_seen_crawl_id IS NULL OR last_seen_crawl_id <> ?)`,
      [source.id, runId]
    );

    await pool.query(
      `UPDATE source_jobs SET active = 0
       WHERE source_id = ? AND active = 1 AND missing_streak >= 3`,
      [source.id]
    );

    await pool.query(
      `UPDATE jobs j
       JOIN source_jobs sj ON sj.source_job_id = j.external_id
       SET j.is_active = sj.active
       WHERE sj.source_id = ? AND j.source = ?`,
      [source.id, source.source_code]
    );

    await pool.query(
      `UPDATE crawl_runs
       SET finished_at=UTC_TIMESTAMP(), status='success', jobs_discovered=?,
           jobs_new=?, jobs_updated=?, jobs_unchanged=?
       WHERE id=?`,
      [jobs.length, created, updated, unchanged, runId]
    );

    await pool.query(
      `UPDATE ingestion_sources
       SET last_success_at=UTC_TIMESTAMP(), failure_count=0, lock_until=NULL,
           next_run_at=DATE_ADD(UTC_TIMESTAMP(), INTERVAL poll_interval_minutes MINUTE)
       WHERE id=?`,
      [source.id]
    );

    return { source: source.source_code, run_id: runId, discovered: jobs.length, new: created, updated, unchanged };
  } catch (err) {
    await pool.query(
      `UPDATE crawl_runs SET finished_at=UTC_TIMESTAMP(), status='failed', error_message=? WHERE id=?`,
      [String(err.message).slice(0, 2000), runId]
    );
    await pool.query(
      `UPDATE ingestion_sources
       SET failure_count=failure_count+1, lock_until=NULL,
           next_run_at=DATE_ADD(UTC_TIMESTAMP(), INTERVAL LEAST(60, GREATEST(5, poll_interval_minutes)) MINUTE)
       WHERE id=?`,
      [source.id]
    );
    throw err;
  }
}

async function runDueSources(limit = 5) {
  const claimed = await claimDueSources(limit);
  const results = [];
  for (const source of claimed) {
    try {
      results.push({ ok: true, ...(await runSource(source)) });
    } catch (err) {
      results.push({ ok: false, source: source.source_code, error: err.message });
    }
  }
  return results;
}

module.exports = { claimDueSources, runSource, runDueSources, hashJob };
