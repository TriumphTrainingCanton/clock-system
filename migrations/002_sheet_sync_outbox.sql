-- Durable background delivery from Neon to the legacy Google Sheet.
-- The encrypted payload may contain a PIN, so the encryption key must remain
-- a Cloudflare secret and must never be committed or logged.

CREATE TABLE IF NOT EXISTS sheet_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_key varchar(180) NOT NULL UNIQUE,
  action varchar(80) NOT NULL,
  encrypted_payload text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'synced')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  synced_at timestamptz,
  last_error varchar(240),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sheet_sync_outbox_ready_idx
  ON sheet_sync_outbox (next_attempt_at, created_at)
  WHERE status = 'pending';

