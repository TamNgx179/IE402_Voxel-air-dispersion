# Data rights and third-party notices

Project source, bundled datasets, dependencies and hosted map services have separate terms. The repository currently has no top-level software license. The team needs to confirm copyright ownership and agree on a license before offering general reuse rights for project code.

| Material | Terms and attribution | Action for distribution |
| --- | --- | --- |
| OpenStreetMap footprints, roads, water and green areas | Credit © OpenStreetMap contributors and identify ODbL 1.0. [Copyright and license](https://www.openstreetmap.org/copyright). | Retain credit in maps, exports and bundled data. Assess the merged scene and OSM-derived voxel package for derivative database and offer obligations. |
| Google Open Buildings 2.5D Temporal heights | Upstream offers CC BY 4.0 or ODbL 1.0. The current scene manifest records CC BY 4.0 for heights. [Dataset FAQ](https://sites.research.google/gr/open-buildings/temporal/). | Credit Google, identify the selected license and describe height sampling and modifications. Review the combined scene before distribution. |
| EDGAR v8.1 2022 road transport PM2.5 | Credit European Commission, Joint Research Centre, and link the dataset. [Data use conditions](https://edgar.jrc.ec.europa.eu/dataset_ap81). | Verify the exact archive and terms for the derived NetCDF. Keep archive URL, sector and transformation metadata. |
| Open-Meteo historical inputs | API data are offered under CC BY 4.0. [Data license](https://open-meteo.com/en/license). | Credit Open-Meteo and applicable upstream providers. Describe aggregation and preserve the source period. |
| OpenFreeMap and fallback basemaps | Preserve source-specific credits for tiles and screenshots. [OpenFreeMap](https://openfreemap.org/). | Review each tile provider's conditions separately before bundling or caching tiles for distribution. |
| Bootstrap Icons | Preserve the notices in the [React viewer](../frontend/public/vendor/bootstrap-icons/LICENSE) and [legacy viewer](../frontend/legacy/vendor/bootstrap-icons/LICENSE). | Verify both copies when inspecting the release image. |
| Source Sans 3 | The React build bundles Source Sans 3 Variable from Fontsource. Preserve its [SIL Open Font License notice](../frontend/public/vendor/source-sans-3/LICENSE). | Include the notice with the built frontend. |
| Runtime libraries and base images | Versions are pinned in the lockfiles or referenced in HTML and Docker configuration. | Inventory npm, Python, browser assets and container packages from the actual release. Include their license and notice files where required. |

The [scene manifest](../db/seeds/scene/scene_manifest.json) and [demo input manifest](../deploy/demo-inputs/manifest.json) identify the packaged sources and checksums. Keep unresolved permissions visible in the release review. Lecture PDFs are references for the course mapping and are kept outside the repository.

## Technical handoff inventory

| Input | Frozen version and processing | Distribution status |
| --- | --- | --- |
| OSM scene | Buildings and roads retrieved 2026-09-30. Water and green areas retrieved 2026-10-06. Features clipped to the study area and projected to EPSG:32648. Per-file digests are in the scene manifest. | Preserve OSM attribution and ODbL notice. Confirm the terms and availability of the combined scene database before external publication. |
| Google Open Buildings height | Height estimates joined to OSM footprints and rasterized at voxel centers. The scene records CC BY 4.0 and the retrieval date. The frozen CSV does not record the exact upstream raster year per feature. | Credit Google and describe the transformation. Do not infer the missing raster year or claim measured building heights. |
| EDGAR PM2.5 | v8.1, 2022 TRO annual gridded flux. Area-weighted normalization and road proxy allocation produce the transport-ready voxel source. Archive URL, normalization factors and derived checksums are in the demo manifest. | Credit JRC and cite the exact release. The linked conditions require acknowledgment. The combined distribution decision is still open. |
| Meteorology | The scenario parameters and aggregation settings for 2025-01-01 through 2025-12-31 are recorded in `config/project.yaml`. The demo package contains the prepared parameters, not raw meteorology downloads. | Credit Open-Meteo and upstream providers where applicable. |

The technical handoff uses local verification artifacts. Publishing a downloadable
combined data package requires resolving the open distribution decisions and
confirming the project code license with its authors.

## Phạm vi phát hành của bản nghiệm thu

Đối chiếu nguồn ngày 15/11/2026. Gói phục vụ nghiệm thu giữ manifest gốc,
hash, thông báo nguồn và thông tin phiên bản. Kết quả kiểm tra nguồn nằm ở
[kiểm dữ liệu đầu vào](reviews/THANH_SCIENCE_AUDIT.md). Tách code, cơ sở dữ liệu
cảnh và tệp nghiên cứu khi xác định điều kiện phân phối. Vẫn cần xác nhận
giấy phép mã nguồn với các tác giả và điều kiện của cơ sở dữ liệu cảnh ghép
trước khi cấp quyền phân phối lại. Xem [hướng dẫn OSMF](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
và [điều kiện EDGAR v8.1 của JRC](https://edgar.jrc.ec.europa.eu/dataset_ap81).
