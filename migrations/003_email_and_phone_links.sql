-- Email (password reset, verification) and proof that a WhatsApp number belongs to a person.
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;   -- bump to sign a person out everywhere
ALTER TABLE users ADD COLUMN phone_verified_at TIMESTAMPTZ;                -- only verified numbers can forward orders
ALTER TABLE users ADD COLUMN phone_pending TEXT NOT NULL DEFAULT '';       -- number waiting for its LINK code
-- Numbers people already entered are unproven: they must link them again.
UPDATE users SET phone_pending = phone, phone = '' WHERE phone <> '';

CREATE TABLE user_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('reset_password', 'verify_email', 'link_phone')),
  token_hash TEXT NOT NULL UNIQUE,          -- sha256 of the secret; the secret itself is never stored
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_user_tokens_user ON user_tokens(user_id, purpose);
-- A verified number belongs to one person only.
CREATE UNIQUE INDEX ux_users_phone ON users(phone) WHERE phone <> '';

CREATE TABLE outbound_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel TEXT NOT NULL,                    -- 'email' | 'whatsapp'
  recipient TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,                     -- 'sent' | 'failed' | 'skipped'
  provider_id TEXT DEFAULT '',
  error TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
