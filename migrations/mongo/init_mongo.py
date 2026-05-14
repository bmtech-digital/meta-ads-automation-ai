"""Create MongoDB collections + indexes for Campaigner local dev.

Mirrors the 7 SQL migrations in migrations/_sql_pending_decision/ (per spec §10),
translated to MongoDB collection shapes. Idempotent — safe to run repeatedly.

Usage:
  docker compose run --rm campaigner python migrations/mongo/init_mongo.py

Env:
  MONGO_URL  (default: mongodb://mongo:27017)
  MONGO_DB   (default: campaigner_dev)

This is a local-dev bootstrap. The remote target (Supabase / Mongo Atlas / self-hosted)
is pending a §1.4 re-decision — see decisions-log.md §1.4 amendment and
migrations/README.md.
"""

from __future__ import annotations

import os
import sys

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import CollectionInvalid

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://mongo:27017")
MONGO_DB = os.environ.get("MONGO_DB", "campaigner_dev")

COLLECTIONS = [
    "businesses",
    "business_knowledge",
    "baselines",
    "approvals",
    "agent_decisions",
    "creative_gallery",
    "heartbeats",
]

INDEXES = {
    "business_knowledge": [
        {
            "keys": [("business_id", ASCENDING)],
            "unique": True,
            "name": "business_knowledge_business_id_uidx",
        },
    ],
    "baselines": [
        {
            "keys": [
                ("business_id", ASCENDING),
                ("scope", ASCENDING),
                ("scope_id", ASCENDING),
                ("metric", ASCENDING),
            ],
            "name": "baselines_lookup_idx",
        },
    ],
    "approvals": [
        {
            "keys": [("business_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)],
            "name": "approvals_queue_idx",
        },
        {"keys": [("created_by_run_id", ASCENDING)], "name": "approvals_run_idx"},
    ],
    "agent_decisions": [
        {
            "keys": [("business_id", ASCENDING), ("created_at", DESCENDING)],
            "name": "agent_decisions_time_idx",
        },
        {"keys": [("run_id", ASCENDING)], "name": "agent_decisions_run_idx"},
        {
            "keys": [("related_approval_id", ASCENDING)],
            "name": "agent_decisions_approval_idx",
            "sparse": True,
        },
        {"keys": [("decision_type", ASCENDING)], "name": "agent_decisions_type_idx"},
    ],
    "creative_gallery": [
        {
            "keys": [("business_id", ASCENDING), ("created_at", DESCENDING)],
            "name": "creative_gallery_time_idx",
        },
    ],
    "heartbeats": [
        {
            "keys": [("business_id", ASCENDING), ("flow", ASCENDING), ("ran_at", DESCENDING)],
            "name": "heartbeats_recent_idx",
        },
    ],
}


def main() -> int:
    print(f"MONGO_URL = {MONGO_URL}")
    print(f"MONGO_DB  = {MONGO_DB}")
    print()

    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")
    db = client[MONGO_DB]

    print("[1/2] Collections")
    existing = set(db.list_collection_names())
    for name in COLLECTIONS:
        if name in existing:
            print(f"  = {name} (exists)")
            continue
        try:
            db.create_collection(name)
            print(f"  + {name}")
        except CollectionInvalid:
            print(f"  = {name} (race: created concurrently)")

    print()
    print("[2/2] Indexes")
    for coll_name, specs in INDEXES.items():
        coll = db[coll_name]
        for spec in specs:
            opts = {k: v for k, v in spec.items() if k not in ("keys", "name")}
            coll.create_index(spec["keys"], name=spec["name"], **opts)
            print(f"  + {coll_name}.{spec['name']}")

    print()
    print("\u2713 Mongo init complete.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"\u2717 init failed: {e}", file=sys.stderr)
        sys.exit(1)
