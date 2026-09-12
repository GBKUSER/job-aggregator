# Central ingestion engine setup

## 1. Database migration

Run `migrations/001_ingestion_engine.sql` once against the same MySQL database used by the service.

The migration:
- adds `content_hash` to `jobs` if missing;
- ensures `(source, external_id)` is unique;
- creates `ingestion_sources`, `crawl_runs`, and `source_jobs`;
- registers `un_careers` with a 15-minute polling interval.

## 2. Application deployment

Deploy this branch after running the migration and install dependencies with:

```bash
npm install
npm run check
npm start
```

Node.js 18+ is required because the UN Careers adapter uses the built-in `fetch` API.

Existing environment variables remain valid:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `ADMIN_KEY`
- `PORT`

Optional:

- `DB_POOL_SIZE` (default `8`)

## 3. n8n master scheduler

Create one n8n workflow named `00_MASTER_SCHEDULER`.

### Schedule Trigger
Run every 10 minutes.

### HTTP Request node

- Method: `POST`
- URL: `https://<job-aggregator-host>/api/admin/run-due-sources`
- Header: `x-admin-key: <ADMIN_KEY>`
- JSON body:

```json
{
  "limit": 5
}
```

The service itself decides which registered sources are due. Do not create one Schedule Trigger per organization.

## 4. Manual verification

Health:

```bash
curl https://<job-aggregator-host>/api/health
```

Force UN Careers once:

```bash
curl -X POST \
  -H "x-admin-key: <ADMIN_KEY>" \
  https://<job-aggregator-host>/api/admin/run-source/un_careers
```

Source health:

```bash
curl \
  -H "x-admin-key: <ADMIN_KEY>" \
  https://<job-aggregator-host>/api/admin/source-health
```

Expected source code for the first adapter: `un_careers`.

## 5. Safety behavior

The engine will not reconcile/close jobs when an adapter fails or returns zero results.

If a previously successful source had at least 50 jobs and suddenly returns fewer than 30% of the prior count, the run is marked failed and reconciliation is blocked.

A source job is only marked inactive after it is absent from three successful complete crawls.

## 6. Adding future adapters

Each adapter should return normalized objects with at least:

```json
{
  "source": "source_code",
  "external_id": "stable-upstream-id",
  "title": "Job title",
  "organization": "Organization",
  "location": "Duty station",
  "country": null,
  "date_posted": "YYYY-MM-DD",
  "deadline": "YYYY-MM-DD",
  "url": "official-detail-url",
  "apply_url": "official-apply-url",
  "description": null,
  "raw_json": {}
}
```

Then register the adapter in `src/ingestion.js` and add one row to `ingestion_sources` rather than adding a new scheduler.
