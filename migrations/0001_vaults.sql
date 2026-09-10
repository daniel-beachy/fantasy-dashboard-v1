CREATE TABLE vaults (
  id TEXT PRIMARY KEY,
  recovery_hash TEXT NOT NULL UNIQUE,
  ciphertext TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_vault ON sessions(vault_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE dashboard_cache (
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  league_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (vault_id, league_id)
);
CREATE INDEX cache_expiry ON dashboard_cache(expires_at);
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_expiry ON rate_limits(expires_at);
