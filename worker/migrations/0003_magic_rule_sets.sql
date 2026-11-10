-- Last MagicRule lists that passed validation, served when the upstream fails.
CREATE TABLE magic_rule_sets (
  name TEXT NOT NULL,
  client TEXT NOT NULL CHECK (client IN ('surge', 'mihomo')),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (name, client)
);
