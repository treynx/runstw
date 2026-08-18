const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVENTS_FILE = path.join(ROOT, 'data', 'events.json');
const TEMPLATE_FILE = path.join(ROOT, 'templates', 'event-template.html');
const EVENTS_DATA_DIR = path.join(ROOT, 'data', 'events');
const MANIFEST_FILE = path.join(EVENTS_DATA_DIR, '_manifest.json');
const HOMEPAGE_FILE = path.join(ROOT, 'data', 'homepage.json');
const WEEKLY_RUN_TEMPLATE_FILE = path.join(ROOT, 'templates', 'weekly-run-template.html');
const WEEKLY_MANIFEST_FILE = path.join(ROOT, 'data', '_weekly-runs-manifest.json');
const SITEMAP_FILE = path.join(ROOT, 'sitemap.xml');
const SITE_URL = 'https://runstw.com';

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&bull;/g, '•')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeAttr(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function absoluteUrl(src) {
  if (!src) return '';
  return /^https?:\/\//.test(src) ? src : SITE_URL + (src.startsWith('/') ? src : '/' + src);
}

// <-escape so no string can break out of an inline <script> block
const jsonForScript = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

// Lowest advertised price found in a race's pricing accordion(s), for
// structured-data "offers". Returns null if no dollar amount is found.
function extractStartingPrice(accordions) {
  const text = (accordions || []).map((a) => a.content || '').join(' ');
  const amounts = [...text.matchAll(/\$(\d+(?:\.\d{2})?)/g)].map((m) => parseFloat(m[1]));
  return amounts.length ? Math.min(...amounts) : null;
}

const TZ = 'America/Chicago';

// DST-aware UTC offset (e.g. "-05:00") for a given 'YYYY-MM-DD' date in Stillwater.
function chicagoOffset(dateStr) {
  const probe = new Date(dateStr + 'T12:00:00Z');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset', hour: 'numeric' }).formatToParts(probe);
  const tz = parts.find((p) => p.type === 'timeZoneName');
  const m = tz && /GMT([+-]\d+)/.exec(tz.value);
  const hours = m ? parseInt(m[1], 10) : -6;
  return `${hours < 0 ? '-' : '+'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
}

function isoDateTime(dateStr, time24) {
  return `${dateStr}T${time24}:00${chicagoOffset(dateStr)}`;
}

// Adds `minutes` to a 'HH:MM' time, rolling the date forward/back as needed.
function addMinutesToTime(dateStr, time24, minutes) {
  const [h, m] = time24.split(':').map(Number);
  let total = h * 60 + m + minutes;
  let dayOffset = 0;
  while (total >= 24 * 60) { total -= 24 * 60; dayOffset += 1; }
  while (total < 0) { total += 24 * 60; dayOffset -= 1; }
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return { date: d.toISOString().slice(0, 10), time: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` };
}

// The next `count` upcoming calendar dates (YYYY-MM-DD) matching a weekday.
function nextOccurrenceDates(dayNum, count) {
  const out = [];
  const winStart = new Date(); winStart.setHours(0, 0, 0, 0);
  for (let i = 0; out.length < count && i < 400; i++) {
    const d = new Date(winStart); d.setDate(winStart.getDate() + i);
    if (d.getDay() !== dayNum) continue;
    const pad = (n) => String(n).padStart(2, '0');
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return out;
}

// Google's Event rich results don't support a single recurring Event - each
// occurrence needs its own dated Event entry. Builds the next few for a run,
// keeping cancelled dates present (per Google's guidance) but marked EventCancelled.
function buildRunOccurrenceEvents(run, pageUrl, count = 4, durationMinutes = 90) {
  if (!run.time24 || run.dayNum === null) return [];
  const image = absoluteUrl(run.image);
  const description = stripHtml(run.about).slice(0, 300) || `${run.name} — a free weekly group run in Stillwater, OK.`;
  return nextOccurrenceDates(run.dayNum, count).map((dateStr) => {
    const cancelled = (run.cancellations || []).some((c) => c.date === dateStr);
    const relocation = (run.relocations || []).find((c) => c.date === dateStr);
    const end = addMinutesToTime(dateStr, run.time24, durationMinutes);
    return {
      '@type': 'Event',
      name: run.name,
      startDate: isoDateTime(dateStr, run.time24),
      endDate: isoDateTime(end.date, end.time),
      eventStatus: `https://schema.org/${cancelled ? 'EventCancelled' : 'EventScheduled'}`,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      isAccessibleForFree: true,
      description,
      image: image ? [image] : undefined,
      url: pageUrl,
      location: { '@type': 'Place', name: relocation ? relocation.location : run.location, address: { '@type': 'PostalAddress', addressLocality: 'Stillwater', addressRegion: 'OK', addressCountry: 'US' } },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: pageUrl },
      organizer: { '@type': 'Organization', name: 'Stillwater Trail and Road Runners', url: SITE_URL },
    };
  });
}

// Static <head> SEO block baked into each generated race page so crawlers get
// real titles/descriptions without executing the page's JavaScript.
function buildSeoHead(event) {
  const title = `${event.eventTitle} | STRR`;
  const description = stripHtml(event.eventInfo).slice(0, 155);
  const pageUrl = `${SITE_URL}/${event.slug}.html`;
  const image = absoluteUrl(event.bannerImage);

  let head = [
    `<title>${escapeAttr(title)}</title>`,
    `    <meta name="description" content="${escapeAttr(description)}">`,
    `    <link rel="canonical" href="${pageUrl}">`,
    `    <link rel="icon" href="/favicon.ico" sizes="48x48">`,
    `    <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png">`,
    `    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">`,
    `    <link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
    `    <meta property="og:type" content="website">`,
    `    <meta property="og:url" content="${pageUrl}">`,
    `    <meta property="og:title" content="${escapeAttr(title)}">`,
    `    <meta property="og:description" content="${escapeAttr(description)}">`,
    `    <meta property="og:image" content="${escapeAttr(image)}">`,
  ].join('\n');

  // Google event rich results, only when a real date is set in the CMS
  if (event.eventDate) {
    const price = extractStartingPrice(event.accordions);
    const endDate = event.eventEndDate || new Date(new Date(event.eventDate).getTime() + 6 * 60 * 60 * 1000).toISOString();
    const registerUrl = event.registerLink && event.registerLink !== '#' ? event.registerLink : pageUrl;
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: event.eventTitle,
      startDate: event.eventDate,
      endDate,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      eventStatus: 'https://schema.org/EventScheduled',
      description: description,
      image: [image],
      url: pageUrl,
      location: {
        '@type': 'Place',
        name: event.venue || 'Stillwater, Oklahoma',
        address: { '@type': 'PostalAddress', addressLocality: 'Stillwater', addressRegion: 'OK', addressCountry: 'US' },
      },
      offers: {
        '@type': 'Offer',
        url: registerUrl,
        price: price != null ? String(price) : '0',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
      organizer: { '@type': 'Organization', name: 'Stillwater Trail and Road Runners', url: SITE_URL },
    };
    head += `\n    <script type="application/ld+json">${JSON.stringify(schema)}</script>`;
  }

  return head;
}

// Static <head> SEO block for an individual weekly-run page, plus a
// standalone recurring-Event schema (this run is the page's primary entity).
function buildWeeklyRunSeoHead(run) {
  const title = `${run.name} | Weekly Run | STRR`;
  const description = stripHtml(run.about).slice(0, 155) || `Join us for ${run.name} in Stillwater, Oklahoma.`;
  const pageUrl = `${SITE_URL}/${run.slug}.html`;
  const image = absoluteUrl(run.image);

  let head = [
    `<title>${escapeAttr(title)}</title>`,
    `    <meta name="description" content="${escapeAttr(description)}">`,
    `    <link rel="canonical" href="${pageUrl}">`,
    `    <link rel="icon" href="/favicon.ico" sizes="48x48">`,
    `    <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png">`,
    `    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">`,
    `    <link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
    `    <meta property="og:type" content="website">`,
    `    <meta property="og:url" content="${pageUrl}">`,
    `    <meta property="og:title" content="${escapeAttr(title)}">`,
    `    <meta property="og:description" content="${escapeAttr(description)}">`,
    `    <meta property="og:image" content="${escapeAttr(image)}">`,
  ].join('\n');

  // Google's Event rich results require a dated startDate per occurrence -
  // list the next several actual dates rather than a recurrence rule.
  const events = buildRunOccurrenceEvents(run, pageUrl);
  if (events.length) {
    head += `\n    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': events })}</script>`;
  }

  return head;
}

const CLOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 3h6"/></svg>';
const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';

// --- 1. Generate race event pages from data/events.json ---
const events = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')).events;
const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');

if (!fs.existsSync(EVENTS_DATA_DIR)) {
  fs.mkdirSync(EVENTS_DATA_DIR, { recursive: true });
}

let manifest = [];
if (fs.existsSync(MANIFEST_FILE)) {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
}

const currentSlugs = events.map((e) => e.slug).filter(Boolean);

// Remove pages for events that were deleted from the registry
manifest.forEach((slug) => {
  if (!currentSlugs.includes(slug)) {
    const htmlPath = path.join(ROOT, `${slug}.html`);
    const jsonPath = path.join(EVENTS_DATA_DIR, `${slug}.json`);
    if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
    console.log(`Removed stale event page: ${slug}`);
  }
});

// Generate/update a page + data file for every event in the registry
events.forEach((event) => {
  const { slug, navLabel, homepageSubtitle, showOnHomepage, ...pageData } = event;

  if (!slug) {
    console.warn(`Skipping event with no slug: ${event.eventTitle || '(untitled)'}`);
    return;
  }

  const htmlPath = path.join(ROOT, `${slug}.html`);
  const pageHtml = template.replace('<title>Event | STRR</title>', buildSeoHead(event));
  fs.writeFileSync(htmlPath, pageHtml);

  const jsonPath = path.join(EVENTS_DATA_DIR, `${slug}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(pageData, null, 2));

  console.log(`Generated: ${slug}.html`);
});

fs.writeFileSync(MANIFEST_FILE, JSON.stringify(currentSlugs, null, 2));

// --- 2. Compute the weekly-run data shared by the individual run pages and the homepage bake ---
let runs = [];
let weeklyHome = null;
try {
  weeklyHome = JSON.parse(fs.readFileSync(HOMEPAGE_FILE, 'utf8'));
  const DAY_NUMS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

  function to24h(t) {
    const m = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(t || '');
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const ap = (m[3] || '').toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  runs = (weeklyHome.schedule || []).map((r) => ({
    name: r.event || '',
    slug: r.slug || '',
    type: r.type || '',
    venueLogo: r.venueLogo || '',
    image: r.image || '',
    dayNum: DAY_NUMS[String(r.day || '').trim().toLowerCase()] ?? null,
    dayName: r.day || '',
    time: r.time || '',
    time24: to24h(r.time),
    location: r.location || '',
    map: r.mapLink || '',
    lat: r.lat ? Number(r.lat) : null,
    lon: r.lon ? Number(r.lon) : null,
    about: r.description || '',
    cancellations: (r.cancellations || [])
      .map((c) => ({ date: String(c.date || '').slice(0, 10), reason: c.reason || '' }))
      .filter((c) => c.date),
    relocations: (r.relocations || [])
      .map((c) => ({ date: String(c.date || '').slice(0, 10), location: c.location || '', mapLink: c.mapLink || '' }))
      .filter((c) => c.date && c.location),
  })).filter((r) => r.name);
} catch (err) {
  console.warn('Could not read data/homepage.json for weekly runs:', err.message);
}

// --- 3. Generate an individual page for each weekly run ---
const currentRunSlugs = runs.map((r) => r.slug).filter(Boolean);

let weeklyManifest = [];
if (fs.existsSync(WEEKLY_MANIFEST_FILE)) {
  weeklyManifest = JSON.parse(fs.readFileSync(WEEKLY_MANIFEST_FILE, 'utf8'));
}

// Remove pages for runs that were deleted or renamed
weeklyManifest.forEach((slug) => {
  if (!currentRunSlugs.includes(slug)) {
    const htmlPath = path.join(ROOT, `${slug}.html`);
    if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
    console.log(`Removed stale weekly-run page: ${slug}`);
  }
});

if (currentRunSlugs.length && fs.existsSync(WEEKLY_RUN_TEMPLATE_FILE)) {
  const runTemplate = fs.readFileSync(WEEKLY_RUN_TEMPLATE_FILE, 'utf8');

  runs.forEach((run) => {
    if (!run.slug) {
      console.warn(`Skipping weekly run with no slug: ${run.name}`);
      return;
    }

    const chipHtml = run.venueLogo
      ? `<img class="run-logo" src="${escapeAttr(run.venueLogo)}" alt="${escapeAttr(run.location)} logo" loading="lazy" id="run-chip">`
      : (run.type ? `<span class="run-type" id="run-chip">${escapeHtml(run.type)}</span>` : '<span id="run-chip"></span>');

    const content = `<div class="run-top" id="run-top">
            <h2 style="font-size:1.5rem; font-weight:900; text-transform:uppercase;">${escapeHtml(run.name)}</h2>
            ${chipHtml}
        </div>
        <div id="run-when">
            <div class="ws-irow">${CLOCK_SVG}<div><span class="ws-big">${escapeHtml(run.dayName)}s &bull; ${escapeHtml(run.time)}</span></div></div>
            <div class="ws-irow">${PIN_SVG}<div><span class="ws-big">${run.map ? `<a href="${escapeAttr(run.map)}" target="_blank" rel="noopener">${escapeHtml(run.location)}</a>` : escapeHtml(run.location)}</span><div class="ws-subline">Stillwater, OK</div></div></div>
        </div>
        ${run.about ? `<p class="run-about">${escapeHtml(run.about)}</p>` : ''}
        <script>window.STRR_RUN = ${jsonForScript(run)};</script>`;

    let html = runTemplate.replace('<title>Weekly Run | STRR</title>', buildWeeklyRunSeoHead(run));
    html = html
      .replace('Weekly Run</h1>', `${escapeHtml(run.name)}</h1>`)
      .replace('id="run-banner"', `id="run-banner" style="background-image: linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), url('${escapeAttr(absoluteUrl(run.image))}');"`);

    const sIdx = html.indexOf('<!-- WEEKLY_RUN_CONTENT_START');
    const sCommentEnd = sIdx === -1 ? -1 : html.indexOf('-->', sIdx);
    const eIdx = html.indexOf('<!-- WEEKLY_RUN_CONTENT_END -->');
    if (sIdx !== -1 && sCommentEnd !== -1 && eIdx !== -1) {
      html = html.slice(0, sCommentEnd + 3) + '\n        ' + content + '\n        ' + html.slice(eIdx);
    }

    fs.writeFileSync(path.join(ROOT, `${run.slug}.html`), html);
    console.log(`Generated: ${run.slug}.html`);
  });
}

fs.writeFileSync(WEEKLY_MANIFEST_FILE, JSON.stringify(currentRunSlugs, null, 2));

// --- 4. Sitemap: static pages + every generated race page + every weekly-run page ---
const today = new Date().toISOString().slice(0, 10);
const sitemapUrls = [
  '', 'weekly-runs.html', 'contact.html', 'results.html',
  ...currentSlugs.map((s) => `${s}.html`),
  ...currentRunSlugs.map((s) => `${s}.html`),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((u) => `  <url><loc>${SITE_URL}/${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(SITEMAP_FILE, sitemap);
console.log('Generated: sitemap.xml');

// --- 5. Bake the homepage weekly schedule: crawlable fallback cards + live-widget data + schema ---
if (weeklyHome && runs.length) {
  try {
    const fallback = runs.map((r) => `            <div class="ws-card">
                <div class="ws-body">
                    <div class="ws-top"><span class="ws-name">${escapeHtml(r.name)}</span>${r.venueLogo ? `<img class="ws-logo" src="${escapeAttr(r.venueLogo)}" alt="${escapeAttr(r.location)} logo" loading="lazy">` : (r.type ? `<span class="ws-type">${escapeHtml(r.type)}</span>` : '')}</div>
                    <div class="ws-irow">${CLOCK_SVG}<div><span class="ws-big">${escapeHtml(r.dayName)}s &bull; ${escapeHtml(r.time)}</span></div></div>
                    <div class="ws-irow">${PIN_SVG}<div><span class="ws-big">${r.map ? `<a href="${escapeAttr(r.map)}" target="_blank" rel="noopener">${escapeHtml(r.location)}</a>` : escapeHtml(r.location)}</span><div class="ws-subline">Stillwater, OK</div></div></div>
                    ${r.about ? `<p class="ws-about">${escapeHtml(r.about)}</p>` : ''}
                </div>
            </div>`).join('\n');

    // Google's Event rich results require a dated startDate per occurrence -
    // list the next several actual dates for each run rather than a recurrence rule.
    const graph = [
      { '@type': 'SportsOrganization', '@id': `${SITE_URL}/#org`, name: 'Stillwater Trail and Road Runners', url: SITE_URL, areaServed: 'Stillwater, OK' },
      ...runs.flatMap((r) => buildRunOccurrenceEvents(r, r.slug ? `${SITE_URL}/${r.slug}.html` : `${SITE_URL}/weekly-runs.html`)),
    ];

    const lead = weeklyHome.weeklyIntro ? `        <p class="weekly-lead">${escapeHtml(weeklyHome.weeklyIntro.trim())}</p>\n` : '';
    const block = `\n${lead}        <script type="application/ld+json">${jsonForScript({ '@context': 'https://schema.org', '@graph': graph })}</script>\n        <script>window.STRR_SCHEDULE = ${jsonForScript(runs)};</script>\n        <div id="ws-list" aria-live="polite">\n${fallback}\n        </div>\n        `;

    const homeFile = path.join(ROOT, 'index.html');
    let html = fs.readFileSync(homeFile, 'utf8');
    const sIdx = html.indexOf('<!-- WEEKLY_SCHEDULE_START');
    const sCommentEnd = sIdx === -1 ? -1 : html.indexOf('-->', sIdx);
    const eIdx = html.indexOf('<!-- WEEKLY_SCHEDULE_END -->');
    if (sIdx !== -1 && sCommentEnd !== -1 && eIdx !== -1) {
      html = html.slice(0, sCommentEnd + 3) + block + html.slice(eIdx);
      fs.writeFileSync(homeFile, html);
      console.log('Baked: homepage weekly schedule');
    } else {
      console.warn('Homepage schedule markers not found; skipped');
    }
  } catch (err) {
    console.warn('Could not bake homepage schedule:', err.message);
  }
}

console.log('Done.');
