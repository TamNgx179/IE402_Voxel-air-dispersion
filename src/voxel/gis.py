from __future__ import annotations

import logging
from pathlib import Path

import geopandas as gpd

from pyproj import CRS

from shapely import make_valid
from shapely.geometry import box

from voxel.models import GridDefinition


LOGGER = logging.getLogger(
    __name__
)


POLYGON_GEOMETRY_TYPES = {
    "Polygon",
    "MultiPolygon",
}


def read_vector_layer(
    path: Path,
    *,
    missing_crs: str | None,
    label: str,
    require_polygon_geometry: bool = True,
) -> gpd.GeoDataFrame:
    """
    Read and validate a GIS vector layer.

    Parameters
    ----------
    path:
        Path to any vector format supported by GeoPandas,
        for example GeoJSON, GeoPackage, or Shapefile.

    missing_crs:
        CRS to assign only when the input file genuinely lacks CRS
        metadata.

        This value must come from project configuration.

        The function never guesses a missing CRS.

    label:
        Human-readable dataset name used in log/error messages.

    require_polygon_geometry:
        If True, only Polygon and MultiPolygon geometries are retained.

        This should normally be True for:
        - buildings
        - study-area boundaries

    Returns
    -------
    geopandas.GeoDataFrame
        Cleaned vector dataset.

    Raises
    ------
    FileNotFoundError
        If the configured input file does not exist.

    ValueError
        If the dataset is empty, has no usable geometry,
        has no known CRS, or contains no required geometry type.
    """

    path = Path(
        path
    ).expanduser().resolve()

    if not path.exists():
        raise FileNotFoundError(
            f"{label} file not found: {path}"
        )

    if not path.is_file():
        raise ValueError(
            f"{label} path is not a file: {path}"
        )

    LOGGER.info(
        "Reading %s: %s",
        label,
        path,
    )

    frame = gpd.read_file(
        path
    )

    if frame.empty:
        raise ValueError(
            f"{label} dataset is empty: {path}"
        )

    if "geometry" not in frame.columns:
        raise ValueError(
            f"{label} dataset does not contain "
            "a geometry column."
        )

    frame = _remove_missing_geometry(
        frame=frame,
        label=label,
    )

    frame = _ensure_crs(
        frame=frame,
        missing_crs=missing_crs,
        label=label,
    )

    frame = _repair_invalid_geometry(
        frame=frame,
        label=label,
    )

    frame = _remove_missing_geometry(
        frame=frame,
        label=label,
    )

    if require_polygon_geometry:
        frame = _keep_polygon_geometry(
            frame=frame,
            label=label,
        )

    frame = frame.reset_index(
        drop=True
    )

    LOGGER.info(
        "%s loaded successfully: %s feature(s), CRS=%s",
        label,
        f"{len(frame):,}",
        frame.crs,
    )

    return frame


def determine_target_crs(
    study_area: gpd.GeoDataFrame,
    target_setting: str,
) -> CRS:
    """
    Determine the projected CRS used by the numerical model.

    Supported configuration
    -----------------------
    auto_utm
        Automatically estimate the local UTM CRS from the study area.

    Any explicit CRS understood by pyproj
        Examples:
            EPSG:32648
            EPSG:32649

    Requirements
    ------------
    The resulting model CRS must:

    - be projected;
    - use metres as horizontal units.

    This is important because dx, dy, building height, transport
    distances, and all other spatial dimensions are represented
    in metres throughout the model.
    """

    if study_area.empty:
        raise ValueError(
            "Cannot determine target CRS from "
            "an empty study-area dataset."
        )

    if study_area.crs is None:
        raise ValueError(
            "Study area has no CRS. "
            "A target CRS cannot be determined safely."
        )

    setting = str(
        target_setting
    ).strip()

    if not setting:
        raise ValueError(
            "Target CRS setting cannot be empty."
        )

    if setting.lower() == "auto_utm":

        estimated_crs = (
            study_area
            .estimate_utm_crs()
        )

        if estimated_crs is None:
            raise ValueError(
                "GeoPandas could not estimate a suitable "
                "UTM CRS from the study area."
            )

        target_crs = CRS.from_user_input(
            estimated_crs
        )

    else:

        try:
            target_crs = CRS.from_user_input(
                setting
            )

        except Exception as exc:
            raise ValueError(
                "Invalid configured target CRS: "
                f"{setting!r}"
            ) from exc

    _validate_model_crs(
        target_crs
    )

    LOGGER.info(
        "Model CRS selected: %s",
        target_crs.to_string(),
    )

    return target_crs


def project_to_model_crs(
    frame: gpd.GeoDataFrame,
    target_crs: CRS,
    *,
    label: str,
) -> gpd.GeoDataFrame:
    """
    Transform a vector dataset into the model CRS.

    Parameters
    ----------
    frame:
        Input vector dataset.

    target_crs:
        Projected metre-based CRS used by the model.

    label:
        Human-readable name used in logs.

    Returns
    -------
    geopandas.GeoDataFrame
        A projected copy of the input dataset.
    """

    if frame.crs is None:
        raise ValueError(
            f"{label} has no CRS and therefore "
            "cannot be reprojected."
        )

    _validate_model_crs(
        target_crs
    )

    source_crs = CRS.from_user_input(
        frame.crs
    )

    if source_crs == target_crs:

        projected = frame.copy()

        LOGGER.info(
            "%s already uses model CRS.",
            label,
        )

    else:

        LOGGER.info(
            "Reprojecting %s from %s to %s",
            label,
            source_crs.to_string(),
            target_crs.to_string(),
        )

        projected = frame.to_crs(
            target_crs
        )

    if projected.empty:
        raise ValueError(
            f"{label} became empty after reprojection."
        )

    return projected


def clip_buildings_to_domain(
    buildings: gpd.GeoDataFrame,
    study_area: gpd.GeoDataFrame,
    grid: GridDefinition,
    *,
    clip_to_study_area: bool,
) -> gpd.GeoDataFrame:
    """
    Restrict buildings to the computational domain.

    The rectangular computational grid is always applied.

    If `clip_to_study_area` is True, the study-area polygon is also
    applied.

    Therefore:

        final clip geometry
            =
        computational rectangle

    or:

        final clip geometry
            =
        computational rectangle
        ∩
        study-area geometry

    Parameters
    ----------
    buildings:
        Building polygons already transformed into model CRS.

    study_area:
        Study-area polygons already transformed into model CRS.

    grid:
        Computational grid definition.

    clip_to_study_area:
        Whether the study-area polygon should additionally constrain
        the building dataset.

    Returns
    -------
    geopandas.GeoDataFrame
        Building polygons clipped to the required spatial region.
    """

    _require_same_crs(
        first=buildings,
        second=study_area,
        first_label="Buildings",
        second_label="Study area",
    )

    if buildings.empty:
        raise ValueError(
            "Cannot clip an empty building dataset."
        )

    if study_area.empty:
        raise ValueError(
            "Cannot clip against an empty study area."
        )

    computational_domain = box(
        grid.min_x,
        grid.min_y,
        grid.max_x,
        grid.max_y,
    )

    clip_geometry = (
        computational_domain
    )

    if clip_to_study_area:

        study_geometry = (
            study_area
            .geometry
            .union_all()
        )

        if study_geometry.is_empty:
            raise ValueError(
                "Study-area union is empty."
            )

        clip_geometry = (
            computational_domain
            .intersection(
                study_geometry
            )
        )

        if clip_geometry.is_empty:
            raise ValueError(
                "The configured computational domain "
                "does not overlap the study area."
            )

    LOGGER.info(
        "Clipping building polygons to computational domain..."
    )

    clipped = gpd.clip(
        buildings,
        clip_geometry,
    )

    clipped = _remove_missing_geometry(
        frame=clipped,
        label="Clipped buildings",
    )

    clipped = _repair_invalid_geometry(
        frame=clipped,
        label="Clipped buildings",
    )

    clipped = _keep_polygon_geometry(
        frame=clipped,
        label="Clipped buildings",
    )

    clipped = clipped.reset_index(
        drop=True
    )

    if clipped.empty:
        raise ValueError(
            "No buildings remain inside the "
            "configured computational domain."
        )

    LOGGER.info(
        "Buildings remaining after clipping: %s",
        f"{len(clipped):,}",
    )

    return clipped


def validate_study_area(
    study_area: gpd.GeoDataFrame,
) -> None:
    """
    Validate a study-area layer before grid construction.

    The study area must:

    - contain usable geometry;
    - contain polygon geometry;
    - have a known CRS.
    """

    if study_area.empty:
        raise ValueError(
            "Study-area dataset is empty."
        )

    if study_area.crs is None:
        raise ValueError(
            "Study-area CRS is missing."
        )

    geometry_types = set(
        study_area
        .geometry
        .geom_type
        .dropna()
        .unique()
    )

    unsupported = (
        geometry_types
        - POLYGON_GEOMETRY_TYPES
    )

    if unsupported:
        raise ValueError(
            "Study area must contain only polygon geometry. "
            f"Found unsupported types: {sorted(unsupported)}"
        )


def _remove_missing_geometry(
    frame: gpd.GeoDataFrame,
    *,
    label: str,
) -> gpd.GeoDataFrame:
    """
    Remove null and empty geometry rows.
    """

    valid_geometry_mask = (
        frame.geometry.notna()
        & ~frame.geometry.is_empty
    )

    removed_count = int(
        (
            ~valid_geometry_mask
        ).sum()
    )

    if removed_count > 0:
        LOGGER.warning(
            "%s: removing %s null/empty geometry feature(s).",
            label,
            f"{removed_count:,}",
        )

    result = frame.loc[
        valid_geometry_mask
    ].copy()

    if result.empty:
        raise ValueError(
            f"{label} contains no usable geometry."
        )

    return result


def _ensure_crs(
    frame: gpd.GeoDataFrame,
    *,
    missing_crs: str | None,
    label: str,
) -> gpd.GeoDataFrame:
    """
    Ensure a dataset has explicit CRS metadata.

    A missing CRS is never guessed.

    If configuration explicitly supplies a known source CRS,
    it is assigned without modifying coordinate values.
    """

    if frame.crs is not None:
        return frame

    if missing_crs is None:
        raise ValueError(
            f"{label} has no CRS metadata. "
            "The source CRS must be known before this "
            "dataset can be used. "
            "Configure the corresponding "
            "'crs.*_if_missing' value only if you know "
            "the original CRS."
        )

    try:
        assigned_crs = CRS.from_user_input(
            missing_crs
        )

    except Exception as exc:
        raise ValueError(
            f"Configured fallback CRS for {label} "
            f"is invalid: {missing_crs!r}"
        ) from exc

    LOGGER.warning(
        "%s has no CRS metadata. "
        "Assigning explicitly configured CRS: %s",
        label,
        assigned_crs.to_string(),
    )

    return frame.set_crs(
        assigned_crs,
        allow_override=True,
    )


def _repair_invalid_geometry(
    frame: gpd.GeoDataFrame,
    *,
    label: str,
) -> gpd.GeoDataFrame:
    """
    Repair invalid geometries using Shapely make_valid().

    Valid geometry is left untouched.
    """

    invalid_mask = (
        ~frame.geometry.is_valid
    )

    invalid_count = int(
        invalid_mask.sum()
    )

    if invalid_count == 0:
        return frame

    LOGGER.warning(
        "%s: repairing %s invalid geometry feature(s).",
        label,
        f"{invalid_count:,}",
    )

    repaired = frame.copy()

    repaired.loc[
        invalid_mask,
        "geometry",
    ] = (
        repaired.loc[
            invalid_mask,
            "geometry",
        ]
        .apply(
            make_valid
        )
    )

    still_invalid_mask = (
        ~repaired.geometry.is_valid
    )

    still_invalid_count = int(
        still_invalid_mask.sum()
    )

    if still_invalid_count > 0:
        raise ValueError(
            f"{label}: {still_invalid_count} geometry "
            "feature(s) remain invalid after make_valid()."
        )

    return repaired


def _keep_polygon_geometry(
    frame: gpd.GeoDataFrame,
    *,
    label: str,
) -> gpd.GeoDataFrame:
    """
    Keep Polygon and MultiPolygon geometries only.

    Geometry repair or clipping may occasionally produce other
    geometry types such as LineString or GeometryCollection.

    Those cannot represent building volumes and are therefore
    excluded.
    """

    geometry_type = (
        frame.geometry.geom_type
    )

    polygon_mask = (
        geometry_type.isin(
            POLYGON_GEOMETRY_TYPES
        )
    )

    removed_count = int(
        (
            ~polygon_mask
        ).sum()
    )

    if removed_count > 0:

        removed_types = sorted(
            set(
                geometry_type.loc[
                    ~polygon_mask
                ]
                .dropna()
                .tolist()
            )
        )

        LOGGER.warning(
            "%s: removing %s non-polygon feature(s). "
            "Geometry types: %s",
            label,
            f"{removed_count:,}",
            removed_types,
        )

    result = frame.loc[
        polygon_mask
    ].copy()

    if result.empty:
        raise ValueError(
            f"{label} contains no Polygon or "
            "MultiPolygon geometry."
        )

    return result


def _validate_model_crs(
    crs: CRS,
) -> None:
    """
    Validate the CRS used by the numerical model.

    The model assumes horizontal distances are measured in metres.
    """

    if not crs.is_projected:
        raise ValueError(
            "Model CRS must be projected. "
            f"Received: {crs.to_string()}"
        )

    axis_info = crs.axis_info

    if not axis_info:
        raise ValueError(
            "Could not determine units of model CRS: "
            f"{crs.to_string()}"
        )

    horizontal_axes = (
        axis_info[:2]
    )

    for axis in horizontal_axes:

        unit_name = (
            axis.unit_name
            or ""
        ).strip().lower()

        unit_conversion = (
            axis.unit_conversion_factor
        )

        # A metre-based CRS normally has conversion factor 1.0
        # relative to SI metres.
        if (
            "metre" not in unit_name
            and "meter" not in unit_name
        ):
            raise ValueError(
                "Model CRS must use metres as horizontal units. "
                f"Axis '{axis.name}' uses '{axis.unit_name}'. "
                f"CRS: {crs.to_string()}"
            )

        if (
            unit_conversion is not None
            and abs(
                float(
                    unit_conversion
                )
                - 1.0
            )
            > 1e-12
        ):
            raise ValueError(
                "Model CRS horizontal unit conversion "
                "is not 1 metre. "
                f"CRS: {crs.to_string()}"
            )


def _require_same_crs(
    *,
    first: gpd.GeoDataFrame,
    second: gpd.GeoDataFrame,
    first_label: str,
    second_label: str,
) -> None:
    """
    Ensure two spatial datasets use the same CRS.
    """

    if first.crs is None:
        raise ValueError(
            f"{first_label} CRS is missing."
        )

    if second.crs is None:
        raise ValueError(
            f"{second_label} CRS is missing."
        )

    first_crs = CRS.from_user_input(
        first.crs
    )

    second_crs = CRS.from_user_input(
        second.crs
    )

    if first_crs != second_crs:
        raise ValueError(
            f"{first_label} and {second_label} "
            "must use the same CRS before spatial clipping. "
            f"{first_label}: {first_crs.to_string()}, "
            f"{second_label}: {second_crs.to_string()}"
        )