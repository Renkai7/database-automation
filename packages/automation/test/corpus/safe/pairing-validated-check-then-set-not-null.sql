ALTER TABLE orders ADD CONSTRAINT orders_customer_id_not_null CHECK (customer_id IS NOT NULL) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_customer_id_not_null;
ALTER TABLE orders ALTER COLUMN customer_id SET NOT NULL;
