-- Consecutive failed scheduled checks per MagicRule list, and whether Bark has reported them.
CREATE TABLE magic_rule_checks (
  name TEXT NOT NULL,
  client TEXT NOT NULL CHECK (client IN ('surge', 'mihomo')),
  failures INTEGER NOT NULL CHECK (failures >= 0),
  notified INTEGER NOT NULL CHECK (notified IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (name, client)
);
