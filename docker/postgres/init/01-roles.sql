-- Creates the RLS-constrained application role.
--
-- The container superuser (lectern_admin) owns the schema, runs migrations,
-- and backs the superadmin client. It bypasses row-level security because
-- superusers always do.
--
-- lectern_app is what the running application connects as. It is deliberately
-- NOT a superuser and deliberately does NOT hold BYPASSRLS, so the policies in
-- the RLS migration actually constrain it. If these two roles are ever
-- collapsed into one, the database isolation layer silently disappears, which
-- is why src/env.ts refuses to boot when DATABASE_URL equals
-- DATABASE_ADMIN_URL.

\set app_password `echo "$LECTERN_APP_PASSWORD"`

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lectern_app') THEN
    CREATE ROLE lectern_app LOGIN;
  END IF;
END
$$;

ALTER ROLE lectern_app WITH PASSWORD :'app_password';
ALTER ROLE lectern_app WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT CONNECT ON DATABASE lectern TO lectern_app;
GRANT USAGE ON SCHEMA public TO lectern_app;

-- The application reads and writes rows but never changes structure.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lectern_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lectern_app;

-- Tables created later by migrations (run as lectern_admin) inherit the grants.
ALTER DEFAULT PRIVILEGES FOR ROLE lectern_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lectern_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lectern_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lectern_app;
