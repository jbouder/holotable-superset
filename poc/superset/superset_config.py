"""Superset config shared by the web app, the MCP server and the init job.

All three must load this same file: the SECRET_KEY encrypts connection
passwords in the metadata database, so a mismatch breaks data access.
"""

import os

SECRET_KEY = os.environ["SUPERSET_SECRET_KEY"]

_pg_user = os.environ["POSTGRES_USER"]
_pg_password = os.environ["POSTGRES_PASSWORD"]
_pg_host = os.environ.get("POSTGRES_HOST", "superset-db")
_pg = f"postgresql+psycopg2://{_pg_user}:{_pg_password}@{_pg_host}:5432"

SQLALCHEMY_DATABASE_URI = f"{_pg}/superset"
# Example data goes to its own Postgres database instead of SQLite.
SQLALCHEMY_EXAMPLES_URI = f"{_pg}/examples"

_redis = os.environ.get("REDIS_URL", "redis://redis:6379")

CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 300,
    "CACHE_KEY_PREFIX": "superset_",
    "CACHE_REDIS_URL": f"{_redis}/1",
}
DATA_CACHE_CONFIG = {
    **CACHE_CONFIG,
    "CACHE_KEY_PREFIX": "superset_data_",
    "CACHE_DEFAULT_TIMEOUT": 600,
}
RATELIMIT_STORAGE_URI = f"{_redis}/2"

# Superset is headless here. No browser ever loads its UI in the demo path.
WEBSERVER_ADDRESS = "http://superset:8088"

# --- MCP server ------------------------------------------------------------
# Superset 6.1.0 runs every MCP tool as MCP_DEV_USERNAME. That user is a
# read-only service account (see init_service_account.py), so RBAC blocks the
# chart, dashboard and SQL write tools even though 6.1.0 cannot hide them.
# The port is only reachable on the compose network and, for debugging, the
# host loopback.
MCP_DEV_USERNAME = os.environ["SUPERSET_SERVICE_USERNAME"]
MCP_AUTH_ENABLED = False
MCP_RBAC_ENABLED = True
# List every tool by name instead of the search/call proxy pair.
MCP_TOOL_SEARCH_CONFIG = {"enabled": False}
SUPERSET_WEBSERVER_ADDRESS = "http://superset:8088"
WEBDRIVER_BASEURL = "http://superset:8088/"
WEBDRIVER_BASEURL_USER_FRIENDLY = WEBDRIVER_BASEURL
MCP_SERVICE_URL = "http://superset-mcp:5008"
