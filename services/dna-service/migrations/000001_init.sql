-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_input JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE generation_jobs (
  job_id TEXT PRIMARY KEY,
  family TEXT NOT NULL CHECK (family IN ('universe', 'nature')),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  dna_version_id UUID,
  world_id UUID,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE dna_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_job_id TEXT NOT NULL UNIQUE REFERENCES generation_jobs(job_id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  profile_dna JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(profile_id, version_number)
);

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_dna_version_fk
  FOREIGN KEY (dna_version_id) REFERENCES dna_versions(id) ON DELETE RESTRICT;

CREATE TABLE ai_generation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL REFERENCES generation_jobs(job_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  task TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  request_json JSONB,
  response_json JSONB,
  usage_json JSONB,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inbox_messages (
  message_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  job_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE outbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX idx_generation_jobs_status_updated_at ON generation_jobs(status, updated_at);
CREATE INDEX idx_dna_versions_profile_created_at ON dna_versions(profile_id, created_at DESC);
CREATE INDEX idx_ai_generation_attempts_job_created_at ON ai_generation_attempts(job_id, created_at);
CREATE INDEX idx_outbox_messages_pending ON outbox_messages(created_at) WHERE published_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS outbox_messages;
DROP TABLE IF EXISTS inbox_messages;
DROP TABLE IF EXISTS ai_generation_attempts;
ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_dna_version_fk;
DROP TABLE IF EXISTS dna_versions;
DROP TABLE IF EXISTS generation_jobs;
DROP TABLE IF EXISTS profiles;
