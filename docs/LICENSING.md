# Data rights and third-party notices

Project source, bundled datasets, dependencies and hosted map services have separate terms. The repository currently has no top-level software license. The team needs to confirm copyright ownership and agree on a license before offering general reuse rights for project code.

| Material | Terms and attribution | Action for distribution |
| --- | --- | --- |
| OpenStreetMap footprints, roads, water and green areas | Credit © OpenStreetMap contributors and identify ODbL 1.0. [Copyright and license](https://www.openstreetmap.org/copyright). | Retain credit in maps, exports and bundled data. Assess the merged scene and OSM-derived voxel package for derivative database and offer obligations. |
| Google Open Buildings 2.5D Temporal heights | Upstream offers CC BY 4.0 or ODbL 1.0. The current scene manifest records CC BY 4.0 for heights. [Dataset FAQ](https://sites.research.google/gr/open-buildings/temporal/). | Credit Google, identify the selected license and describe height sampling and modifications. Review the combined scene before distribution. |
| EDGAR v8.1 2022 road transport PM2.5 | Credit European Commission, Joint Research Centre, and link the dataset. [Data use conditions](https://edgar.jrc.ec.europa.eu/dataset_ap81). | Verify the exact archive and terms for the derived NetCDF. Keep archive URL, sector and transformation metadata. |
| Open-Meteo historical inputs | API data are offered under CC BY 4.0. [Data license](https://open-meteo.com/en/license). | Credit Open-Meteo and applicable upstream providers. Describe aggregation and preserve the source period. |
| OpenFreeMap and fallback basemaps | Preserve source-specific credits for tiles and screenshots. [OpenFreeMap](https://openfreemap.org/). | Review each tile provider's conditions separately before bundling or caching tiles for distribution. |
| Bootstrap Icons | Preserve the [vendored license](../web/vendor/bootstrap-icons/LICENSE). | Include the notice with bundled CSS and fonts. |
| Runtime libraries and base images | Versions are pinned in the lockfiles or referenced in HTML and Docker configuration. | Inventory npm, Python, browser assets and container packages from the actual release. Include their license and notice files where required. |

The [scene manifest](../db/seeds/scene/scene_manifest.json) and [demo input manifest](../deploy/demo-inputs/manifest.json) identify the packaged sources and checksums. Keep unresolved permissions visible in the release review. Lecture PDFs are references for the course mapping and are kept outside the repository.
