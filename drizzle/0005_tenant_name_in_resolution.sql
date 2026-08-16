-- Widen the resolver to return the institute's display name.
--
-- Tenant resolution already runs (and is cached) before every request, and
-- almost everything that renders on an institute's domain needs its name: the
-- page title, the header, and now the activation email, which has to say which
-- institute someone is being invited to. Reading it separately would mean an
-- extra query per request behind a lookup that is already cached, so the name
-- rides along with the lookup instead.
--
-- Nothing about the security properties changes. The function still takes one
-- hostname and answers only about that hostname, still runs with a fixed empty
-- search_path, still filters to active domains of active tenants, and still
-- returns no column that would let a caller enumerate anything. Adding the
-- name adds no capability: anyone who can reach the institute's site can read
-- its name off the page.
--
-- CREATE OR REPLACE cannot change a function's return type, so the old one is
-- dropped first. The GRANT does not survive a DROP, hence the re-grant below.

DROP FUNCTION IF EXISTS resolve_tenant_by_host(text);
--> statement-breakpoint

CREATE FUNCTION resolve_tenant_by_host(candidate_host text)
RETURNS TABLE (tenant_id uuid, tenant_slug text, tenant_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.slug, t.name
  FROM public.tenant_domains d
  JOIN public.tenants t ON t.id = d.tenant_id
  WHERE d.hostname = lower(candidate_host)
    AND d.verification_status = 'active'
    AND t.status = 'active'
  LIMIT 1;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION resolve_tenant_by_host(text) FROM PUBLIC;
--> statement-breakpoint

DO $$
DECLARE
  app_role text := current_setting('lamplight.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    app_role := 'lamplight_app';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION resolve_tenant_by_host(text) TO %I', app_role
    );
  END IF;
END
$$;
