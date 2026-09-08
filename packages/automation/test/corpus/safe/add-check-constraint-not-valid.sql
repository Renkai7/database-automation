ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'shipped')) NOT VALID;
