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

    jobs.sort((a, b) => new Date(b.postedDate) - new Date(a.postedDate));
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

    jobs.sort((a, b) => new Date(b.postedDate) - new Date(a.postedDate));
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

  // f_C=1337 = LinkedIn company, sortBy=DD = most recent, f_TPR=r2592000 = past month
  const baseUrl =
    'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search' +
    '?keywords=Senior+Software+Engineer&location=India&f_C=1337&sortBy=DD&f_TPR=r2592000';

  try {
    for (let start = 0; start < 100; start += 25) {
      const url = `${baseUrl}&start=${start}`;
      const html = await httpGet(url, {
        'User-Agent': 'Mozilla/5.0 (compatible; JobTracker/1.0)',
      });
      if (!html.includes('base-search-card')) break;

      const cards = html.split('data-entity-urn').slice(1);
      for (const card of cards) {
        const titleMatch = card.match(/base-search-card__title[^"]*"[^>]*>([^<]+)/);
        const linkMatch = card.match(/href="(https?:\/\/[^"]*linkedin\.com\/jobs\/view\/[^"?&]+)/);
        const locMatch = card.match(/job-search-card__location[^>]*>([^<]+)/);
        const companyMatch = card.match(/subtitle[\s\S]*?href="[^"]*company[^"]*"[^>]*>\s*([^<]+)/);
        const companyFallback = card.match(/base-search-card__subtitle[^>]*>[\s\S]*?(?:<[^>]*>)*\s*(\S[^<]+)/);
        const dateMatch = card.match(/datetime="([^"]+)"/);

        if (!titleMatch) continue;
        const title = titleMatch[1].trim();
        if (!matchesRoleFilter(title, 'linkedin')) continue;

        const company = (companyMatch ? companyMatch[1] : companyFallback ? companyFallback[1] : '').trim() || 'LinkedIn';
        allJobs.push({
          id: linkMatch ? linkMatch[1].split('/').pop() : `li-${allJobs.length}`,
          title,
          url: linkMatch ? linkMatch[1] : '#',
          location: locMatch ? locMatch[1].trim() : 'India',
          department: company,
          type: 'Full time',
          postedDate: dateMatch ? dateMatch[1] : new Date().toISOString(),
        });
      }

      // Small delay between pages
      await new Promise((r) => setTimeout(r, 500));
    }

    allJobs.sort((a, b) => new Date(b.postedDate) - new Date(a.postedDate));
    console.log(`[LinkedIn] Found ${allJobs.length} matching India roles`);
    return allJobs;
  } catch (err) {
    console.error('[LinkedIn] Error:', err.message);
    return allJobs;
  }
}

// ─── LinkedIn Easy Apply ───

function parseLinkedInCards(html) {
  const results = [];
  const cards = html.split('data-entity-urn').slice(1);
  for (const card of cards) {
    const titleMatch = card.match(/base-search-card__title[^"]*"[^>]*>([^<]+)/);
    const linkMatch = card.match(/href="(https?:\/\/[^"]*linkedin\.com\/jobs\/view\/[^"?&]+)/);
    const locMatch = card.match(/job-search-card__location[^>]*>([^<]+)/);
    const companyMatch = card.match(/subtitle[\s\S]*?href="[^"]*company[^"]*"[^>]*>\s*([^<]+)/);
    const companyFallback = card.match(/base-search-card__subtitle[^>]*>[\s\S]*?(?:<[^>]*>)*\s*(\S[^<]+)/);
    const dateMatch = card.match(/datetime="([^"]+)"/);

    if (!titleMatch) continue;
    const title = titleMatch[1].trim();
    const company = (companyMatch ? companyMatch[1] : companyFallback ? companyFallback[1] : '').trim() || '—';
    const jobId = linkMatch ? linkMatch[1].split('/').pop() : null;

    results.push({
      id: jobId || `li-${results.length}`,
      title,
      url: linkMatch ? linkMatch[1] : '#',
      location: locMatch ? locMatch[1].trim() : 'India',
      department: company,
      type: 'Easy Apply',
      postedDate: dateMatch ? dateMatch[1] : new Date().toISOString(),
    });
  }
  return results;
}

// ─── LinkedIn Easy Apply — All Companies (Sr. SWE search with f_AL=true) ───

// Companies that always redirect to their own career portals (never Easy Apply).
// LinkedIn's guest API ignores f_AL=true, so we filter these out ourselves.
const EXTERNAL_APPLY_COMPANIES = new Set([
  'microsoft', 'google', 'amazon', 'apple', 'meta', 'netflix',
  'uber', 'airbnb', 'stripe', 'spotify',
  'salesforce', 'oracle', 'ibm', 'intel', 'nvidia', 'amd', 'qualcomm',
  'adobe', 'sap', 'vmware', 'dell', 'cisco', 'hp', 'hpe',
  'goldman sachs', 'jpmorgan', 'morgan stanley', 'barclays', 'citi',
  'deloitte', 'mckinsey', 'bcg', 'accenture', 'kpmg', 'ey', 'pwc',
  'flipkart', 'walmart', 'paypal', 'visa', 'mastercard',
  'linkedin', 'booking.com', 'booking',
  'tcs', 'infosys', 'wipro', 'hcl', 'cognizant', 'capgemini',
  'thoughtworks', 'atlassian', 'databricks', 'snowflake', 'confluent',
  'servicenow', 'workday', 'intuit', 'autodesk', 'splunk',
  'swiggy', 'zomato', 'phonepe', 'paytm', 'cred', 'meesho',
  'samsung', 'sony', 'siemens', 'bosch',
]);

function isExternalApplyCompany(companyName) {
  if (!companyName) return false;
  const c = companyName.toLowerCase().trim();
  if (EXTERNAL_APPLY_COMPANIES.has(c)) return true;
  for (const known of EXTERNAL_APPLY_COMPANIES) {
    if (c.includes(known) || known.includes(c)) return true;
  }
  return false;
}

async function checkJobIsEasyApply(jobUrl) {
  try {
    const html = await httpGet(jobUrl, {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });
    if (html.includes('apply-link-offsite')) return false;
    return true;
  } catch {
    return true;
  }
}

async function fetchLinkedInEasyApplyAll() {
  console.log('[LinkedIn Easy Apply All] Fetching Sr. SWE across all companies...');
  const seen = new Set();
  const allJobs = [];

  // sortBy=DD = most recent, f_TPR=r2592000 = past month
  const base =
    'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search' +
    '?keywords=Senior+Software+Engineer&location=India&f_AL=true&sortBy=DD&f_TPR=r2592000';

  try {
    for (let start = 0; start < 200; start += 25) {
      const url = `${base}&start=${start}`;
      const html = await httpGet(url, {
        'User-Agent': 'Mozilla/5.0 (compatible; JobTracker/1.0)',
      });
      if (!html.includes('base-search-card')) break;

      const jobs = parseLinkedInCards(html);
      for (const job of jobs) {
        if (seen.has(job.id)) continue;
        if (!matchesRoleFilter(job.title, 'linkedin')) continue;
        seen.add(job.id);
        allJobs.push(job);
      }

      await new Promise((r) => setTimeout(r, 300));
    }
  } catch (err) {
    console.error('[LinkedIn Easy Apply All] Error:', err.message);
  }

  // Phase 1: Remove known external-apply companies
  const afterBlocklist = allJobs.filter((job) => {
    const company = job.department || '';
    if (isExternalApplyCompany(company)) {
      return false;
    }
    return true;
  });

  console.log(`[LinkedIn Easy Apply All] ${allJobs.length} raw → ${afterBlocklist.length} after blocklist filter`);

  // Phase 2: Verify remaining jobs by checking their detail pages (10 concurrent)
  const CONCURRENCY = 10;
  const verified = [];
  for (let i = 0; i < afterBlocklist.length; i += CONCURRENCY) {
    const batch = afterBlocklist.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (job) => {
        const isEasy = await checkJobIsEasyApply(job.url);
        return isEasy ? job : null;
      })
    );
    verified.push(...results.filter(Boolean));
    if (i + CONCURRENCY < afterBlocklist.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  verified.sort((a, b) => new Date(b.postedDate) - new Date(a.postedDate));

  console.log(`[LinkedIn Easy Apply All] ${afterBlocklist.length} after blocklist → ${verified.length} after page verification`);
  console.log(`[LinkedIn Easy Apply All] Total: ${verified.length} verified Easy Apply roles`);
  return verified;
}

// ─── Job Accumulation ───
// Merge new jobs into existing ones, keeping a 7-day rolling window.
// This ensures each run adds fresh jobs without losing recent ones.
const ROLLING_WINDOW_DAYS = 7;

function loadExistingJobs(outPath) {
  try {
    const raw = fs.readFileSync(outPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mergeJobs(existingJobs, freshJobs) {
  const byId = new Map();
  const cutoff = Date.now() - ROLLING_WINDOW_DAYS * 86400000;

  for (const job of existingJobs) {
    const posted = new Date(job.postedDate).getTime();
    if (posted >= cutoff) {
      byId.set(String(job.id), job);
    }
  }

  for (const job of freshJobs) {
    byId.set(String(job.id), job);
  }

  return [...byId.values()].sort(
    (a, b) => new Date(b.postedDate) - new Date(a.postedDate)
  );
}

// ─── Main ───
async function main() {
  console.log('Starting job fetch...', new Date().toISOString());

  const outPath = path.join(__dirname, '..', 'data', 'jobs.json');
  const existing = loadExistingJobs(outPath);

  const [salesforce, booking, linkedin, linkedinEasyAll] = await Promise.all([
    fetchSalesforce(),
    fetchBooking(),
    fetchLinkedIn(),
    fetchLinkedInEasyApplyAll(),
  ]);

  // Build a set of titles already covered by careers sections to mark Easy Apply dupes
  const careersTitles = new Set();
  for (const job of [...salesforce, ...booking, ...linkedin]) {
    careersTitles.add(job.title.toLowerCase().trim());
  }

  // Remove careers-section duplicates from Easy Apply All
  const easyAllDeduped = linkedinEasyAll.filter(
    (j) => !careersTitles.has(j.title.toLowerCase().trim())
  );

  console.log(`[Easy Apply All] ${linkedinEasyAll.length} raw → ${easyAllDeduped.length} after removing careers dupes`);

  // Merge fresh results with existing data (7-day rolling window)
  const prevCompanies = (existing && existing.companies) || {};
  const prev = (key) => (prevCompanies[key] && prevCompanies[key].jobs) || [];
  const mergedSalesforce = mergeJobs(prev('salesforce'), salesforce);
  const mergedBooking = mergeJobs(prev('booking'), booking);
  const mergedLinkedin = mergeJobs(prev('linkedin'), linkedin);
  const mergedEasyAll = mergeJobs(prev('linkedin_easy_all'), easyAllDeduped);

  console.log(`[Merge] Salesforce: ${salesforce.length} fresh → ${mergedSalesforce.length} total`);
  console.log(`[Merge] Booking: ${booking.length} fresh → ${mergedBooking.length} total`);
  console.log(`[Merge] LinkedIn: ${linkedin.length} fresh → ${mergedLinkedin.length} total`);
  console.log(`[Merge] Easy Apply: ${easyAllDeduped.length} fresh → ${mergedEasyAll.length} total`);

  const output = {
    fetchedAt: new Date().toISOString(),
    companies: {
      salesforce: {
        name: 'Salesforce',
        targetRole: 'Senior Member of Technical Staff (SMTS)',
        careersUrl: 'https://careers.salesforce.com/en/jobs/?country=India',
        jobs: mergedSalesforce,
      },
      booking: {
        name: 'Booking.com',
        targetRole: 'Senior Software Engineer',
        careersUrl: 'https://jobs.booking.com/booking/jobs?location=India',
        jobs: mergedBooking,
      },
      linkedin: {
        name: 'LinkedIn',
        targetRole: 'Senior Software Engineer',
        careersUrl:
          'https://www.linkedin.com/jobs/search/?f_C=1337&geoId=102713980',
        jobs: mergedLinkedin,
      },
      linkedin_easy_all: {
        name: 'LinkedIn Easy Apply',
        targetRole: 'Senior Software Engineer · All Companies · India',
        careersUrl:
          'https://www.linkedin.com/jobs/search/?keywords=Senior+Software+Engineer&location=India&f_AL=true',
        jobs: mergedEasyAll,
      },
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  const total = mergedSalesforce.length + mergedBooking.length + mergedLinkedin.length + mergedEasyAll.length;
  console.log(`\nDone. ${total} total roles in data/jobs.json`);
  console.log(`  Salesforce: ${mergedSalesforce.length}`);
  console.log(`  Booking.com: ${mergedBooking.length}`);
  console.log(`  LinkedIn: ${mergedLinkedin.length}`);
  console.log(`  LinkedIn Easy Apply (All): ${mergedEasyAll.length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
