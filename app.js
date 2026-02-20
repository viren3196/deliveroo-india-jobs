(function () {
  'use strict';

  const CONFIG = {
    deliveroo: {
      API_BASE: 'https://careers.deliveroo.co.uk/wp-json/wp/v2',
      INDIA_LOCATION_ID: 411,
    },
    STATIC_DATA_URL: 'data/jobs.json',
    CACHE_KEY: 'job_radar_cache',
    SEEN_KEY: 'job_radar_seen_ids',
    TEAMS_CACHE_KEY: 'deliveroo_teams_map',
    PULL_THRESHOLD: 80,
  };

  // ─── DOM helpers ───
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  const dom = {
    refreshBtn: $('#refresh-btn'),
    pullIndicator: $('#pull-indicator'),
    template: $('#job-card-template'),
  };

  // ─── Cache ───
  const Cache = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); }
      catch { return null; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); }
      catch { /* full or unavailable */ }
    },
    getSeenIds() { return new Set(this.get(CONFIG.SEEN_KEY) || []); },
    updateSeenIds(ids) { this.set(CONFIG.SEEN_KEY, [...ids]); },
  };

  // ─── Utilities ───
  function decodeHTML(html) {
    const t = document.createElement('textarea');
    t.innerHTML = html;
    return t.value;
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', hour12: true,
    }).format(date);
  }

  const COMPANY_DOMAINS = {
    'deliveroo': 'deliveroo.co.uk',
    'salesforce': 'salesforce.com',
    'booking.com': 'booking.com',
    'booking': 'booking.com',
    'linkedin': 'linkedin.com',
    'microsoft': 'microsoft.com',
    'google': 'google.com',
    'amazon': 'amazon.com',
    'meta': 'meta.com',
    'apple': 'apple.com',
    'netflix': 'netflix.com',
    'uber': 'uber.com',
    'stripe': 'stripe.com',
    'airbnb': 'airbnb.com',
    'spotify': 'spotify.com',
    'adobe': 'adobe.com',
    'oracle': 'oracle.com',
    'ibm': 'ibm.com',
    'intel': 'intel.com',
    'nvidia': 'nvidia.com',
    'snap': 'snap.com',
    'twitter': 'x.com',
    'x': 'x.com',
    'atlassian': 'atlassian.com',
    'shopify': 'shopify.com',
    'databricks': 'databricks.com',
    'snowflake': 'snowflake.com',
    'cloudflare': 'cloudflare.com',
    'twilio': 'twilio.com',
    'roku': 'roku.com',
    'freshworks': 'freshworks.com',
    'porter': 'porter.in',
    'doordash': 'doordash.com',
    'csc': 'csc.com',
    'rippling': 'rippling.com',
    'zomato': 'zomato.com',
    'swiggy': 'swiggy.com',
    'flipkart': 'flipkart.com',
    'phonepe': 'phonepe.com',
    'razorpay': 'razorpay.com',
    'cred': 'cred.club',
    'meesho': 'meesho.com',
    'groww': 'groww.in',
    'zerodha': 'zerodha.com',
    'paytm': 'paytm.com',
    'epam systems': 'epam.com',
    'agoda': 'agoda.com',
    'uplers': 'uplers.com',
    'commonwealth bank': 'commbank.com.au',
    'cgi': 'cgi.com',
    'ups': 'ups.com',
    'symplr': 'symplr.com',
    'procore technologies': 'procore.com',
    'new relic': 'newrelic.com',
    'thomson reuters': 'thomsonreuters.com',
    'wells fargo': 'wellsfargo.com',
    'societe generale global solution centre': 'societegenerale.com',
    'vertafore': 'vertafore.com',
    'sonatype': 'sonatype.com',
    "moody's corporation": 'moodys.com',
    'eptura': 'eptura.com',
    'marriott tech accelerator': 'marriott.com',
    'coinbase': 'coinbase.com',
    'vendavo': 'vendavo.com',
    'warner bros. discovery': 'wbd.com',
    'expedia group': 'expediagroup.com',
    'hopper': 'hopper.com',
    'caterpillar inc.': 'caterpillar.com',
    's&p global': 'spglobal.com',
    'zendesk': 'zendesk.com',
    'atlan': 'atlan.com',
    'sprinklr': 'sprinklr.com',
    'healthedge': 'healthedge.com',
    'highspot': 'highspot.com',
    'nexthink': 'nexthink.com',
    'deutsche bank': 'db.com',
    'jumpcloud': 'jumpcloud.com',
    'anaplan': 'anaplan.com',
    'seismic': 'seismic.com',
    'five9': 'five9.com',
    'ericsson': 'ericsson.com',
    'simcorp': 'simcorp.com',
    'remitly': 'remitly.com',
    'lseg': 'lseg.com',
    'dhl': 'dhl.com',
    'crisil': 'crisil.com',
    'diligent': 'diligent.com',
    'sequoia': 'sequoia.com',
    'red hat': 'redhat.com',
    'palo alto networks': 'paloaltonetworks.com',
    'ebay': 'ebay.com',
    'makemytrip': 'makemytrip.com',
    'nagarro': 'nagarro.com',
    'nike': 'nike.com',
    'acceldata': 'acceldata.io',
    'metlife': 'metlife.com',
    'grab': 'grab.com',
    'emerson': 'emerson.com',
    'addepar': 'addepar.com',
    'inmobi advertising': 'inmobi.com',
    'sauce labs': 'saucelabs.com',
    'netapp': 'netapp.com',
    'okta for developers': 'okta.com',
    'forcepoint': 'forcepoint.com',
    'equinix': 'equinix.com',
    'icertis': 'icertis.com',
    'athenahealth': 'athenahealth.com',
    'zscaler': 'zscaler.com',
    'wolters kluwer': 'wolterskluwer.com',
    'elsevier': 'elsevier.com',
    'falconx': 'falconx.io',
    'bnp paribas': 'bnpparibas.com',
    'luxoft': 'luxoft.com',
    'fanatics': 'fanatics.com',
    'pepsico': 'pepsico.com',
    'trellix': 'trellix.com',
    'bloomberg': 'bloomberg.com',
    'cornerstone ondemand': 'cornerstoneondemand.com',
    'a.p. moller - maersk': 'maersk.com',
    'infineon technologies': 'infineon.com',
    'myntra': 'myntra.com',
    'toast': 'toasttab.com',
    'nxp semiconductors': 'nxp.com',
    'pegasystems': 'pega.com',
    'adyen': 'adyen.com',
    'thales': 'thalesgroup.com',
    'gartner': 'gartner.com',
    'delta air lines': 'delta.com',
    'fico': 'fico.com',
    'qualys': 'qualys.com',
    'payu': 'payu.in',
    'crunchyroll': 'crunchyroll.com',
    'yes bank': 'yesbank.in',
    'optum india': 'optum.com',
    'bread financial': 'breadfinancial.com',
    'couchbase': 'couchbase.com',
    'idfy': 'idfy.com',
    'foxsense innovations': 'foxsense.in',
    'cargill': 'cargill.com',
    'parspec': 'parspec.io',
    'blackline': 'blackline.com',
    'blackline india': 'blackline.com',
    'netsmart': 'ntst.com',
    'spoton': 'spoton.com',
    'skylo': 'skylo.tech',
    'valtech': 'valtech.com',
    'broadridge india': 'broadridge.com',
    'electrolux group': 'electroluxgroup.com',
    'wabtec corporation': 'wabteccorp.com',
  };

  function getLogoUrl(companyName) {
    if (!companyName) return '';
    const key = companyName.toLowerCase().trim();
    const domain = COMPANY_DOMAINS[key]
      || COMPANY_DOMAINS[key.split(/[\s,()-]+/)[0]]
      || `${key.replace(/[^a-z0-9]/g, '')}.com`;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  }

  function formatPostedDate(raw) {
    if (!raw) return '—';
    try {
      const d = new Date(raw);
      if (isNaN(d)) return '—';
      const now = Date.now();
      const diff = Math.floor((now - d.getTime()) / 86400000);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Yesterday';
      if (diff < 7) return `${diff}d ago`;
      if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
      return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(d);
    } catch { return '—'; }
  }

  // ─── LinkedIn Search Helpers ───
  const LINKEDIN_INDIA_GEO = '102713980';

  const LinkedInSearch = {
    candidateUrl(jobTitle) {
      const kw = encodeURIComponent(jobTitle);
      return `https://www.linkedin.com/search/results/people/?keywords=${kw}&geoUrn=%5B%22${LINKEDIN_INDIA_GEO}%22%5D&origin=GLOBAL_SEARCH_HEADER`;
    },
    referrerUrl(companyName) {
      const kw = encodeURIComponent(companyName);
      return `https://www.linkedin.com/search/results/people/?keywords=${kw}&geoUrn=%5B%22${LINKEDIN_INDIA_GEO}%22%5D&origin=GLOBAL_SEARCH_HEADER`;
    },
  };

  // ─── Section UI Controller ───
  const SECTION_COMPANY_MAP = {
    deliveroo: 'Deliveroo',
    salesforce: 'Salesforce',
    booking: 'Booking.com',
    linkedin: 'LinkedIn',
  };

  function sectionUI(company) {
    const sec = $(`[data-company="${company}"]`);
    return {
      loading: $(`[data-loading="${company}"]`, sec),
      error: $(`[data-error="${company}"]`, sec),
      empty: $(`[data-empty="${company}"]`, sec),
      list: $(`[data-jobs="${company}"]`, sec),
      count: $(`[data-count="${company}"]`),
      updated: $(`[data-updated="${company}"]`),
      retryBtn: $(`[data-retry="${company}"]`, sec),

      showState(state) {
        if (this.loading) this.loading.hidden = state !== 'loading';
        if (this.error) this.error.hidden = state !== 'error';
        if (this.empty) this.empty.hidden = state !== 'empty';
        this.list.hidden = state !== 'jobs';
      },

      renderJobs(jobs, seenIds) {
        this.list.innerHTML = '';
        if (!jobs.length) { this.showState('empty'); return; }

        const sectionCompany = SECTION_COMPANY_MAP[company];
        const isDeliveroo = company === 'deliveroo';
        const isEasyApply = company === 'linkedin_easy_all';

        this.showState('jobs');
        const frag = document.createDocumentFragment();
        jobs.forEach((job) => {
          const clone = dom.template.content.cloneNode(true);
          const link = $('.job-link', clone);
          const title = $('.job-title', clone);
          const badge = $('.new-badge', clone);
          const loc = $('.location-text', clone);
          const team = $('.team-text', clone);
          const dateEl = $('.date-text', clone);
          const logo = $('.company-logo', clone);

          const jobUrl = job.url || job.link || '#';
          link.href = jobUrl;
          title.textContent = job.title;
          loc.textContent = job.location || '—';
          team.textContent = job.team || job.department || '—';
          dateEl.textContent = formatPostedDate(job.postedDate || job.date);
          if (!seenIds.has(String(job.id))) badge.hidden = false;
          $('.job-card', clone).dataset.jobId = job.id;

          const applyCta = $('.apply-cta', clone);
          applyCta.href = jobUrl;

          const externalBadge = $('.external-badge', clone);
          const easyApplyBadge = $('.easy-apply-badge', clone);
          if (isEasyApply) {
            easyApplyBadge.hidden = false;
          } else if (!isDeliveroo) {
            externalBadge.hidden = false;
          }

          const logoCompany = sectionCompany || job.department || '';
          const logoUrl = getLogoUrl(logoCompany);
          if (logoUrl) {
            logo.src = logoUrl;
            logo.alt = logoCompany;
            logo.onerror = function () { this.classList.add('logo-error'); };
          }

          const findLink = $('.find-people-link', clone);
          const findText = $('.find-people-text', clone);

          if (isDeliveroo) {
            findLink.href = LinkedInSearch.candidateUrl(job.title);
            findText.textContent = 'Candidates';
            findLink.hidden = false;
            findLink.classList.add('candidate-link');
          } else {
            const refCompany = sectionCompany || job.department || '';
            if (refCompany) {
              findLink.href = LinkedInSearch.referrerUrl(refCompany);
              findText.textContent = 'Referrers';
              findLink.hidden = false;
              findLink.classList.add('referrer-link');
            }
          }

          frag.appendChild(clone);
        });
        this.list.appendChild(frag);
      },

      updateMeta(count, timestamp) {
        if (this.count) {
          this.count.textContent = count > 0
            ? `${count} role${count !== 1 ? 's' : ''}` : '';
        }
        if (this.updated && timestamp) {
          this.updated.textContent = `Updated ${formatTime(new Date(timestamp))}`;
        }
      },
    };
  }

  // ─── Deliveroo (live API, CORS OK) ───
  const Deliveroo = {
    async fetchTeamsMap() {
      const cached = Cache.get(CONFIG.TEAMS_CACHE_KEY);
      if (cached && cached.expiry > Date.now()) return cached.data;
      try {
        const res = await fetch(`${CONFIG.deliveroo.API_BASE}/teams?per_page=100`);
        const teams = await res.json();
        const map = {};
        teams.forEach((t) => (map[t.id] = decodeHTML(t.name)));
        Cache.set(CONFIG.TEAMS_CACHE_KEY, { data: map, expiry: Date.now() + 86400000 });
        return map;
      } catch { return cached?.data || {}; }
    },

    async fetchJobs() {
      const url = `${CONFIG.deliveroo.API_BASE}/roles?locations=${CONFIG.deliveroo.INDIA_LOCATION_ID}&per_page=100&orderby=date&order=desc`;
      const [jobs, teamsMap] = await Promise.all([
        fetch(url).then((r) => r.json()),
        this.fetchTeamsMap(),
      ]);
      return jobs.map((j) => ({
        id: j.id,
        title: decodeHTML(j.title.rendered),
        link: j.link,
        url: j.link,
        location: j.meta?.ats_location || j.meta?.ashby_location || 'India',
        team: (j.teams || []).map((id) => teamsMap[id] || 'Unknown').join(', ') || '—',
        postedDate: j.date,
      }));
    },
  };

  // ─── Target Companies (static JSON from GH Actions) ───
  async function fetchTargetCompanyData() {
    const res = await fetch(`${CONFIG.STATIC_DATA_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ─── Pull-to-Refresh ───
  const PullToRefresh = {
    startY: 0, pulling: false,
    init() {
      const el = $('#app');
      el.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0 && e.touches.length === 1) {
          this.startY = e.touches[0].clientY;
          this.pulling = true;
        }
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        if (!this.pulling) return;
        const dy = e.touches[0].clientY - this.startY;
        if (dy > 10 && window.scrollY === 0) {
          dom.pullIndicator.classList.add('visible');
          dom.pullIndicator.classList.toggle('releasing', dy > CONFIG.PULL_THRESHOLD);
        } else {
          dom.pullIndicator.classList.remove('visible', 'releasing');
        }
      }, { passive: true });
      el.addEventListener('touchend', () => {
        if (!this.pulling) return;
        this.pulling = false;
        const released = dom.pullIndicator.classList.contains('releasing');
        dom.pullIndicator.classList.remove('visible', 'releasing');
        if (released) App.refresh();
      }, { passive: true });
    },
  };

  // ─── Collapsible sections ───
  function initCollapsible() {
    $$('.section-header').forEach((header) => {
      header.addEventListener('click', () => {
        header.closest('.company-section').classList.toggle('collapsed');
      });
    });
  }

  // ─── App ───
  const App = {
    isLoading: false,

    async init() {
      dom.refreshBtn.addEventListener('click', () => this.refresh());
      $$('[data-retry]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.refresh();
        });
      });
      PullToRefresh.init();
      initCollapsible();
      this.registerSW();
      this.loadFromCache();
      await this.refresh();
    },

    loadFromCache() {
      const cached = Cache.get(CONFIG.CACHE_KEY);
      if (!cached) return;
      const seenIds = Cache.getSeenIds();

      if (cached.deliveroo?.jobs?.length) {
        const ui = sectionUI('deliveroo');
        ui.renderJobs(cached.deliveroo.jobs, seenIds);
        ui.updateMeta(cached.deliveroo.jobs.length, cached.deliveroo.timestamp);
      }

      for (const key of ['salesforce', 'booking', 'linkedin', 'linkedin_easy_all']) {
        const data = cached[key];
        if (data?.jobs?.length) {
          const ui = sectionUI(key);
          ui.renderJobs(data.jobs, seenIds);
          ui.updateMeta(data.jobs.length, data.timestamp);
        }
      }
    },

    async refresh() {
      if (this.isLoading) return;
      this.isLoading = true;
      dom.refreshBtn.classList.add('spinning');
      dom.refreshBtn.disabled = true;

      const previousSeenIds = Cache.getSeenIds();
      const cached = Cache.get(CONFIG.CACHE_KEY) || {};
      const newCache = { ...cached };
      const allJobIds = new Set(previousSeenIds);

      // Fetch Deliveroo (live) and target companies (static JSON) in parallel
      const results = await Promise.allSettled([
        this.refreshDeliveroo(previousSeenIds, newCache, allJobIds),
        this.refreshTargetCompanies(previousSeenIds, newCache, allJobIds),
      ]);

      Cache.set(CONFIG.CACHE_KEY, newCache);
      Cache.updateSeenIds(allJobIds);

      this.isLoading = false;
      dom.refreshBtn.classList.remove('spinning');
      dom.refreshBtn.disabled = false;
    },

    async refreshDeliveroo(seenIds, cache, allIds) {
      const ui = sectionUI('deliveroo');
      const hadData = ui.list.children.length > 0;
      if (!hadData) ui.showState('loading');

      try {
        const jobs = await Deliveroo.fetchJobs();
        const ts = Date.now();
        ui.renderJobs(jobs, seenIds);
        ui.updateMeta(jobs.length, ts);
        cache.deliveroo = { jobs, timestamp: ts };
        jobs.forEach((j) => allIds.add(String(j.id)));
      } catch (err) {
        console.error('Deliveroo fetch failed:', err);
        if (!hadData && ui.error) {
          ui.showState('error');
        }
      }
    },

    async refreshTargetCompanies(seenIds, cache, allIds) {
      const companies = ['salesforce', 'booking', 'linkedin', 'linkedin_easy_all'];
      companies.forEach((c) => {
        const ui = sectionUI(c);
        if (ui.list.children.length === 0) ui.showState('loading');
      });

      try {
        const data = await fetchTargetCompanyData();
        const ts = new Date(data.fetchedAt).getTime();

        for (const key of companies) {
          const ui = sectionUI(key);
          const companyData = data.companies?.[key];
          if (!companyData) {
            ui.showState('empty');
            continue;
          }

          const jobs = companyData.jobs || [];
          ui.renderJobs(jobs, seenIds);
          ui.updateMeta(jobs.length, ts);
          cache[key] = { jobs, timestamp: ts };
          jobs.forEach((j) => allIds.add(String(j.id)));
        }
      } catch (err) {
        console.error('Target companies fetch failed:', err);
        for (const key of companies) {
          const ui = sectionUI(key);
          if (ui.list.children.length === 0) ui.showState('empty');
        }
      }
    },

    registerSW() {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
          .catch((e) => console.warn('SW registration failed:', e));
      }
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
  } else {
    App.init();
  }
})();
