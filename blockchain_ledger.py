"""Hash-chain primitives used by the local PRAHARI integrity ledger."""

import hashlib
import json
import os
from typing import Any


GENESIS_HASH = "0" * 64


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path: str) -> str:
    if not path or not os.path.isfile(path):
        return ""
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as evidence_file:
            for chunk in iter(lambda: evidence_file.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return ""


def payload_hash(payload: Any) -> str:
    return sha256_text(canonical_json(payload))


def block_hash(previous_hash: str, record_type: str, record_id: Any, timestamp: str, payload_digest: str, evidence_digest: str) -> str:
    return sha256_text(canonical_json({
        "previous_hash": previous_hash,
        "record_type": record_type,
        "record_id": str(record_id) if record_id is not None else None,
        "timestamp": timestamp,
        "payload_hash": payload_digest,
        "evidence_hash": evidence_digest,
    }))