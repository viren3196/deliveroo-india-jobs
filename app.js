(function () {
  'use strict';

  // ─── Configuration ───
  const CONFIG = {
    API_BASE: 'https://careers.deliveroo.co.uk/wp-json/wp/v2',
    INDIA_LOCATION_ID: 411,
    PER_PAGE: 100,
    CACHE_KEY: 'deliveroo_india_jobs',
    SEEN_KEY: 'deliveroo_india_seen_ids',
    TEAMS_CACHE_KEY: 'deliveroo_teams_map',
    PULL_THRESHOLD: 80,
  };

  // ─── DOM References ───
  const dom = {
    refreshBtn: document.getElementById('refresh-btn'),
    retryBtn: document.getElementById('retry-btn'),
    jobList: document.getElementById('job-list'),
    jobCount: document.getElementById('job-count'),
    lastUpdated: document.getElementById('last-updated'),
    loadingState: document.getElementById('loading-state'),
    errorState: document.getElementById('error-state'),
    emptyState: document.getElementById('empty-state'),
    errorMessage: document.getElementById('error-message'),
    pullIndicator: document.getElementById('pull-indicator'),
    template: document.getElementById('job-card-template'),
  };

  // ─── Cache Layer ───
  const Cache = {
    get(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },

    set(key, data) {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        // Storage full or unavailable — silently fail
      }
    },

    getSeenIds() {
      return new Set(this.get(CONFIG.SEEN_KEY) || []);
    },

    updateSeenIds(jobIds) {
      this.set(CONFIG.SEEN_KEY, [...jobIds]);
    },
  };

  // ─── API Layer ───
  const API = {
    async fetchJSON(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res.json();
    },

    async fetchTeamsMap() {
      const cached = Cache.get(CONFIG.TEAMS_CACHE_KEY);
      if (cached && cached.expiry > Date.now()) return cached.data;

      try {
        const teams = await this.fetchJSON(
          `${CONFIG.API_BASE}/teams?per_page=100`
        );
        const map = {};
        teams.forEach((t) => (map[t.id] = decodeHTML(t.name)));
        Cache.set(CONFIG.TEAMS_CACHE_KEY, {
          data: map,
          expiry: Date.now() + 24 * 60 * 60 * 1000,
        });
        return map;
      } catch {
        return cached?.data || {};
      }
    },

    async fetchIndiaJobs() {
      const url =
        `${CONFIG.API_BASE}/roles?locations=${CONFIG.INDIA_LOCATION_ID}` +
        `&per_page=${CONFIG.PER_PAGE}&orderby=date&order=desc`;

      const [jobs, teamsMap] = await Promise.all([
        this.fetchJSON(url),
        this.fetchTeamsMap(),
      ]);

      return jobs.map((job) => ({
        id: job.id,
        title: decodeHTML(job.title.rendered),
        link: job.link,
        location: job.meta?.ats_location || job.meta?.ashby_location || 'India',
        team: (job.teams || []).map((id) => teamsMap[id] || 'Unknown').join(', ') || '—',
        postedDate: job.date,
        modifiedDate: job.modified,
      }));
    },
  };

  // ─── Utility ───
  function decodeHTML(html) {
    const txt = document.createElement('textarea');
    txt.innerHTML = html;
    return txt.value;
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
      hour12: true,
    }).format(date);
  }

  // ─── UI Controller ───
  const UI = {
    showState(state) {
      dom.loadingState.hidden = state !== 'loading';
      dom.errorState.hidden = state !== 'error';
      dom.emptyState.hidden = state !== 'empty';
      dom.jobList.hidden = state !== 'jobs';
    },

    setLoading(loading) {
      dom.refreshBtn.classList.toggle('spinning', loading);
      dom.refreshBtn.disabled = loading;
    },

    renderJobs(jobs, seenIds) {
      dom.jobList.innerHTML = '';

      if (jobs.length === 0) {
        this.showState('empty');
        return;
      }

      this.showState('jobs');
      const fragment = document.createDocumentFragment();

      jobs.forEach((job) => {
        const clone = dom.template.content.cloneNode(true);
        const card = clone.querySelector('.job-card');
        const link = clone.querySelector('.job-link');
        const title = clone.querySelector('.job-title');
        const badge = clone.querySelector('.new-badge');
        const location = clone.querySelector('.location-text');
        const team = clone.querySelector('.team-text');

        link.href = job.link;
        title.textContent = job.title;
        location.textContent = job.location;
        team.textContent = job.team;

        if (!seenIds.has(job.id)) {
          badge.hidden = false;
        }

        card.dataset.jobId = job.id;
        fragment.appendChild(clone);
      });

      dom.jobList.appendChild(fragment);
    },

    showError(message) {
      dom.errorMessage.textContent = message;
      this.showState('error');
    },

    updateMeta(count, timestamp) {
      dom.jobCount.textContent = count > 0 ? `${count} open role${count !== 1 ? 's' : ''}` : '';
      dom.lastUpdated.textContent = timestamp ? `Updated ${formatTime(new Date(timestamp))}` : '';
    },
  };

  // ─── Pull-to-Refresh ───
  const PullToRefresh = {
    startY: 0,
    pulling: false,

    init() {
      const el = document.getElementById('app');

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

      el.addEventListener('touchend', (e) => {
        if (!this.pulling) return;
        this.pulling = false;

        const released = dom.pullIndicator.classList.contains('releasing');
        dom.pullIndicator.classList.remove('visible', 'releasing');

        if (released) {
          App.refresh();
        }
      }, { passive: true });
    },
  };

  // ─── App Controller ───
  const App = {
    isLoading: false,

    async init() {
      dom.refreshBtn.addEventListener('click', () => this.refresh());
      dom.retryBtn.addEventListener('click', () => this.refresh());
      PullToRefresh.init();
      this.registerSW();

      // Show cached data immediately, then refresh
      const cached = Cache.get(CONFIG.CACHE_KEY);
      if (cached?.jobs?.length) {
        const seenIds = Cache.getSeenIds();
        UI.renderJobs(cached.jobs, seenIds);
        UI.updateMeta(cached.jobs.length, cached.timestamp);
      }

      await this.refresh();
    },

    async refresh() {
      if (this.isLoading) return;
      this.isLoading = true;

      const hadCachedData = dom.jobList.children.length > 0;
      if (!hadCachedData) UI.showState('loading');
      UI.setLoading(true);

      try {
        const jobs = await API.fetchIndiaJobs();
        const previousSeenIds = Cache.getSeenIds();
        const timestamp = Date.now();

        UI.renderJobs(jobs, previousSeenIds);
        UI.updateMeta(jobs.length, timestamp);

        Cache.set(CONFIG.CACHE_KEY, { jobs, timestamp });

        // Mark current jobs as seen for next visit
        const allIds = new Set([...previousSeenIds, ...jobs.map((j) => j.id)]);
        Cache.updateSeenIds(allIds);
      } catch (err) {
        console.error('Fetch failed:', err);
        const cached = Cache.get(CONFIG.CACHE_KEY);
        if (!cached?.jobs?.length) {
          UI.showError(
            navigator.onLine === false
              ? 'You appear to be offline. Connect to the internet and try again.'
              : `Failed to load jobs: ${err.message}`
          );
        }
        // If we have cached data showing, just leave it visible
      } finally {
        this.isLoading = false;
        UI.setLoading(false);
      }
    },

    registerSW() {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker
          .register('service-worker.js')
          .catch((err) => console.warn('SW registration failed:', err));
      }
    },
  };

  // ─── Boot ───
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
  } else {
    App.init();
  }
})();
