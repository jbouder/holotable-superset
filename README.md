# holotable-superset

A proof of concept: a Holotable-style dashboard UI on top of Apache Superset as
a headless backend, where an AI agent turns a prompt into a dashboard.

Everything lives in [`poc/`](poc/). Start it with:

```sh
cd poc
docker compose up
```

Status: M1 (stack boots). Run `poc/scripts/verify-m1.sh` once the stack is
healthy. The full README arrives with M5.
