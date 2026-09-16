-- Provisions the application role the compose stack connects as.
--
-- LOAD-BEARING FOR TENANT ISOLATION. A Postgres superuser bypasses row-level
-- security even under FORCE ROW LEVEL SECURITY. The image's POSTGRES_USER
-- ("lynesign") is a superuser, so connecting the app as that role would silently
-- disable Layer 2 of the tenancy guard. Everything that touches tenant data must
-- connect as this LOGIN NOSUPERUSER role instead.
--
-- Files in /docker-entrypoint-initdb.d/ run once, on first initialisation of an
-- empty data directory, as the bootstrap superuser against POSTGRES_DB
-- ("lynesign"). Mirrors scripts/dev-db.mjs (local) and .github/workflows/ci.yml.
--
-- CREATEDB matches those two: `prisma migrate` uses a shadow database, and the
-- role owning the database must be able to create it.

CREATE ROLE lynesign_app WITH LOGIN CREATEDB NOSUPERUSER PASSWORD 'lynesign';

ALTER DATABASE lynesign OWNER TO lynesign_app;
GRANT ALL PRIVILEGES ON DATABASE lynesign TO lynesign_app;
GRANT ALL ON SCHEMA public TO lynesign_app;
ALTER SCHEMA public OWNER TO lynesign_app;
