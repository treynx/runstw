const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVENTS_FILE = path.join(ROOT, 'data', 'events.json');
const TEMPLATE_FILE = path.join(ROOT, 'templates', 'event-template.html');
const EVENTS_DATA_DIR = path.join(ROOT, 'data', 'events');
const MANIFEST_FILE = path.join(EVENTS_DATA_DIR, '_manifest.json');

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
  fs.writeFileSync(htmlPath, template);

  const jsonPath = path.join(EVENTS_DATA_DIR, `${slug}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(pageData, null, 2));

  console.log(`Generated: ${slug}.html`);
});

fs.writeFileSync(MANIFEST_FILE, JSON.stringify(currentSlugs, null, 2));

console.log('Done.');
