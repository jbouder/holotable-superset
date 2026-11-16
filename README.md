# holotable-superset

A proof of concept: a Holotable-style dashboard UI on top of Apache Superset as
a headless backend, where an AI agent turns a prompt into a dashboard.

Start it from the repo root:

```sh
docker compose up
```

Status: M2 (headless render). Open http://localhost:3000 once the stack is
healthy, and run `scripts/verify-m1.sh` and `scripts/verify-m2.sh` to check it.
The full README arrives with M5.
