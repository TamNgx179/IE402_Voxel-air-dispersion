"""Bounded source experiments; the original source product stays immutable."""
MULTIPLIERS = (1.0, 0.8, 0.6)


def emission_multiplier(config: dict) -> float:
    """Missing means baseline; reject coercions such as True, null or '0.8'."""
    value = (config.get("run") or {}).get("emission_multiplier", 1.0)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value not in MULTIPLIERS:
        raise ValueError("run.emission_multiplier must be numeric 1, 0.8 or 0.6")
    return float(value)
