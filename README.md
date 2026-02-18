# Deliveroo India — Open Roles

A lightweight Progressive Web App that tracks open job positions at Deliveroo India.

## Features

- Live data from Deliveroo's careers API (WordPress REST API backed by Ashby)
- Filters for India positions only (location ID `411`)
- Pull-to-refresh on mobile
- Manual refresh button
- Offline support via service worker (shows cached data when offline)
- "NEW" badge highlights roles you haven't seen before
- Dark mode (follows system preference)
- Installable as a PWA on iOS and Android

## Project Structure

```
deliveroo-india-jobs/
├── index.html           # App shell
├── styles.css           # Styles with dark mode + responsive design
├── app.js               # Data fetching, caching, rendering logic
├── manifest.json        # PWA manifest
├── service-worker.js    # Offline caching strategies
├── icons/
│   ├── icon.svg         # Vector icon
│   ├── icon-192.png     # PWA icon (192×192)
│   ├── icon-512.png     # PWA icon (512×512)
│   └── apple-touch-icon.png  # iOS home screen icon (180×180)
└── README.md
```

## How It Works

### Data Source

Deliveroo uses a **WordPress REST API** (backed by Ashby ATS) at:

```
GET https://careers.deliveroo.co.uk/wp-json/wp/v2/roles?locations=411&per_page=100
```

- `locations=411` = India
- CORS is **fully enabled** (the API reflects the request `Origin` header), so no proxy is needed
- Team names are resolved via a separate call to `/wp-json/wp/v2/teams`

### Caching Strategy

| Resource | Strategy |
|----------|----------|
| App shell (HTML, CSS, JS, icons) | Cache-first, then network |
| API responses | Network-first, then cache fallback |
| Teams taxonomy | Cached in localStorage for 24 hours |
| Last successful job data | Cached in localStorage, shown instantly on load |

### "New" Role Detection

The app stores IDs of all previously seen jobs in localStorage. On each fetch, any job ID not in that set gets a "NEW" badge. After rendering, all current IDs are merged into the seen set.

---

## Local Development

### Prerequisites

Any static file server. The simplest option:

```bash
# Python 3
cd deliveroo-india-jobs
python3 -m http.server 8080

# or Node.js
npx serve .
```

Then open [http://localhost:8080](http://localhost:8080).

> **Note:** The service worker requires serving over `http://localhost` or `https://`. Opening `index.html` as a `file://` URL will not work.

---

## Deploy to GitHub Pages

### Option 1: Deploy from `main` branch (simplest)

1. Create a GitHub repo (e.g., `deliveroo-india-jobs`)

2. Push the code:
   ```bash
   cd deliveroo-india-jobs
   git init
   git add .
   git commit -m "Initial commit — Deliveroo India Jobs PWA"
   git remote add origin https://github.com/viren3196/deliveroo-india-jobs.git
   git branch -M main
   git push -u origin main
   ```

3. Go to **Settings → Pages** in your GitHub repo

4. Under **Source**, select **Deploy from a branch**

5. Choose **main** branch, **/ (root)** folder, and click **Save**

6. Your app will be live at:
   ```
   https://viren3196.github.io/deliveroo-india-jobs/
   ```

### Option 2: Deploy with GitHub Actions

GitHub Pages now defaults to Actions-based deployment. If your repo is set up that way, the static site will deploy automatically on push to `main`.

---

## Add to iPhone Home Screen

1. Open your deployed URL in **Safari** on your iPhone
2. Tap the **Share** button (square with arrow)
3. Scroll down and tap **Add to Home Screen**
4. Name it (e.g., "Roo India") and tap **Add**
5. The app will appear on your home screen with the teal "D" icon
6. Launching it opens in standalone mode (no Safari chrome)

---

## Tradeoffs & Notes

### Why no CORS proxy?

Deliveroo's WordPress REST API sets `Access-Control-Allow-Origin` to reflect the request origin, so cross-origin `fetch()` works natively from any domain including GitHub Pages. No proxy needed.

### Why no framework?

The entire app is ~300 lines of JS, ~380 lines of CSS. Vanilla JS keeps the bundle at zero dependencies, instant load, and trivial to maintain. The `<template>` element handles card templating efficiently.

### What if the API changes?

Deliveroo could migrate away from WordPress/Ashby or change the API structure. If that happens:
- The app will show the cached data with a network error
- Update `CONFIG.API_BASE` and the response mapping in `API.fetchIndiaJobs()` to match the new shape
- The Greenhouse board (`boards.greenhouse.io/deliveroo`) was deprecated; the current WordPress API has been stable

### What if India has zero jobs?

The app shows a friendly empty state: "No open roles in India right now. Check back later — new positions open regularly."

---

## License

MIT
