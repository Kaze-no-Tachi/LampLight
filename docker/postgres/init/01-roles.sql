-- Creates the RLS-constrained application role.
--
-- The container superuser (lamplight_admin) owns the schema, runs migrations,
-- and backs the superadmin client. It bypasses row-level security because
-- superusers always do.
--
-- lamplight_app is what the running application connects as. It is deliberately
-- NOT a superuser and deliberately does NOT hold BYPASSRLS, so the policies in
-- the RLS migration actually constrain it. If these two roles are ever
-- collapsed into one, the database isolation layer silently disappears, which
-- is why src/env.ts refuses to boot when DATABASE_URL equals
-- DATABASE_ADMIN_URL.

\set app_password `echo "$LAMPLIGHT_APP_PASSWORD"`

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lamplight_app') THEN
    CREATE ROLE lamplight_app LOGIN;
  END IF;
END
$$;

ALTER ROLE lamplight_app WITH PASSWORD :'app_password';
ALTER ROLE lamplight_app WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT CONNECT ON DATABASE lamplight TO lamplight_app;
GRANT USAGE ON SCHEMA public TO lamplight_app;

-- The application reads and writes rows but never changes structure.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lamplight_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lamplight_app;

-- Tables created later by migrations (run as lamplight_admin) inherit the grants.
ALTER DEFAULT PRIVILEGES FOR ROLE lamplight_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lamplight_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lamplight_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lamplight_app;
