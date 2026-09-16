-- Every table carrying organizationId gets the same tenant policy.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Membership','Invitation','AuditLog','Location','Screen','Canvas','Panel',
    'Frame','FrameLocation','Content','Clock','Picture','Video','Youtube','Html',
    'Memo','Outlook','Report','Powerbi','Weather','News','Subscription','LegacyIntegration'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (
        current_setting('app.current_org', true) IS NULL
        OR "organizationId" = current_setting('app.current_org', true)
      )
      WITH CHECK (
        current_setting('app.current_org', true) IS NULL
        OR "organizationId" = current_setting('app.current_org', true)
      )
    $f$, t);
  END LOOP;
END $$;
