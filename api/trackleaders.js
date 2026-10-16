// Trackleaders proxy for the live tracking page (tracking.html).
// The browser can't read Trackleaders directly (no CORS headers), so this
// fetches the race's undocumented mainpoints.js feed server side and returns it.
//
//   /api/trackleaders?race=megamidsouth26f            -> raw mainpoints.js text
//   /api/trackleaders?race=megamidsouth26f&page=1     -> the race's .php page (debug)
//
// Only a short slug of letters and digits is accepted, so this can't be used
// to fetch arbitrary URLs. Responses are cached at the edge for 60 seconds so
// many viewers don't hammer Trackleaders.

const SLUG = /^[a-z0-9]{3,40}$/i;

export default async function handler(req, res) {
  const race = String((req.query && req.query.race) || '');
  if (!SLUG.test(race)) {
    res.status(400).json({ error: 'Bad race slug' });
    return;
  }

  const url = req.query.page
    ? `https://trackleaders.com/${race}.php`
    : `https://trackleaders.com/spot/${race}/mainpoints.js`;

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; runstw.com live tracker)',
        'Referer': `https://trackleaders.com/${race}.php`,
      },
    });
    const body = await r.text();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.status(r.ok ? 200 : 502).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach Trackleaders' });
  }
}
