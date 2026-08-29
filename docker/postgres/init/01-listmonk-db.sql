-- The listmonk profile connects to a database named "listmonk"; the postgres
-- image only creates POSTGRES_DB (ai_cmo), so create it here.
-- Runs only on first initialisation of an empty postgres_data volume.
SELECT 'CREATE DATABASE listmonk'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'listmonk')\gexec
