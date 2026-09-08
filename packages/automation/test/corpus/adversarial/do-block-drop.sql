DO $$
BEGIN
  IF (SELECT count(*) FROM orders) = 0 THEN
    DROP TABLE orders;
  END IF;
END;
$$;
