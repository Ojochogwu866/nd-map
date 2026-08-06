// GET /api/risk?lat=4.77&lon=7.01 — reads the same static data files the map UI fetches.

const GRID_BBOX = { lonMin: 4.0, latMin: 3.5, lonMax: 9.99, latMax: 6.99 };

const CORS_HEADERS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, OPTIONS',
};

function tierFromCRS(crs) {
	if (crs >= 0.75) return 'critical';
	if (crs >= 0.5) return 'high';
	if (crs >= 0.25) return 'medium';
	return 'low';
}

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

async function fetchJSON(env, request, path) {
	const url = new URL(path, request.url);
	const res = await env.ASSETS.fetch(new Request(url));
	if (!res.ok) throw new Error(`failed to load ${path}: ${res.status}`);
	return res.json();
}

function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json',
			'cache-control': 'public, max-age=3600',
			...CORS_HEADERS,
		},
	});
}

export async function onRequestGet(context) {
	const { request, env } = context;
	const url = new URL(request.url);
	const lat = parseFloat(url.searchParams.get('lat'));
	const lon = parseFloat(url.searchParams.get('lon'));

	if (Number.isNaN(lat) || Number.isNaN(lon)) {
		return json(
			{ error: 'lat and lon query parameters are required and must be numeric' },
			400
		);
	}

	if (
		lon < GRID_BBOX.lonMin ||
		lon > GRID_BBOX.lonMax ||
		lat < GRID_BBOX.latMin ||
		lat > GRID_BBOX.latMax
	) {
		return json({
			lat,
			lon,
			covered: false,
			note: 'Outside model coverage area (grid spans lon 4-10E, lat 3.5-7N).',
		});
	}

	let lookup;
	try {
		lookup = await fetchJSON(env, request, '/data/export/risk_lookup.json');
	} catch (err) {
		return json({ error: 'risk lookup data unavailable' }, 502);
	}

	const col = Math.round((lon - lookup.lon_min) / lookup.res);
	const row = Math.round((lat - lookup.lat_min) / lookup.res);
	const inBounds = col >= 0 && col < lookup.cols && row >= 0 && row < lookup.rows;
	const crs = inBounds ? lookup.crs[row * lookup.cols + col] : null;

	if (crs == null) {
		return json({ lat, lon, covered: false, note: 'No grid cell at this location.' });
	}

	const [pts, spills] = await Promise.all([
		fetchJSON(env, request, '/data/export/risk_points.geojson'),
		fetchJSON(env, request, '/data/export/spills.geojson'),
	]);

	let nearest = null;
	let nearestDist = Infinity;
	for (const f of pts.features) {
		const [flon, flat] = f.geometry.coordinates;
		const d = distKm(lat, lon, flat, flon);
		if (d < nearestDist) {
			nearestDist = d;
			nearest = f;
		}
	}

	const nearbySpills = spills.features.reduce((n, f) => {
		const [flon, flat] = f.geometry.coordinates;
		if (Math.abs(flon - lon) > 0.3 || Math.abs(flat - lat) > 0.3) return n;
		return distKm(lat, lon, flat, flon) <= 15 ? n + 1 : n;
	}, 0);

	return json({
		lat,
		lon,
		covered: true,
		crs: Math.round(crs * 1000) / 1000,
		risk_tier: tierFromCRS(crs),
		dominant_pathway: 'tph',
		nearby_spills_15km: nearbySpills,
		nearest_sample:
			nearest && nearestDist <= 60
				? {
						distance_km: Math.round(nearestDist * 10) / 10,
						risk_tier: nearest.properties.risk_tier,
						crs: nearest.properties.crs,
					}
				: null,
		sources: [
			'NOSDRA Oil Spill Monitor (oilspillmonitor.ng)',
			'UNEP Environmental Assessment of Ogoniland (2011)',
			'Peer-reviewed literature (P01-P09, 2009-2026)',
		],
	});
}

export async function onRequestOptions() {
	return new Response(null, { headers: CORS_HEADERS });
}
