import mapboxgl from 'mapbox-gl';
import './style.css';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const DATA_URL = import.meta.env.VITE_DATA_URL || '/data/export';

mapboxgl.accessToken = TOKEN;

const map = new mapboxgl.Map({
	container: 'map',
	style: 'mapbox://styles/mapbox/dark-v11',
	center: [6.5, 5.0],
	zoom: 7,
	minZoom: 5,
	maxZoom: 14,
});

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

async function loadMeta() {
	const res = await fetch(`${DATA_URL}/metadata.json`);
	const meta = await res.json();
	const stats = document.getElementById('stats');

	const rows = [
		['HI AUC', fmt(meta.model_metrics?.hi?.roc_auc_cv)],
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
}

map.on('load', async () => {
	await loadMeta();

	map.addSource('grid', {
		type: 'geojson',
		data: `${DATA_URL}/risk_grid.geojson`,
	});

	map.addLayer({
		id: 'grid-fill',
		type: 'circle',
		source: 'grid',
		paint: {
			'circle-color': ['get', 'colour'],
			'circle-opacity': 0.7,
			'circle-radius': [
				'interpolate',
				['linear'],
				['zoom'],
				5,
				2,
				9,
				5,
				13,
				14,
			],
		},
	});

	map.addSource('hotspots', {
		type: 'geojson',
		data: `${DATA_URL}/hotspots.geojson`,
	});

	map.addLayer({
		id: 'hotspots-fill',
		type: 'circle',
		source: 'hotspots',
		paint: {
			'circle-color': ['get', 'colour'],
			'circle-opacity': 0.9,
			'circle-radius': [
				'interpolate',
				['linear'],
				['zoom'],
				5,
				5,
				9,
				10,
				13,
				22,
			],
			'circle-stroke-width': 1,
			'circle-stroke-color': '#0a0a0a',
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
}
