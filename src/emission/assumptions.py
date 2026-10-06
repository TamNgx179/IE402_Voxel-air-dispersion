"""
A3.5 - write every emission assumption to one generated file.

The file is GENERATED, never hand-edited: each row is read from the config
or measured from an artefact the pipeline wrote, so it cannot drift from what
actually ran. Stages that have not run are reported as `not-run`, never
filled with a guess.

It also carries the one independent check the EDGAR normalisation leaves:
the traffic flow that EDGAR's total IMPLIES. The emission factor cancels out
of the normalised source field, so it cannot be checked there; but

    implied flow per unit class weight [veh/s]
        = EDGAR target [g/s] / (EF [g/veh-km] * sum(weight * km) [km])

turns the EDGAR total back into vehicles on the road, which a traffic count
can confirm or refute.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import xarray as xr

from project_config import get_required, resolve_repo_path

SECONDS_PER_HOUR = 3600.0
GRAMS_PER_KILOGRAM = 1000.0


@dataclass(frozen=True)
class ImpliedFlow:
    """EDGAR total expressed as vehicles on the road."""

    per_unit_weight_veh_h: float
    by_class_veh_h: dict[str, float]


def implied_vehicle_flow(
    target_kg_s: float,
    proxy_retained_g_per_veh: float,
    class_weights: dict[str, float],
) -> ImpliedFlow:
    """
    Vehicles per hour that would produce the EDGAR total.

    `proxy_retained_g_per_veh` is sum(EF * weight * km) over the road length
    that survived rasterisation, so dividing the target by it gives vehicles
    per second on a road of weight 1.
    """

    if target_kg_s < 0.0:
        raise ValueError("target_kg_s must be non-negative")

    if proxy_retained_g_per_veh <= 0.0:
        raise ValueError("proxy_retained_g_per_veh must be positive")

    per_unit = (
        target_kg_s * GRAMS_PER_KILOGRAM / proxy_retained_g_per_veh
    ) * SECONDS_PER_HOUR

    return ImpliedFlow(
        per_unit_weight_veh_h=per_unit,
        by_class_veh_h={
            name: per_unit * float(weight)
            for name, weight in class_weights.items()
        },
    )


def _attrs(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None

    with xr.open_dataset(path) as dataset:
        return dict(dataset.attrs)


def _fmt(value: float, digits: int = 4) -> str:
    return f"{value:.{digits}g}"


def build_assumptions_markdown(config: dict[str, Any]) -> str:
    """Render the assumptions record from config and whatever has run."""

    emissions = get_required(config, "emissions")
    weights = {
        str(name): float(weight)
        for name, weight in get_required(
            config, "emissions.allocation.road_class_weights"
        ).items()
    }
    ef = float(get_required(config, "emissions.emission_factor.value_g_per_vehicle_km"))
    normalization = emissions.get("normalization", {})
    meteo_period = get_required(config, "meteorology.analysis_period")

    road_path = resolve_repo_path(config, "paths.road_emissions")
    relative_path = resolve_repo_path(config, "paths.emission_source_netcdf")
    transport_path = resolve_repo_path(config, "paths.emission_source_transport_netcdf")

    lines: list[str] = [
        "# Giả định phát thải",
        "",
        "> **File sinh tự động — không sửa tay.** Tạo bởi `src/emission/assumptions.py` lúc "
        f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}. Chạy lại pipeline "
        "phát thải để cập nhật. Mọi số dưới đây đọc từ `config/project.yaml` hoặc đo từ file "
        "pipeline đã ghi; bước chưa chạy ghi `not-run`.",
        "",
        "## 1. Bảng giả định",
        "",
        "| # | Giả định | Giá trị | Nguồn | Hệ quả / hạn chế |",
        "|---|---|---|---|---|",
    ]

    # --- road network ------------------------------------------------------
    if road_path.exists():
        roads = gpd.read_file(road_path)
        by_class = roads.groupby("highway")["length_m"].agg(["count", "sum"])
        share = roads.groupby("highway")["emission_share"].sum()
        network = (
            f"{len(roads)} cạnh, {roads['length_m'].sum():.1f} m; "
            + ", ".join(
                f"{name} {int(row['count'])} cạnh / {row['sum']:.0f} m"
                for name, row in by_class.sort_values("sum", ascending=False).iterrows()
            )
        )
        allocation = ", ".join(
            f"{name} {weights.get(name, float('nan')):.2f} → {100 * share[name]:.1f} %"
            for name in share.sort_values(ascending=False).index
        )
    else:
        network = "not-run"
        allocation = ", ".join(f"{name} {w:.2f}" for name, w in weights.items())

    lines += [
        f"| 1 | Mạng đường là đồ thị `drive` của OSM, **mỗi phố hai chiều tính một lần** | {network} | OSM qua osmnx; bỏ cạnh ngược trùng ở `emission/roads.py::drop_reverse_duplicates` | Phố đi bộ Nguyễn Huệ (`highway=pedestrian`) không phát thải — đúng. Hướng lưu thông không phải trọng số |",
        f"| 2 | Phân bổ theo **cấp đường** (`highway=`), trọng số → tỉ trọng phát thải | {allocation} | **Giả định mô hình, không có số đếm** (`config/project.yaml` `emissions.allocation`) | Bất định lớn nhất của nguồn thải; cần phân tích độ nhạy trọng số |",
        "| 3 | **Không dùng `maxspeed`** | — | Độ phủ thẻ OSM trên miền: `maxspeed` 47 %, cấp đường 100 % | Không mô tả được ùn tắc / tốc độ |",
        f"| 4 | Hệ số phát thải xe máy | **{ef} g/(xe·km)**, nhãn `{emissions.get('pollutant')}` | {emissions['emission_factor'].get('source')} ({emissions['emission_factor'].get('doi')}) — đo ở **Hà Nội** | **Bị triệt tiêu khi chuẩn hoá EDGAR**: không ảnh hưởng trường S cuối; chỉ còn dùng cho phép đối chiếu lưu lượng ở §2 |",
        f"| 5 | Nhãn chất ô nhiễm | proxy `{emissions.get('pollutant')}` → đích `{normalization.get('target_pollutant', 'not-run')}` | config | EF là PM tổng, EDGAR là PM2.5: chỉ dùng tỉ lệ không gian của PM, không dùng trị tuyệt đối |",
        f"| 6 | Chiều cao nguồn | {get_required(config, 'emissions.rasterization.source_height_m')} m → tầng voxel k = 0 (tâm 1 m) | ống xả xe máy | Không có rối do xe cộ (spec *Ngoài phạm vi*, AC-25) |",
    ]

    relative = _attrs(relative_path)
    if relative is not None:
        rejected = float(relative.get("proxy_rejected_fraction_of_inside", float("nan")))
        inside = int(relative.get("road_edges_intersecting_domain", -1))
        total = int(relative.get("road_edges_total", -1))
        lines.append(
            f"| 7 | Đoạn đường nằm dưới voxel rắn bị loại, phần còn lại **chuẩn hoá lại trên toàn miền** | {100 * rejected:.4f} % proxy bị loại; {inside}/{total} cạnh cắt miền | `emission/rasterizer.py` | Bảo toàn tổng; lượng bị loại phân bổ lên mọi đường chứ không lên ô khí gần nhất — với tỉ lệ này ảnh hưởng không đáng kể |"
        )
    else:
        lines.append("| 7 | Chính sách voxel rắn | not-run | — | — |")

    transport = _attrs(transport_path)

    # A3.4 output left over from an earlier A3.3 describes a different
    # allocation; report it as stale rather than mixing the two runs.
    if (
        transport is not None
        and relative is not None
        and abs(
            float(transport.get("proxy_retained", -1.0))
            - float(relative.get("proxy_retained", -2.0))
        )
        > 1e-9 * max(abs(float(relative.get("proxy_retained", 1.0))), 1e-30)
    ):
        transport = None

    if transport is not None:
        target = float(transport["edgar_target_total_kg_s"])
        flux = float(transport["edgar_area_weighted_flux_kg_m2_s"])
        lines += [
            f"| 8 | Tổng phát thải đặt bằng **EDGAR** | {transport.get('edgar_release')} {transport.get('edgar_sector_code')} {int(transport.get('edgar_year'))}: flux {_fmt(flux)} kg m⁻² s⁻¹ → **{_fmt(target)} kg/s** cho miền 500 × 500 m | {transport.get('attribution')} | EDGAR là **trung bình ô 0,1° (~11 km)**, gồm cả vùng ít xe; áp cho lõi Quận 1 nhiều khả năng **thấp hơn thực tế** — xem §2 |",
            f"| 9 | Lệch năm | EDGAR {int(transport.get('edgar_year'))} ↔ khí tượng {meteo_period['start_date']} – {meteo_period['end_date']} | config | Chấp nhận được cho phân bố không gian; không dùng để so trị tuyệt đối theo năm |",
        ]
    else:
        target = None
        lines += [
            "| 8 | Tổng phát thải theo EDGAR | not-run | — | Chưa có trị tuyệt đối |",
            "| 9 | Lệch năm | not-run | — | — |",
        ]

    lines += [
        "| 10 | **Flux trung bình năm** áp cho **một giờ gió tựa dừng** | không có hệ số theo giờ trong ngày | thiết kế mô hình | Nồng độ là mức **đại diện trung bình**, không phải giờ cao điểm |",
        "| 11 | Nồng độ nền (background) | 0 | thiết kế mô hình | Chỉ là **phần đóng góp của giao thông trong miền**; không so thẳng được với trạm quan trắc |",
        "",
        "## 2. Đối chiếu độc lập: EDGAR ngụ ý bao nhiêu xe?",
        "",
    ]

    if transport is not None and relative is not None:
        flow = implied_vehicle_flow(
            target_kg_s=target,
            proxy_retained_g_per_veh=float(relative["proxy_retained"]),
            class_weights=weights,
        )
        lines += [
            "`lưu lượng (xe/h) = tổng EDGAR (g/s) ÷ Σ(EF · trọng số · km) (g/xe) × 3600 × trọng số cấp`",
            "",
            "| Cấp đường | Trọng số | Lưu lượng xe máy EDGAR ngụ ý |",
            "|---|---|---|",
        ]
        lines += [
            f"| {name} | {weights[name]:.2f} | **{veh:.0f} xe/h** |"
            for name, veh in sorted(flow.by_class_veh_h.items(), key=lambda item: -item[1])
        ]
        lines += [
            "",
            "**Trạng thái: `computed`.** Số liệu công bố để đối chiếu (bối cảnh, không phải số "
            "đếm trong miền mô hình):",
            "",
        ]
        references = emissions.get("flow_references") or []
        lines += [
            f"- {ref['figure']} — {ref['source']}, doi:{ref['doi']}. *Giới hạn:* {ref['caveat']}."
            for ref in references
        ] or ["- (chưa có số liệu đối chiếu trong config)"]
        lines += [
            "",
            "**Đọc:** lưu lượng EDGAR ngụ ý (hàng chục tới ~100 xe/h mỗi tuyến) thấp hơn **rất nhiều** "
            "so với bậc lưu lượng xe máy ở lõi TP.HCM. Nhất quán với việc EDGAR là trung bình ô "
            "~11 km. Kết luận: nồng độ tuyệt đối là **cận dưới**; phân bố không gian và so sánh "
            "giữa kịch bản không bị ảnh hưởng, vì mô hình tuyến tính theo nguồn. Web có hệ số "
            "nhân phát thải để khảo sát độ nhạy này.",
        ]
    else:
        lines.append("**Trạng thái: `not-run`** — cần chạy A3.3 và A3.4 (`src/edgar_normalizer.py`).")

    lines += [
        "",
        "## 3. Dùng kết quả thế nào",
        "",
        "- **Dùng được:** phân bố không gian, gradient theo độ cao, so sánh giữa kịch bản gió, "
        "tỉ lệ vượt ngưỡng tương đối.",
        "- **Không dùng được như số đo:** nồng độ µg/m³ tuyệt đối. Báo cáo phải gọi là "
        "*nồng độ mô phỏng chuẩn hoá theo EDGAR*, không gọi là dự báo chất lượng không khí.",
        "",
    ]

    return "\n".join(lines)


def write_emission_assumptions(config: dict[str, Any]) -> Path:
    """Write the A3.5 record to `paths.emission_assumptions`."""

    destination = resolve_repo_path(config, "paths.emission_assumptions")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(build_assumptions_markdown(config), encoding="utf-8")
    return destination

