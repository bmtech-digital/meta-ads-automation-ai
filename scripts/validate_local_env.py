"""Validate the local dev environment after bootstrap_local_db.sh.

Checks:
  1. Mongo is reachable at MONGO_URL.
  2. Target DB exists with all 7 expected collections.
  3. Indexes declared in init_mongo.py are present.
  4. Redis is reachable and responds to PING.
  5. Insert + read + delete round-trip succeeds on `businesses`.

Usage:
  docker compose run --rm campaigner python scripts/validate_local_env.py

Exits 0 on full pass, 1 on any failure. Safe to re-run (cleans up its own docs).
"""

from __future__ import annotations

import os
import sys
import uuid

import redis
from pymongo import MongoClient
from pymongo.errors import PyMongoError

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://mongo:27017")
MONGO_DB = os.environ.get("MONGO_DB", "campaigner_dev")
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

EXPECTED_COLLECTIONS = [
    "businesses",
    "business_knowledge",
    "baselines",
    "approvals",
    "agent_decisions",
    "creative_gallery",
    "heartbeats",
]

EXPECTED_INDEXES = {
    "business_knowledge": {"business_knowledge_business_id_uidx"},
    "baselines": {"baselines_lookup_idx"},
    "approvals": {"approvals_queue_idx", "approvals_run_idx"},
    "agent_decisions": {
        "agent_decisions_time_idx",
        "agent_decisions_run_idx",
        "agent_decisions_approval_idx",
        "agent_decisions_type_idx",
    },
    "creative_gallery": {"creative_gallery_time_idx"},
    "heartbeats": {"heartbeats_recent_idx"},
}


def _ok(msg: str) -> None:
    print(f"  \u2713 {msg}")


def _fail(msg: str) -> None:
    print(f"  \u2717 {msg}", file=sys.stderr)


def check_mongo_connection(client: MongoClient) -> None:
    print("[1/5] Mongo connection")
    info = client.server_info()
    _ok(f"connected — MongoDB {info.get('version', '?')}")


def check_collections(client: MongoClient) -> None:
    print("[2/5] Collections")
    db = client[MONGO_DB]
    found = set(db.list_collection_names())
    missing = set(EXPECTED_COLLECTIONS) - found
    if missing:
        _fail(f"missing collections: {sorted(missing)}")
        raise SystemExit(1)
    _ok(f"all {len(EXPECTED_COLLECTIONS)} collections present")


def check_indexes(client: MongoClient) -> None:
    print("[3/5] Indexes")
    db = client[MONGO_DB]
    for coll_name, expected in EXPECTED_INDEXES.items():
        coll = db[coll_name]
        actual = {idx["name"] for idx in coll.list_indexes()}
        missing = expected - actual
        if missing:
            _fail(f"{coll_name}: missing indexes {sorted(missing)}")
            raise SystemExit(1)
    _ok("all declared indexes present")


def check_redis(client: redis.Redis) -> None:
    print("[4/5] Redis connection")
    pong = client.ping()
    if not pong:
        _fail("redis PING did not return True")
        raise SystemExit(1)
    _ok(f"connected — {REDIS_URL}")


def check_roundtrip(client: MongoClient) -> None:
    print("[5/5] Insert/read/delete round-trip (businesses)")
    db = client[MONGO_DB]
    coll = db["businesses"]
    probe_name = f"__validate_probe_{uuid.uuid4()}"
    result = coll.insert_one(
        {
            "name": probe_name,
            "meta_ad_account_id": "act_000",
            "meta_page_id": "000",
            "meta_access_token_encrypted": "probe-token",
            "meta_auth_mode": "user_token",
            "active": True,
        }
    )
    doc = coll.find_one({"_id": result.inserted_id})
    if not doc or doc["name"] != probe_name:
        _fail("read-after-write mismatch")
        raise SystemExit(1)
    coll.delete_one({"_id": result.inserted_id})
    _ok(f"round-trip ok (probe _id {result.inserted_id})")


def main() -> int:
    print(f"MONGO_URL = {MONGO_URL}")
    print(f"MONGO_DB  = {MONGO_DB}")
    print(f"REDIS_URL = {REDIS_URL}")
    print()
    try:
        mongo_client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        redis_client = redis.Redis.from_url(REDIS_URL, socket_connect_timeout=3)
        check_mongo_connection(mongo_client)
        check_collections(mongo_client)
        check_indexes(mongo_client)
        check_redis(redis_client)
        check_roundtrip(mongo_client)
    except PyMongoError as e:
        _fail(f"mongo error: {e}")
        return 1
    except redis.RedisError as e:
        _fail(f"redis error: {e}")
        return 1
    print()
    print("\u2713 All checks passed. Local dev env is healthy.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
