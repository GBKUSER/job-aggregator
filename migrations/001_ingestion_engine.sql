-- Central ingestion engine for MySQL 8+

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS content_hash CHAR(64) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_source_external ON jobs (source, external_id);

CREATE TABLE IF NOT EXISTS ingestion_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  adapter_type VARCHAR(100) NOT NULL,
  base_url VARCHAR(500) NULL,
  config JSON NULL,
  poll_interval_minutes INT NOT NULL DEFAULT 60,
  priority INT NOT NULL DEFAULT 50,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  next_run_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at DATETIME NULL,
  last_success_at DATETIME NULL,
  lock_until DATETIME NULL,
  failure_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ingestion_sources_code (source_code),
  KEY idx_ingestion_due (enabled, next_run_at, lock_until, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crawl_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id BIGINT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  status ENUM('running','success','failed') NOT NULL,
  jobs_discovered INT NULL,
  jobs_new INT NULL,
  jobs_updated INT NULL,
  jobs_unchanged INT NULL,
  jobs_missing INT NULL,
  error_message TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_crawl_source_started (source_id, started_at),
  CONSTRAINT fk_crawl_source FOREIGN KEY (source_id) REFERENCES ingestion_sources(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS source_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id BIGINT UNSIGNED NOT NULL,
  source_job_id VARCHAR(255) NOT NULL,
  canonical_url VARCHAR(1000) NULL,
  apply_url VARCHAR(1000) NULL,
  raw_summary JSON NULL,
  raw_detail JSON NULL,
  source_hash CHAR(64) NULL,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  last_detail_fetched_at DATETIME NULL,
  last_seen_crawl_id BIGINT UNSIGNED NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  missing_streak INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_source_jobs_identity (source_id, source_job_id),
  KEY idx_source_jobs_reconcile (source_id, active, missing_streak),
  CONSTRAINT fk_source_jobs_source FOREIGN KEY (source_id) REFERENCES ingestion_sources(id),
  CONSTRAINT fk_source_jobs_crawl FOREIGN KEY (last_seen_crawl_id) REFERENCES crawl_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO ingestion_sources
  (source_code, name, adapter_type, base_url, poll_interval_minutes, priority, enabled, next_run_at)
VALUES
  ('un_careers', 'UN Careers', 'un_careers', 'https://careers.un.org', 15, 100, 1, UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  name=VALUES(name), adapter_type=VALUES(adapter_type), base_url=VALUES(base_url),
  poll_interval_minutes=VALUES(poll_interval_minutes), priority=VALUES(priority), enabled=VALUES(enabled);
