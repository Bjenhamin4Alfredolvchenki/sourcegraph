BEGIN;

  REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM sgreader;
  REVOKE ALL PRIVILEGES ON SCHEMA public FROM sgreader;
do
$$
  begin
      execute format ('REVOKE ALL PRIVILEGES ON DATABASE %I FROM sgreader', current_database());
  end;
  $$;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM sgreader;
  DROP ROLE sgreader;

COMMIT;
