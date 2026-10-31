-- Joining a team: short invite codes (as well as links), invites without an email, and requests to join.
ALTER TABLE invites ADD COLUMN code_hash TEXT;                    -- sha256 of the normalised code; the code itself is never stored
CREATE UNIQUE INDEX ux_invites_code ON invites(code_hash) WHERE code_hash IS NOT NULL;
ALTER TABLE invites ALTER COLUMN email SET DEFAULT '';             -- '' = anyone holding the link or code may use it (once)

CREATE TABLE join_requests (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,  -- NULL when nobody matched: the requester sees the same "waiting" either way
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact TEXT NOT NULL DEFAULT '',                               -- the owner's phone or email, as the requester typed it
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  role TEXT CHECK (role IN ('owner', 'manager', 'staff')),        -- set by the owner on approval
  decided_by TEXT, decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ux_join_pending ON join_requests(business_id, user_id) WHERE status = 'pending' AND business_id IS NOT NULL;
CREATE INDEX idx_join_user ON join_requests(user_id, created_at);
