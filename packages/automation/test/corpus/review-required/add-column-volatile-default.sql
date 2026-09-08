ALTER TABLE orders ADD COLUMN last_seen_at timestamptz DEFAULT clock_timestamp();
