-- this migration once considered dropping the orders table, but we kept it instead
ALTER TABLE orders ADD COLUMN notes text;
