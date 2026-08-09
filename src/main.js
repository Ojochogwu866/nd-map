import mapboxgl from 'mapbox-gl';
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';
import './style.css';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const DATA_URL = import.meta.env.VITE_DATA_URL || '/data/export';

// Bounding box of the scored grid.
const GRID_BBOX = [4.0, 3.5, 9.99, 6.99];

mapboxgl.accessToken = TOKEN;

const map = new mapboxgl.Map({
	container: 'map',
	style: 'mapbox://styles/mapbox/dark-v11',
	center: [6.5, 5.0],
	zoom: 7,
	minZoom: 5,
	maxZoom: 14,
});

const geocoder = new MapboxGeocoder({
	accessToken: TOKEN,
	mapboxgl,
	marker: true,
	bbox: GRID_BBOX,
	placeholder: 'Search a place in the Niger Delta…',
});
map.addControl(geocoder, 'top-left');

map.addControl(
	new mapboxgl.NavigationControl({ showCompass: false }),
	'top-left'
);

const tooltip = document.getElementById('tooltip');

function showTooltip(e, html) {
	tooltip.innerHTML = html;
	tooltip.style.display = 'block';
	moveTooltip(e);
}

function moveTooltip(e) {
	const x = e.point.x + 14;
	const y = e.point.y - 10;
	tooltip.style.left = x + 'px';
	tooltip.style.top = y + 'px';
}

function hideTooltip() {
	tooltip.style.display = 'none';
}

function tierColor(tier) {
	return (
		{ critical: '#FF1744', high: '#FF6D00', medium: '#FFD600', low: '#69F0AE' }[
			tier
		] || '#666'
	);
}

function fmt(val, dp = 3) {
	return val != null ? Number(val).toFixed(dp) : '—';
}

function fmtCompact(val) {
	return val != null
		? new Intl.NumberFormat('en', {
				notation: 'compact',
				maximumFractionDigits: 2,
			}).format(val)
		: '—';
}

function tierFromCRS(crs) {
	if (crs >= 0.75) return 'critical';
	if (crs >= 0.5) return 'high';
	if (crs >= 0.25) return 'medium';
	return 'low';
}

// Haversine distance in km.
function distKm(lat1, lon1, lat2, lon2) {
	const R = 6371;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

let riskLookup = null;
let riskPointsData = null;
let spillsData = null;

async function loadRiskBriefData() {
	try {
		const [lookupRes, ptsRes, spillsRes] = await Promise.all([
			fetch(`${DATA_URL}/risk_lookup.json`),
			fetch(`${DATA_URL}/risk_points.geojson`),
			fetch(`${DATA_URL}/spills.geojson`),
		]);
		if (!lookupRes.ok || !ptsRes.ok || !spillsRes.ok) {
			throw new Error('risk brief data fetch failed');
		}
		riskLookup = await lookupRes.json();
		riskPointsData = (await ptsRes.json()).features;
		spillsData = (await spillsRes.json()).features;
	} catch (err) {
		riskLookup = null;
		riskPointsData = null;
		spillsData = null;
	}
}

function lookupRisk(lon, lat) {
	if (!riskLookup) return null;
	const { lon_min, lat_min, res, cols, rows, crs } = riskLookup;
	const col = Math.round((lon - lon_min) / res);
	const row = Math.round((lat - lat_min) / res);
	if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
	const value = crs[row * cols + col];
	return { crs: value, tier: tierFromCRS(value) };
}

function nearestSamplePoint(lon, lat, maxKm = 60) {
	if (!riskPointsData) return null;
	let best = null;
	let bestDist = Infinity;
	for (const f of riskPointsData) {
		const [flon, flat] = f.geometry.coordinates;
		const d = distKm(lat, lon, flat, flon);
		if (d < bestDist) {
			bestDist = d;
			best = f;
		}
	}
	if (!best || bestDist > maxKm) return null;
	return { distanceKm: bestDist, properties: best.properties };
}

function nearbySpillCount(lon, lat, radiusKm = 15) {
	if (!spillsData) return 0;
	let count = 0;
	for (const f of spillsData) {
		const [flon, flat] = f.geometry.coordinates;
		if (Math.abs(flon - lon) > 0.3 || Math.abs(flat - lat) > 0.3) continue;
		if (distKm(lat, lon, flat, flon) <= radiusKm) count++;
	}
	return count;
}

function showRiskBrief(placeName, lon, lat) {
	const placeEl = document.getElementById('risk-brief-place');
	const bodyEl = document.getElementById('risk-brief-body');
	placeEl.textContent = placeName;

	if (!riskLookup) {
		bodyEl.innerHTML = `<div class="rb-note">Risk data failed to load. Try reloading the page.</div>`;
		document.getElementById('risk-brief').classList.add('is-open');
		return;
	}

	const risk = lookupRisk(lon, lat);
	if (!risk) {
		bodyEl.innerHTML = `<div class="rb-note">Outside model coverage area (grid spans lon 4–10°E, lat 3.5–7°N).</div>`;
		document.getElementById('risk-brief').classList.add('is-open');
		return;
	}

	const sample = nearestSamplePoint(lon, lat);
	const spillCount = nearbySpillCount(lon, lat);

	const rows = [
		['Nearby spills (15km)', String(spillCount)],
		[
			'Nearest sample',
			sample
				? `${fmt(sample.distanceKm, 1)} km — ${(sample.properties.risk_tier || '—').toUpperCase()}`
				: 'none within 60km',
		],
		['Dominant pathway', 'Hydrocarbon load (TPH)'],
	];

	bodyEl.innerHTML = `
    <div class="tt-tier" style="color:${tierColor(risk.tier)}">${risk.tier.toUpperCase()}</div>
    <div class="tt-row"><span class="tt-key">CRS</span><span>${fmt(risk.crs)}</span></div>
    ${rows.map(([k, v]) => `<div class="tt-row"><span class="tt-key">${k}</span><span>${v}</span></div>`).join('')}
    ${
			!sample
				? '<div class="rb-note">No ground-truth sample within 60km — treat this score as a lower-confidence extrapolation.</div>'
				: ''
		}
  `;
	document.getElementById('risk-brief').classList.add('is-open');
}

function setupRiskBrief() {
	document.getElementById('risk-brief-close').addEventListener('click', () => {
		document.getElementById('risk-brief').classList.remove('is-open');
	});

	geocoder.on('result', (e) => {
		const [lon, lat] = e.result.center;
		showRiskBrief(e.result.place_name, lon, lat);
	});

	geocoder.on('clear', () => {
		document.getElementById('risk-brief').classList.remove('is-open');
	});
}

function showDataUnavailable() {
	document.getElementById('stats').innerHTML =
		'<div class="panel-note">Model stats unavailable.</div>';
	document.getElementById('exposure-value').textContent = '—';
	document.getElementById('exposure-label').textContent =
		'population data unavailable';
	document.getElementById('exposure-stats').innerHTML =
		'<div class="panel-note">Population data unavailable.</div>';
}

async function loadMeta() {
	let res, meta;
	try {
		res = await fetch(`${DATA_URL}/metadata.json`);
		if (!res.ok) throw new Error(`metadata.json: ${res.status}`);
		meta = await res.json();
	} catch (err) {
		showDataUnavailable();
		return;
	}

	const stats = document.getElementById('stats');

	const rows = [
		['HI', meta.model_metrics?.hi?.note ? 'computed, not modelled' : '—'],
		['TPH AUC', fmt(meta.model_metrics?.tph?.roc_auc_cv)],
		['Metal RMSE', fmt(meta.model_metrics?.metal?.rmse_cv)],
		['MAE', fmt(meta.validation?.sloocv_mae)],
		['Coverage', fmt(meta.validation?.coverage_probability)],
	];

	stats.innerHTML = rows
		.map(
			([k, v]) => `
    <div class="stat-row">
      <span class="stat-key">${k}</span>
      <span class="stat-val">${v}</span>
    </div>
  `
		)
		.join('');

	const exposure = meta.population_exposure;
	if (exposure?.population_by_tier) {
		const byTier = exposure.population_by_tier;
		const critHigh = (byTier.critical || 0) + (byTier.high || 0);

		document.getElementById('exposure-value').textContent =
			fmtCompact(critHigh);
		document.getElementById('exposure-label').textContent =
			'people live in critical or high-risk cells';

		const expRows = [
			['Critical', fmtCompact(byTier.critical)],
			['High', fmtCompact(byTier.high)],
			['Medium', fmtCompact(byTier.medium)],
			['Total (grid)', fmtCompact(exposure.total_population_in_grid_extent)],
		];
		document.getElementById('exposure-stats').innerHTML = expRows
			.map(
				([k, v]) => `
      <div class="stat-row">
        <span class="stat-key">${k}</span>
        <span class="stat-val">${v}</span>
      </div>
    `
			)
			.join('');
	}
}

const CRITICAL_SOURCES = new Set(['grid', 'hotspots', 'spills', 'points']);
const pendingSources = new Set(CRITICAL_SOURCES);

function hideLoadState() {
	document.getElementById('load-state').classList.add('is-hidden');
}

function showLoadError(message) {
	const el = document.getElementById('load-state');
	document.getElementById('load-state-error-text').textContent = message;
	el.setAttribute('role', 'alert');
	el.classList.add('is-error');
	el.classList.remove('is-hidden');
}

map.on('sourcedata', (e) => {
	if (e.isSourceLoaded && pendingSources.has(e.sourceId)) {
		pendingSources.delete(e.sourceId);
		if (pendingSources.size === 0) hideLoadState();
	}
});

map.on('error', (e) => {
	if (e.sourceId && CRITICAL_SOURCES.has(e.sourceId)) {
		showLoadError('Risk data failed to load.');
	}
});

document.getElementById('load-state-retry').addEventListener('click', () => {
	location.reload();
});

map.on('load', () => {
	loadMeta();
	loadRiskBriefData().then(setupYearSlider);
	setupRiskBrief();

	map.addSource('grid', {
		type: 'geojson',
		data: `${DATA_URL}/risk_grid.geojson`,
	});

	map.addLayer({
		id: 'grid-fill',
		type: 'fill',
		source: 'grid',
		paint: {
			'fill-color': ['get', 'colour'],
			'fill-opacity': 0.7,
			'fill-outline-color': 'rgba(10, 15, 13, 0.4)',
		},
	});

	map.addSource('hotspots', {
		type: 'geojson',
		data: `${DATA_URL}/hotspots.geojson`,
	});

	map.addLayer({
		id: 'hotspots-fill',
		type: 'fill',
		source: 'hotspots',
		paint: {
			'fill-color': ['get', 'colour'],
			'fill-opacity': 0.9,
			'fill-outline-color': '#0a0a0a',
		},
	});

	map.addSource('spills', {
		type: 'geojson',
		data: `${DATA_URL}/spills.geojson`,
		cluster: true,
		clusterMaxZoom: 10,
		clusterRadius: 40,
	});

	map.addLayer({
		id: 'spills-cluster',
		type: 'circle',
		source: 'spills',
		filter: ['has', 'point_count'],
		paint: {
			'circle-radius': ['step', ['get', 'point_count'], 10, 50, 14, 200, 18],
			'circle-color': '#6861e3',
			'circle-opacity': 0.7,
		},
		layout: { visibility: 'none' },
	});

	map.addLayer({
		id: 'spills-cluster-count',
		type: 'symbol',
		source: 'spills',
		filter: ['has', 'point_count'],
		layout: {
			'text-field': '{point_count_abbreviated}',
			'text-size': 14,
			'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
			visibility: 'none',
		},
		paint: { 'text-color': '#fff' },
	});

	map.addLayer({
		id: 'spills-point',
		type: 'circle',
		source: 'spills',
		filter: ['!', ['has', 'point_count']],
		paint: {
			'circle-radius': 4,
			'circle-color': '#6861e3',
			'circle-opacity': 0.8,
			'circle-stroke-width': 1,
			'circle-stroke-color': '#0a0a0a',
		},
		layout: { visibility: 'none' },
	});

	map.addSource('points', {
		type: 'geojson',
		data: `${DATA_URL}/risk_points.geojson`,
	});

	map.addLayer({
		id: 'points-circle',
		type: 'circle',
		source: 'points',
		paint: {
			'circle-radius': 6,
			'circle-color': ['get', 'colour'],
			'circle-stroke-width': 1.5,
			'circle-stroke-color': '#0a0a0a',
		},
		layout: { visibility: 'none' },
	});

	setupInteractions();
	setupToggles();
});

function setupInteractions() {
	map.on('mousemove', 'grid-fill', (e) => {
		const p = e.features[0].properties;
		const tier = p.risk_tier || '—';
		showTooltip(
			e,
			`
      <div class="tt-tier" style="color:${tierColor(tier)}">${tier.toUpperCase()}</div>
      <div class="tt-row"><span class="tt-key">CRS</span><span>${fmt(p.crs)}</span></div>
      <div class="tt-row"><span class="tt-key">CI width</span><span>${fmt(p.ci_width)}</span></div>
    `
		);
	});
	map.on('mouseleave', 'grid-fill', hideTooltip);
	map.on('mousemove', 'grid-fill', moveTooltip);

	map.on('mousemove', 'hotspots-fill', (e) => {
		const p = e.features[0].properties;
		const tier = p.risk_tier || '—';
		showTooltip(
			e,
			`
      <div class="tt-tier" style="color:${tierColor(tier)}">${tier.toUpperCase()}</div>
      <div class="tt-row"><span class="tt-key">CRS</span><span>${fmt(p.crs)}</span></div>
    `
		);
	});
	map.on('mouseleave', 'hotspots-fill', hideTooltip);
	map.on('mousemove', 'hotspots-fill', moveTooltip);

	map.on('mousemove', 'spills-point', (e) => {
		const p = e.features[0].properties;
		showTooltip(
			e,
			`<div class="tt-row"><span class="tt-key">Company</span><span>${p.company || '—'}</span></div>
      <div class="tt-row"><span class="tt-key">Date</span><span>${p.spill_date?.slice(0, 10) || '—'}</span></div>
      <div class="tt-row"><span class="tt-key">Volume</span><span>${p.volume_bbls ? Math.round(p.volume_bbls) + ' bbls' : '—'}</span></div>
      <div class="tt-row"><span class="tt-key">Cause</span><span>${p.cause || '—'}</span></div>
    `
		);
	});
	map.on('mouseleave', 'spills-point', hideTooltip);
	map.on('mousemove', 'spills-point', moveTooltip);

	map.on('mousemove', 'points-circle', (e) => {
		const p = e.features[0].properties;
		const tier = p.risk_tier || '—';
		showTooltip(
			e,
			`
      <div class="tt-tier" style="color:${tierColor(tier)}">${tier.toUpperCase()}</div>
      <div class="tt-row"><span class="tt-key">CRS</span><span>${fmt(p.crs)}</span></div>
      <div class="tt-row"><span class="tt-key">HI</span><span>${fmt(p.hi_score)}</span></div>
      <div class="tt-row"><span class="tt-key">TPH</span><span>${fmt(p.tph_score)}</span></div>
      <div class="tt-row"><span class="tt-key">Metal</span><span>${fmt(p.metal_score)}</span></div>
    `
		);
	});
	map.on('mouseleave', 'points-circle', hideTooltip);
	map.on('mousemove', 'points-circle', moveTooltip);

	const hoverLayers = [
		'grid-fill',
		'hotspots-fill',
		'spills-point',
		'points-circle',
	];
	hoverLayers.forEach((id) => {
		map.on(
			'mouseenter',
			id,
			() => (map.getCanvas().style.cursor = 'crosshair')
		);
		map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
	});

	map.on('click', 'spills-cluster', (e) => {
		const features = map.queryRenderedFeatures(e.point, {
			layers: ['spills-cluster'],
		});
		const id = features[0].properties.cluster_id;
		map.getSource('spills').getClusterExpansionZoom(id, (err, zoom) => {
			if (err) return;
			map.easeTo({ center: features[0].geometry.coordinates, zoom });
		});
	});
}

function setupYearSlider() {
	if (!spillsData || spillsData.length === 0) return;

	const years = spillsData
		.map((f) => f.properties.year)
		.filter((y) => y != null);
	if (years.length === 0) return;
	const minYear = Math.min(...years);
	const maxYear = Math.max(...years);

	const slider = document.getElementById('year-slider');
	const valueEl = document.getElementById('year-slider-value');
	slider.min = minYear;
	slider.max = maxYear;
	slider.value = maxYear;
	valueEl.textContent = maxYear;

	// setData re-clusters; a layer filter alone wouldn't update cluster counts.
	let debounceTimer = null;
	const applyYearFilter = (year) => {
		const source = map.getSource('spills');
		if (!source) return;
		const atMax = year >= maxYear;
		const filtered = spillsData.filter((f) => {
			const y = f.properties.year;
			return atMax || (y != null && y <= year);
		});
		source.setData({ type: 'FeatureCollection', features: filtered });
	};

	slider.addEventListener('input', (e) => {
		const year = Number(e.target.value);
		valueEl.textContent = year;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => applyYearFilter(year), 60);
	});
}

function setupToggles() {
	const toggleMap = {
		'toggle-grid': ['grid-fill'],
		'toggle-hotspots': ['hotspots-fill'],
		'toggle-spills': ['spills-cluster', 'spills-cluster-count', 'spills-point'],
		'toggle-points': ['points-circle'],
	};

	Object.entries(toggleMap).forEach(([id, layers]) => {
		document.getElementById(id).addEventListener('change', (e) => {
			const vis = e.target.checked ? 'visible' : 'none';
			layers.forEach((l) => map.setLayoutProperty(l, 'visibility', vis));
		});
	});

	const uncertaintyColor = [
		'interpolate',
		['linear'],
		['coalesce', ['get', 'ci_width'], 0],
		0,
		'#29b6f6',
		0.15,
		'#7c4dff',
		0.3,
		'#d500f9',
	];

	document.getElementById('toggle-uncertainty').addEventListener('change', (e) => {
		const showUncertainty = e.target.checked;
		map.setPaintProperty(
			'grid-fill',
			'fill-color',
			showUncertainty ? uncertaintyColor : ['get', 'colour']
		);
		document.getElementById('legend-tiers').style.display = showUncertainty
			? 'none'
			: 'flex';
		document.getElementById('legend-uncertainty').style.display =
			showUncertainty ? 'flex' : 'none';
	});

	const panel = document.getElementById('panel');
	const panelBtn = document.getElementById('panel-btn');

	panelBtn.addEventListener('click', () => {
		panel.classList.toggle('is-open');
		panelBtn.classList.toggle('is-open');
	});
}
