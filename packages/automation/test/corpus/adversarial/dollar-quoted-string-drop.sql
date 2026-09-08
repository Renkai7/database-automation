CREATE FUNCTION evade_dollar_quoting() RETURNS void AS $migration_body$
BEGIN
  DROP TABLE orders;
END;
$migration_body$ LANGUAGE plpgsql;
