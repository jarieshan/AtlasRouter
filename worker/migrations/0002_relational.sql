-- Refuse unknown/corrupt snapshot formats instead of discarding their contents.
CREATE TABLE migration_validation (valid INTEGER NOT NULL CHECK (valid = 1));
INSERT INTO migration_validation (valid)
SELECT CASE WHEN
  (key = 'subscriptions' AND json_extract(value, '$.version') = 1
    AND json_type(value, '$.users') = 'array' AND json_type(value, '$.nodes') = 'array'
    AND json_type(value, '$.revision') = 'integer')
  OR (key = 'router-config' AND json_type(value) = 'object'
    AND (json_type(value, '$.profiles') IS NULL OR json_type(value, '$.profiles') = 'null'
      OR (json_type(value, '$.profiles') = 'array' AND json_array_length(value, '$.profiles') > 0)))
  THEN 1 ELSE 0 END FROM configs;

CREATE TABLE store_versions (
  scope TEXT PRIMARY KEY NOT NULL CHECK (scope IN ('subscriptions', 'manual')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  inventory_revision INTEGER NOT NULL DEFAULT 0 CHECK (inventory_revision >= 0),
  write_id TEXT NOT NULL DEFAULT ''
);
INSERT INTO store_versions (scope) VALUES ('subscriptions'), ('manual');

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email)) AND length(email) > 0),
  subscribe_token TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE CHECK (sort_order >= 0)
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL,
  region TEXT NOT NULL,
  ip_type TEXT NOT NULL CHECK (ip_type IN ('IDC', 'ISP', 'WARP')),
  value TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  assignment_count INTEGER NOT NULL DEFAULT 0 CHECK (assignment_count >= 0),
  first_assigned_at TEXT,
  sort_order INTEGER NOT NULL UNIQUE CHECK (sort_order >= 0),
  UNIQUE (id, group_name)
);

CREATE TABLE assignments (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  node_id TEXT NOT NULL,
  owner_order INTEGER NOT NULL CHECK (owner_order >= 0),
  PRIMARY KEY (user_id, group_name),
  UNIQUE (node_id, owner_order),
  FOREIGN KEY (node_id, group_name) REFERENCES nodes(id, group_name) ON DELETE CASCADE
);

CREATE TABLE manual_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  subscribe_token TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL UNIQUE CHECK (sort_order >= 0)
);
CREATE TABLE manual_nodes (
  profile_id TEXT NOT NULL REFERENCES manual_profiles(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (profile_id, sort_order),
  UNIQUE (profile_id, name)
);
CREATE TABLE manual_mitm (
  profile_id TEXT PRIMARY KEY NOT NULL REFERENCES manual_profiles(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  hostname TEXT NOT NULL,
  ca_id TEXT NOT NULL,
  ca_p12 TEXT NOT NULL,
  ca_passphrase TEXT NOT NULL,
  ca_certificate TEXT NOT NULL
);

-- Import the previous D1 format once. Runtime storage contains no JSON snapshots.
UPDATE store_versions SET
  version = COALESCE((SELECT version FROM configs WHERE key = 'subscriptions'), 0),
  inventory_revision = COALESCE((SELECT json_extract(value, '$.revision') FROM configs WHERE key = 'subscriptions'), 0)
WHERE scope = 'subscriptions';
UPDATE store_versions SET version = COALESCE((SELECT version FROM configs WHERE key = 'router-config'), 0)
WHERE scope = 'manual';

INSERT INTO users (id, email, subscribe_token, enabled, created_at, sort_order)
SELECT json_extract(u.value, '$.id'), json_extract(u.value, '$.email'),
  json_extract(u.value, '$.subscribeToken'), json_extract(u.value, '$.enabled'),
  json_extract(u.value, '$.createdAt'), CAST(u.key AS INTEGER)
FROM configs c, json_each(c.value, '$.users') u WHERE c.key = 'subscriptions';

INSERT INTO nodes (id, name, group_name, region, ip_type, value, enabled, assignment_count, first_assigned_at, sort_order)
SELECT json_extract(n.value, '$.id'), json_extract(n.value, '$.name'),
  json_extract(n.value, '$.group'), json_extract(n.value, '$.region'),
  json_extract(n.value, '$.ipType'), json_extract(n.value, '$.value'),
  json_extract(n.value, '$.enabled'), json_extract(n.value, '$.assignmentCount'),
  json_extract(n.value, '$.firstAssignedAt'), CAST(n.key AS INTEGER)
FROM configs c, json_each(c.value, '$.nodes') n WHERE c.key = 'subscriptions';

INSERT INTO assignments (user_id, group_name, node_id, owner_order)
SELECT o.value, json_extract(n.value, '$.group'), json_extract(n.value, '$.id'), CAST(o.key AS INTEGER)
FROM configs c, json_each(c.value, '$.nodes') n, json_each(n.value, '$.ownerIds') o
WHERE c.key = 'subscriptions';

-- Temporary views also accept the older single-profile and node-line API formats.
CREATE VIEW migration_profiles AS
SELECT trim(json_extract(p.value, '$.id')) AS id, p.value AS profile, CAST(p.key AS INTEGER) AS sort_order
FROM configs c, json_each(CASE WHEN json_type(c.value, '$.profiles') = 'array'
  THEN json_extract(c.value, '$.profiles')
  ELSE json_array(json_set(c.value, '$.id', 'default', '$.name', 'Default')) END) p
WHERE c.key = 'router-config';

INSERT INTO manual_profiles (id, name, subscribe_token, sort_order)
SELECT id, trim(json_extract(profile, '$.name')), trim(json_extract(profile, '$.subscribeToken')), sort_order
FROM migration_profiles;

INSERT INTO manual_nodes (profile_id, sort_order, name, group_name, value)
WITH entries AS (
  SELECT p.id, CAST(n.key AS INTEGER) AS group_order, n.value AS node
  FROM migration_profiles p, json_each(CASE WHEN json_type(p.profile, '$.nodes') = 'array'
    THEN json_extract(p.profile, '$.nodes') ELSE json_array(json_extract(p.profile, '$.nodes')) END) n
), lines AS (
  SELECT e.id, e.group_order, CAST(l.key AS INTEGER) AS line_order,
    trim(json_extract(e.node, '$.group')) AS group_name, l.value AS line
  FROM entries e, json_each(CASE WHEN json_type(e.node, '$.value') = 'array'
    THEN json_extract(e.node, '$.value')
    ELSE json_array(COALESCE(json_extract(e.node, '$.line'),
      json_extract(e.node, '$.name') || ' = ' || json_extract(e.node, '$.value'))) END) l
)
SELECT id, row_number() OVER (PARTITION BY id ORDER BY group_order, line_order) - 1,
  trim(substr(line, 1, instr(line, '=') - 1)), group_name, trim(substr(line, instr(line, '=') + 1))
FROM lines;

INSERT INTO manual_mitm (profile_id, enabled, hostname, ca_id, ca_p12, ca_passphrase, ca_certificate)
SELECT id, COALESCE(json_extract(profile, '$.mitm.enabled'), 0),
  trim(COALESCE(json_extract(profile, '$.mitm.hostname'), '')),
  trim(COALESCE(json_extract(profile, '$.mitm.caId'), '')),
  trim(COALESCE(json_extract(profile, '$.mitm.caP12'), '')),
  trim(COALESCE(json_extract(profile, '$.mitm.caPassphrase'), '')),
  trim(COALESCE(json_extract(profile, '$.mitm.caCertificate'), ''))
FROM migration_profiles WHERE json_type(profile, '$.mitm') = 'object';

DROP VIEW migration_profiles;
DROP TABLE migration_validation;
DROP TABLE configs;
