# Niger Delta Contamination Risk Model

Interactive map companion to the paper *A multi-pathway contamination risk model for Niger Delta communities: integrating hydrocarbon load, heavy metal exposure, and vegetation stress indices from heterogeneous observational data*. Built with Mapbox GL JS and Vite.

**Live map:** [research-map.ojochogwu.dev](https://research-map.ojochogwu.dev)
**Dataset:** [github.com/ojochogwu866/nd-data](https://github.com/ojochogwu866/nd-data)

## Layers

| Layer | Default | Description |
|---|---|---|
| Risk grid | on | 1 km² cells coloured by Composite Risk Score tier |
| Hotspots | on | High-density contamination clusters |
| Spill incidents | off | Historical spill points with clustering |
| Sample points | off | Field sample locations with per-analyte scores |

## Risk tiers

| Tier | CRS range | Colour |
|---|---|---|
| Critical | ≥ 0.75 | `#FF1744` |
| High | 0.50 – 0.74 | `#FF6D00` |
| Medium | 0.25 – 0.49 | `#FFD600` |
| Low | < 0.25 | `#69F0AE` |

## Setup

```bash
npm install
```

Create `.env.local`:

```
VITE_MAPBOX_TOKEN=pk.your_token_here
VITE_DATA_URL=/data/export
```

`VITE_DATA_URL` points to the directory serving the pipeline export files (`risk_grid.geojson`, `hotspots.geojson`, `spills.geojson`, `risk_points.geojson`, `metadata.json`). Defaults to `/data/export` if unset.

## Development

```bash
npm run dev
```

## Build

```bash
npm run build    # outputs to dist/
npm run preview  # preview the production build
```

## Data

GeoJSON files are produced by the [`pipeline`](../pipeline) package. Place the exported files under `public/data/export/` for local development, or set `VITE_DATA_URL` to a remote URL in production.
