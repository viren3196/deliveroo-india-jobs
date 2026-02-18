#!/usr/bin/env node

/**
 * Fetches job listings from target companies and writes data/jobs.json.
 * Runs via GitHub Actions on a schedule, or manually.
 *
 * Sources:
 *   Salesforce  — RSS/XML feed (all jobs, filtered to India + SMTS roles)
 *   Booking.com — JSON API (iCIMS/Jibe, filtered to India + SWE roles)
 *   LinkedIn    — Guest HTML endpoint (parsed, filtered to SWE roles in India)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, headers).then(resolve, reject);
      }
      if (res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Strict role matching per company.
 * Only titles the user is actually targeting.
 */
function matchesRoleFilter(title, company) {
  const t = title.toLowerCase();

  switch (company) {
    case 'salesforce':
      // "Senior Member of Technical Staff" / "SMTS" only
      return /\bsmts\b/.test(t) || t.includes('senior member of technical staff');

    case 'booking':
      // "Senior Software Engineer" only (not plain SWE I/II, not Staff, not Architect)
      return /senior\s+software\s+engineer/i.test(title);

    case 'linkedin':
      // "Senior Software Engineer" / "Sr. Software Engineer" only (not Staff, not Principal)
      if (/\b(staff|principal|lead|manager|director)\b/i.test(title)) return false;
      return /\b(senior|sr\.?)\s+software\s+engineer/i.test(title);

    default:
      return false;
  }
}

// ─── Salesforce (RSS/XML) ───
async function fetchSalesforce() {
  console.log('[Salesforce] Fetching RSS feed...');
  const url = 'https://careers.salesforce.com/en/jobs/xml/?rss=true';

  try {
    const xml = await httpGet(url);
    const jobs = [];
    const jobBlocks = xml.split('<job>').slice(1);

    for (const block of jobBlocks) {
      const get = (tag) => {
        const m = block.match(new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]></${tag}>`));
        return m ? m[1].trim() : '';
      };

      const country = get('country');
      if (country !== 'India') continue;

      const title = get('title');
      if (!matchesRoleFilter(title, 'salesforce')) continue;

      jobs.push({
        id: get('requisitionid'),
        title,
        url: get('url'),
        location: [get('city'), get('state'), country].filter(Boolean).join(', '),
        department: get('category'),
        type: get('jobtype'),
        postedDate: get('date'),
      });
    }

    console.log(`[Salesforce] Found ${jobs.length} matching India roles`);
    return jobs;
  } catch (err) {
    console.error('[Salesforce] Error:', err.message);
    return [];
  }
}

// ─── Booking.com (JSON API) ───
async function fetchBooking() {
  console.log('[Booking.com] Fetching jobs API...');
  const url = 'https://jobs.booking.com/api/jobs?location=India&limit=100';

  try {
    const raw = await httpGet(url);
    const data = JSON.parse(raw);
    const jobs = [];
    for (const item of data.jobs || []) {
      const d = item.data || {};
      const title = d.title || '';
      if (!matchesRoleFilter(title, 'booking')) continue;

      jobs.push({
        id: d.req_id || d.slug,
        title,
        url: d.apply_url || `https://jobs.booking.com/booking/jobs/${d.slug}`,
        location: d.full_location || [d.city, d.state, d.country].filter(Boolean).join(', '),
        department: (d.category || []).map((c) => c.trim()).join(', ') || '—',
        type: d.employment_type || 'Full time',
        postedDate: d.posted_date || d.create_date,
      });
    }

    console.log(`[Booking.com] Found ${jobs.length} matching India roles`);
    return jobs;
  } catch (err) {
    console.error('[Booking.com] Error:', err.message);
    return [];
  }
}

// ─── LinkedIn (Guest HTML API) ───
async function fetchLinkedIn() {
  console.log('[LinkedIn] Fetching guest job listings...');
  const allJobs = [];

  // f_C=1337 = LinkedIn company
  const baseUrl =
    'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search' +
    '?keywords=Senior+Software+Engineer&location=India&f_C=1337';

  try {
    for (let start = 0; start < 100; start += 25) {
      const url = `${baseUrl}&start=${start}`;
      const html = await httpGet(url, {
        'User-Agent': 'Mozilla/5.0 (compatible; JobTracker/1.0)',
      });
      if (!html.includes('base-search-card')) break;

      // Parse job cards from HTML
      const cards = html.split('base-search-card__info').slice(1);
      for (const card of cards) {
        const titleMatch = card.match(/class="base-search-card__title[^"]*"[^>]*>([^<]+)/);
        const linkMatch = card.match(/href="(https?:\/\/[^"]*linkedin\.com\/jobs\/view\/[^"?]+)/);
        const locMatch = card.match(/job-search-card__location[^>]*>([^<]+)/);
        const companyMatch = card.match(/base-search-card__subtitle[^>]*>(?:<[^>]+>)*\s*([^<]+)/);

        if (!titleMatch) continue;
        const title = titleMatch[1].trim();
        if (!matchesRoleFilter(title, 'linkedin')) continue;

        allJobs.push({
          id: linkMatch ? linkMatch[1].split('/').pop() : `li-${allJobs.length}`,
          title,
          url: linkMatch ? linkMatch[1] : '#',
          location: locMatch ? locMatch[1].trim() : 'India',
          department: companyMatch ? companyMatch[1].trim() : 'LinkedIn',
          type: 'Full time',
          postedDate: new Date().toISOString(),
        });
      }

      // Small delay between pages
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log(`[LinkedIn] Found ${allJobs.length} matching India roles`);
    return allJobs;
  } catch (err) {
    console.error('[LinkedIn] Error:', err.message);
    return allJobs;
  }
}

// ─── Main ───
async function main() {
  console.log('Starting job fetch...', new Date().toISOString());

  const [salesforce, booking, linkedin] = await Promise.all([
    fetchSalesforce(),
    fetchBooking(),
    fetchLinkedIn(),
  ]);

  const output = {
    fetchedAt: new Date().toISOString(),
    companies: {
      salesforce: {
        name: 'Salesforce',
        targetRole: 'Senior Member of Technical Staff (SMTS)',
        careersUrl: 'https://careers.salesforce.com/en/jobs/?country=India',
        jobs: salesforce,
      },
      booking: {
        name: 'Booking.com',
        targetRole: 'Senior Software Engineer',
        careersUrl: 'https://jobs.booking.com/booking/jobs?location=India',
        jobs: booking,
      },
      linkedin: {
        name: 'LinkedIn',
        targetRole: 'Senior Software Engineer',
        careersUrl:
          'https://www.linkedin.com/jobs/search/?f_C=1337&geoId=102713980',
        jobs: linkedin,
      },
    },
  };

  const outPath = path.join(__dirname, '..', 'data', 'jobs.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  const total = salesforce.length + booking.length + linkedin.length;
  console.log(`\nDone. ${total} total matching roles written to data/jobs.json`);
  console.log(`  Salesforce: ${salesforce.length}`);
  console.log(`  Booking.com: ${booking.length}`);
  console.log(`  LinkedIn: ${linkedin.length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
