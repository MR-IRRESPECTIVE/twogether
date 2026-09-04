CREATE TABLE IF NOT EXISTS rooms (
  code VARCHAR(6) PRIMARY KEY,
  host_id VARCHAR(255),
  expected_count INTEGER DEFAULT 2,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  room_code VARCHAR(6) REFERENCES rooms(code) ON DELETE CASCADE,
  stage VARCHAR(20) DEFAULT 'FORMAT_SELECT',
  layout_id VARCHAR(50),
  photo_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS photos (
  id VARCHAR(255) PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  storage_key VARCHAR(500),
  captured_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS strips (
  id VARCHAR(255) PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  owner_id VARCHAR(255),
  owner_name VARCHAR(255),
  storage_key VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
