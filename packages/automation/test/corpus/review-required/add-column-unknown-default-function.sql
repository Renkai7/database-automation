ALTER TABLE orders ADD COLUMN external_ref text DEFAULT generate_external_ref();
