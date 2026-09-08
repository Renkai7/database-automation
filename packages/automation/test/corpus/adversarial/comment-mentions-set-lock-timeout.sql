DO $$
BEGIN
  -- SET lock_timeout = '0'; (old note, no longer relevant)
  RAISE NOTICE $msg$this migration does not run SET lock_timeout = '0';$msg$;
END;
$$;

ALTER TABLE recipes ADD COLUMN notes text;
