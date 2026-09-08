CREATE FUNCTION note_about_dropping() RETURNS text AS $$
  SELECT 'this function does not drop the orders table';
$$ LANGUAGE sql;
