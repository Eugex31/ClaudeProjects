-- Treat an empty `app.current_org` as "no tenant context", exactly like NULL.
--
-- Why: a custom GUC placeholder is NULL only until the session first touches it.
-- After `SET LOCAL app.current_org = ...` commits, Postgres does not restore NULL
-- -- it restores the placeholder's reset value, the empty string. That is
-- permanent for the life of the backend: RESET, `set_config(..., NULL, false)`
-- and even DISCARD ALL all leave `current_setting('app.current_org', true)` = ''.
--
-- With the previous `IS NULL` predicate, every pooled connection that had ever
-- carried a scoped transaction became permanently blind: '' is not NULL and
-- matches no "organizationId", so the policy hid every row in every tenant table
-- from the unscoped root client that later reused that connection.
--
-- The tenant guard's intent is unchanged (no context => policy does not filter;
-- context set => rows must match it); '' is simply not a valid organization id,
-- so it is folded into the "no context" branch.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Membership','Invitation','AuditLog','Location','Screen','Canvas','Panel',
    'Frame','FrameLocation','Content','Clock','Picture','Video','Youtube','Html',
    'Memo','Outlook','Report','Powerbi','Weather','News','Subscription','LegacyIntegration'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (
        coalesce(current_setting('app.current_org', true), '') = ''
        OR "organizationId" = current_setting('app.current_org', true)
      )
      WITH CHECK (
        coalesce(current_setting('app.current_org', true), '') = ''
        OR "organizationId" = current_setting('app.current_org', true)
      )
    $f$, t);
  END LOOP;
END $$;
