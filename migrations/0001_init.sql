CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  nickname TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  condition_key TEXT NOT NULL,
  site_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  verdict TEXT NOT NULL CHECK (verdict IN ('present','absent','unclear')),
  note TEXT,
  photo_key TEXT,
  lat REAL,
  lng REAL,
  accuracy_m REAL,
  created_at TEXT NOT NULL,
  UNIQUE (device_id, condition_key)
);

CREATE INDEX idx_submissions_condition ON submissions (condition_key);
CREATE INDEX idx_submissions_site ON submissions (site_id);
