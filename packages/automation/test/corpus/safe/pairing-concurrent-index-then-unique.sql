CREATE INDEX CONCURRENTLY orders_customer_id_idx ON orders (customer_id);
ALTER TABLE orders ADD CONSTRAINT orders_customer_id_unique UNIQUE USING INDEX orders_customer_id_idx;
