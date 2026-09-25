"""Hardware-aware runtime settings for local and SaaS deployments."""

import os

PROFILE = os.getenv("PRAHARI_PROFILE", "balanced").strip().lower()
if PROFILE not in {"lite", "balanced", "high"}:
    PROFILE = "balanced"

PROFILE_SETTINGS = {
    "lite": {
        "image_size": 416,
        "inference_interval": 2,
        "face_detection": False,
        "anpr": False,
        "jpeg_quality": 65,
    },
    "balanced": {
        "image_size": 512,
        "inference_interval": 1,
        "face_detection": True,
        "anpr": True,
        "jpeg_quality": 70,
    },
    "high": {
        "image_size": 640,
        "inference_interval": 1,
        "face_detection": True,
        "anpr": True,
        "jpeg_quality": 75,
    },
}

SETTINGS = PROFILE_SETTINGS[PROFILE]


def apply_profile(profile: str) -> str:
    """Apply a validated profile for the current process and return its name."""
    global PROFILE, SETTINGS
    normalized = (profile or "lite").strip().lower()
    if normalized not in PROFILE_SETTINGS:
        raise ValueError(f"Unsupported runtime profile: {profile}")
    PROFILE = normalized
    SETTINGS = PROFILE_SETTINGS[normalized]
    return PROFILE


def setting(name: str):
    """Returns an optional environment override or the active profile value."""
    env_name = f"PRAHARI_{name.upper()}"
    value = os.getenv(env_name)
    if value is None:
        return SETTINGS[name]
    if isinstance(SETTINGS[name], bool):
        return value.lower() in {"1", "true", "yes", "on"}
    return type(SETTINGS[name])(value)
