-- Host header to tenant resolution (PRD section 5.2).
--
-- THE BOOTSTRAP PROBLEM
--
-- Every tenant-scoped query needs app.tenant_id set. Resolving which tenant a
-- request belongs to is the one read that cannot, because it is what
-- establishes the tenant in the first place. tenant_domains carries RLS keyed
-- on app.tenant_id, so with no tenant set it correctly returns zero rows.
--
-- Something has to be allowed to make that one read. The options were a
-- SECURITY DEFINER function, a global routing table, or reusing the
-- RLS-bypassing admin client. This is the function, chosen because it is the
-- only one where enumeration is structurally impossible rather than merely
-- unlikely: it takes a hostname and answers about that hostname. There is no
-- query shape that lists other institutes, so a bug in the caller, which sits
-- in the busiest code path on the platform, cannot leak the tenant roster.
--
-- WHAT MAKES IT SAFE
--
--   SECURITY DEFINER      Runs as the owner, so RLS does not apply.
--   Fixed empty search_path  Prevents search_path hijacking, which is the
--                         standard attack on SECURITY DEFINER functions. All
--                         objects below are schema-qualified accordingly.
--   Returns two columns   Tenant id and slug. Not the hostname list, not
--                         cf_hostname_id, not verification state, not counts.
--   Filters to active     Unverified and failed domains do not resolve, which
--                         is what stops someone pointing DNS at us and being
--                         served another institute's site (PRD section 5.3).
--   Filters to active tenants  A suspended institute stops resolving.
--   REVOKE from PUBLIC    Only the application role may call it.
--
-- The equivalent lookup by subdomain slug needs no function: `tenants` is a
-- global table with no RLS, so the application role can already read it.

CREATE OR REPLACE FUNCTION resolve_tenant_by_host(candidate_host text)
RETURNS TABLE (tenant_id uuid, tenant_slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.slug
  FROM public.tenant_domains d
  JOIN public.tenants t ON t.id = d.tenant_id
  WHERE d.hostname = lower(candidate_host)
    AND d.verification_status = 'active'
    AND t.status = 'active'
  LIMIT 1;
$$;
--> statement-breakpoint

-- The function runs with the owner's rights, so it must not be callable by
-- anyone the application does not control.
REVOKE ALL ON FUNCTION resolve_tenant_by_host(text) FROM PUBLIC;
--> statement-breakpoint

DO $$
DECLARE
  app_role text := current_setting('lamplight.app_role', true);
BEGIN
  -- Defaults to the compose role name. Self-hosters who provisioned a
  -- different application role can set lamplight.app_role before migrating.
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
--> statement-breakpoint

-- Custom hostnames are unique platform-wide (see docs/adr/0001), and this
-- index is what makes the lookup on every single request an index probe
-- rather than a scan. The unique constraint on hostname already provides it,
-- but resolution filters on verification_status too, so a partial index over
-- just the rows that can ever resolve keeps the hot path narrow.
CREATE INDEX IF NOT EXISTS tenant_domains_active_hostname_idx
  ON tenant_domains (hostname)
  WHERE verification_status = 'active';
