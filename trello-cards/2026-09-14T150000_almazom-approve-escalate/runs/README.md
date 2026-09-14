# Runs Directory

This directory contains execution evidence from trello-to-implement runs.
Each run gets a timestamped subdirectory with:

- `run.json` — metadata (start_time, cards_executed, status)
- `executed.json` — array of {card_id, title, status, duration_sec}
- `output.log` — aggregated CLI stdout/stderr
- `artifacts/` — files generated during execution

## Convention

```
runs/
├── 2026-05-28-plan2trello-enrich/
│   ├── run.json
│   ├── executed.json
│   ├── output.log
│   └── artifacts/
└── 2026-05-29-fix-aliases/
    └── ...
```

Runs are append-only. Never delete or modify past runs.
