DO $$
BEGIN
  SET lock_timeout = '0';
  ALTER TABLE recipes ADD COLUMN notes text;
END;
$$;
