// Trackleaders proxy for the live tracking page (tracking.html).
// The browser can't read Trackleaders directly (no CORS headers), so this
// fetches the race's undocumented feed files server side and returns them.
//
//   /api/trackleaders?race=megamidsouth26                    -> spot/<race>/mainpoints.js
//   /api/trackleaders?race=megamidsouth26&file=sortlist.php  -> spot/<race>/sortlist.php
//
// Only short letter/digit slugs and a fixed list of file names are accepted,
// so this can't be used to fetch arbitrary URLs. Responses are cached at the
// edge so many viewers share one request to Trackleaders.

const SLUG = /^[a-z0-9]{3,40}$/i;
const FILES = {
  'mainpoints.js': 60,   // latest position of every racer
  'sortlist.php': 60,    // leaderboard table
  'sortlist.js': 60,
  'summary.php': 120,
  'route.js': 3600,      // course line, rarely changes
  'checkgen.js': 3600,   // checkpoints
};

export default async function handler(req, res) {
  const race = String((req.query && req.query.race) || '');
  const file = String((req.query && req.query.file) || 'mainpoints.js');
  if (!SLUG.test(race) || !(file in FILES)) {
    res.status(400).json({ error: 'Bad race or file' });
    return;
  }

  const url = `https://trackleaders.com/spot/${race}/${file}`;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; runstw.com live tracker)',
        'Referer': 'https://trackleaders.com/',
      },
    });
    const body = await r.text();
    const ttl = FILES[file];
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`);
    res.status(r.ok ? 200 : 502).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach Trackleaders' });
  }
}
