from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


# Repository root is determined from the physical location of this file.
#
# src/project_config.py
#        ↓
# parent = src/
# parent.parent = repository root
REPO_ROOT = Path(__file__).resolve().parents[1]


class ConfigError(ValueError):
    """
    Raised when the project configuration is missing,
    malformed, or internally inconsistent.
    """


def load_project_config(
    config_path: str | Path,
) -> dict[str, Any]:
    """
    Load the shared YAML project configuration.

    Parameters
    ----------
    config_path:
        Absolute path or a path relative to the repository root.

    Returns
    -------
    dict
        Parsed YAML configuration.

    Raises
    ------
    FileNotFoundError
        If the configuration file does not exist.

    ConfigError
        If the YAML root is not a mapping.
    """

    path = Path(
        config_path
    ).expanduser()

    if not path.is_absolute():
        path = (
            REPO_ROOT
            / path
        ).resolve()

    if not path.exists():
        raise FileNotFoundError(
            f"Configuration file not found: {path}"
        )

    with path.open(
        "r",
        encoding="utf-8",
    ) as handle:
        config = yaml.safe_load(
            handle
        )

    if not isinstance(
        config,
        dict,
    ):
        raise ConfigError(
            "Configuration root must be "
            f"a YAML mapping: {path}"
        )

    config["_meta"] = {
        "config_path": str(
            path
        ),
        "repo_root": str(
            REPO_ROOT
        ),
    }

    return config


def get_required(
    config: dict[str, Any],
    dotted_key: str,
) -> Any:
    """
    Read a required value using dot notation.

    Example
    -------
    get_required(config, "grid.dx_m")

    is equivalent to:

    config["grid"]["dx_m"]

    Unlike dict.get(), this function never silently falls back
    to a default value.
    """

    current: Any = config

    for part in dotted_key.split(
        "."
    ):
        if (
            not isinstance(
                current,
                dict,
            )
            or part not in current
        ):
            raise ConfigError(
                "Missing required configuration "
                f"key: {dotted_key}"
            )

        current = current[
            part
        ]

    return current


def resolve_repo_path(
    config: dict[str, Any],
    dotted_key: str,
) -> Path:
    """
    Resolve a configured file path.

    Relative paths are interpreted relative to the repository root,
    not relative to the terminal's current working directory.

    This makes commands reproducible regardless of where the user
    launches Python from.
    """

    raw_value = get_required(
        config,
        dotted_key,
    )

    if (
        not isinstance(
            raw_value,
            str,
        )
        or not raw_value.strip()
    ):
        raise ConfigError(
            f"Configuration key '{dotted_key}' "
            "must contain a non-empty path string."
        )

    path = Path(
        raw_value
    ).expanduser()

    if not path.is_absolute():
        path = (
            REPO_ROOT
            / path
        )

    return path.resolve()