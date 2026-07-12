const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVENTS_FILE = path.join(ROOT, 'data', 'events.json');
const TEMPLATE_FILE = path.join(ROOT, 'templates', 'event-template.html');
const EVENTS_DATA_DIR = path.join(ROOT, 'data', 'events');
const MANIFEST_FILE = path.join(EVENTS_DATA_DIR, '_manifest.json');
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

function absoluteUrl(src) {
  if (!src) return '';
  return /^https?:\/\//.test(src) ? src : SITE_URL + (src.startsWith('/') ? src : '/' + src);
}

// Static <head> SEO block baked into each generated page so crawlers get
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
    `    <link rel="icon" type="image/jpeg" href="assets/runstw-logo.jpg">`,
    `    <meta property="og:type" content="website">`,
    `    <meta property="og:url" content="${pageUrl}">`,
    `    <meta property="og:title" content="${escapeAttr(title)}">`,
    `    <meta property="og:description" content="${escapeAttr(description)}">`,
    `    <meta property="og:image" content="${escapeAttr(image)}">`,
  ].join('\n');

  // Google event rich results, only when a real date is set in the CMS
  if (event.eventDate) {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: event.eventTitle,
      startDate: event.eventDate,
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
      organizer: { '@type': 'Organization', name: 'Stillwater Trail and Road Runners', url: SITE_URL },
    };
    head += `\n    <script type="application/ld+json">${JSON.stringify(schema)}</script>`;
  }

  return head;
}

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

// Sitemap: static pages + every generated event page
const today = new Date().toISOString().slice(0, 10);
const sitemapUrls = ['', 'weekly-runs.html', 'contact.html', ...currentSlugs.map((s) => `${s}.html`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((u) => `  <url><loc>${SITE_URL}/${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(SITEMAP_FILE, sitemap);
console.log('Generated: sitemap.xml');

console.log('Done.');
