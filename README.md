# 🚉 Personal Travel Hub

A personal, self-hosted real-time travel dashboard tailored for common travel. It displays live rail departures for your chosen home station to stations frequently visited (and planned engineering works).
It also displays road travel times with live traffic, and lets you share routes directly to your phone via QR code.

Rail and road journeys are configured in `config/rail.yaml` and `config/roads.yaml` respectively. These files are gitignored and should be populated with your personal travel information (examples are provided).

Live road traffic is provided by Google Maps Distance Matrix API. You will need to obtain an API key from Google Cloud Console and set it as an environment variable `GOOGLE_MAPS_API_KEY`. API keys should be restricted to `Distance Matrix API` and `Maps Embed API`. The free tier is sufficient for personal use and will only update every 25 minutes (6am-midnight only, to stay within 50% of the API free tier).

Live rail departures are provided by National Rail when a token is provided via the environment variable `NATIONAL_RAIL_TOKEN`, however this isn't required as the the app will fall back to web scraping.

**Current Status:** This project has been built with Antigravity and is a work inprogress

---

## ✨ Features

| Feature | Detail |
|---|---|
| 🚂 **Live Rail Departures** | Real-time train times scraped from National Rail, grouped per destination. Shows best-arriving and next train, ETA, platform, status, and calling points |
| 🚗 **Live Road Travel** | Google Maps Distance Matrix API — live travel time and traffic status per route in miles |
| 🛠️ **Engineering Works** | Planned disruptions for your configured train operator(s) scraped from National Rail |
| 📱 **Send to Device** | QR code modal + copy-link button to easily open a route on your phone |
| 🗺️ **Embedded Maps** | Google Maps embedded per route with single-click full-screen expansion |
| ⏱️ **Auto-refresh** | Rail refreshes every 5 minutes. Road refreshes every 25 minutes (6am–midnight only, to stay within API free tier) |
| 🕒 **Per-source timestamps** | Footer tracks and displays the last successful update time separately for rail and road data |

---

## 📁 Project Structure

```
travel-hub/
├── src/
│   ├── App.tsx                  # Main React application — all UI, state, and data logic
│   ├── main.tsx                 # React entry point — mounts App into the DOM
│   ├── index.css                # Global styles and Tailwind CSS configuration
│   └── services/
│       └── travelService.ts     # Client-side API helpers (calls to /api/road and /api/rail endpoints)
│
├── server.ts                    # Express backend server — API routes and data fetching
├── vite.config.ts               # Vite bundler config — React plugin, Tailwind, path aliases
├── tsconfig.json                # TypeScript compiler configuration
├── index.html                   # HTML entry point loaded by Vite
├── package.json                 # NPM dependencies and scripts
│
├── Dockerfile                   # Multi-stage Docker build (build → runtime)
├── docker-compose.yml           # Compose config — port mapping and environment variables
├── .dockerignore                # Files excluded from the Docker build context
├── env.example                  # Template showing required environment variables
├── config/
│   ├── rail.example.yaml        # Template for rail departures config
│   ├── roads.example.yaml       # Template for road journey config
│   ├── rail.yaml                # Your personal rail routes (gitignored)
│   └── roads.yaml               # Your personal road routes (gitignored)
│
├── dev_scratchpad/              # Raw National Rail JSON/HTML snapshots captured during
│                                # development to understand the scraping data structure.
│                                # Not used at runtime — safe to delete
```

### Key Files in Detail

#### `src/App.tsx`
The heart of the application. Contains:
- All React state (`useState`, `useEffect`, `useRef`) for rail data, road data, loading flags, timestamps, and UI state
- Data fetching on mount and auto-refresh timers (using refs to avoid stale closures)
- Rail card UI — best/next departure logic, expandable train list with calling points
- Road card UI — embedded maps, full-screen overlay, traffic status
- QR code share modal
- Footer with per-source last-updated timestamps

#### `src/services/travelService.ts`
Thin HTTP client layer (using `axios`) that calls the Express backend:
- `getLiveRailDepartures(crs, destinations)` — fetches grouped departures from `/api/rail/departures`
- `getLiveRoadTravel(journeys)` — fetches travel times from `/api/road/travel`

#### `server.ts`
Express server that acts as a secure backend proxy. Handles:
- **`GET /api/rail/departures`** — Scrapes National Rail's live departures page using `cheerio` (HTML parser). Falls back gracefully to the official SOAP API if a `NATIONAL_RAIL_TOKEN` is configured. Calls a National Rail GraphQL endpoint to fetch actual calling points per service
- **`GET /api/rail/engineering`** — Scrapes planned disruptions for your configured train operator(s)
- **`GET /api/road/travel`** — Proxy to the Google Maps Distance Matrix API. Returns travel time, distance (miles), and a derived traffic status. Returns a `_configRequired` flag (rather than an error) if no API key is set, so the UI can degrade gracefully

#### `vite.config.ts`
Configures the Vite dev and build pipeline:
- `@vitejs/plugin-react` for JSX/TSX transformation
- `@tailwindcss/vite` for Tailwind CSS v4 integration (no `postcss.config.js` needed)
- `@` alias resolves to the project root

#### `config/` Directory

External YAML files mounted at runtime via Docker volumes (or read locally during dev). These files keep your personal locations out of the codebase. They are parsed by the server and loaded into the frontend on startup.

**`config/roads.yaml`**
Defines your road journeys and Google Maps query strings.
```yaml
journeys:
  - id: work
    destinationName: Work
    origin: "My Home Address"
    destination: "My Office"
```

**`config/rail.yaml`**
Defines your primary National Rail station and the destinations you commute to.
```yaml
homeStation:
  name: "Shenfield"
  crs: "SNF"

# Engineering works will look for disruptions affecting all operators listed here
# Find 2-letter operator codes here: https://en.wikipedia.org/wiki/List_of_companies_operating_trains_in_the_United_Kingdom
operatorCodes: 
  - "LE" # Greater Anglia
  - "XR" # Elizabeth Line
  - "LO" # London Overground
  - "LT" # London Underground (Tube)

destinations:
  - id: "liverpool-st"
    name: "Liverpool Street"
```

---

## 🔑 Environment Variables

Copy `env.example` to `.env` and fill in the values you have:

```bash
cp env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `NATIONAL_RAIL_TOKEN` | Optional | Darwin/OpenLDBWS token from [National Rail Enquiries](https://realtime.nationalrail.co.uk/OpenLDBWSRegistration/). If not set, the scraping fallback is used |
| `GOOGLE_MAPS_API_KEY` | Optional | A Google Cloud API key with the **Distance Matrix API** enabled. If not set, road travel data is unavailable but the app still works |

> **Note:** The application works fully without any keys. Rail times use web scraping as the default. Road travel shows a clear "API key not configured" message when the Google Maps key is absent.

---

## 🐳 Deployment with Docker Compose

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed
- A `.env` file with your API keys (see above)

### Build and Start

```bash
# Clone the repository
git clone <your-repo-url> travel-hub
cd travel-hub

# Set up environment variables
cp env.example .env
# Edit .env with your preferred editor and add your keys

# Set up journey configurations
cp config/roads.example.yaml config/roads.yaml
cp config/rail.example.yaml config/rail.yaml
# Edit both files in config/ and add your personal routes

# Build the Docker image and start the container
docker compose up --build -d
```

The application will be available at **http://localhost:3000**.

### Stop the Application

```bash
docker compose down
```

### View Logs

```bash
docker compose logs -f
```

### Rebuild After Code Changes

```bash
docker compose up --build -d
```

### How the Docker Build Works

The `Dockerfile` uses a **two-stage build**:

1. **Builder stage** (`node:20-slim`) — installs all dependencies and runs `vite build` to compile the frontend into static assets in `dist/`
2. **Runtime stage** (`node:20-slim`) — copies only the compiled `dist/`, `node_modules/`, and `server.ts` from the builder. Runs the Express server via `tsx` (TypeScript executor), which serves the pre-built static frontend in production mode

This keeps the final image lean by excluding build-only tooling.

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Start the development server (Express backend + Vite HMR frontend)
npm run dev
```

The app runs at **http://localhost:3000**. Changes to `src/` files are hot-reloaded instantly by Vite. Changes to `server.ts` require a server restart.

---

## 👩‍💻 Developer Guide

This section is for engineers picking up this project for the first time. Below is an overview of every technology used and curated resources to get up to speed quickly.

---

### Technology Overview

| Technology | Role in this project |
|---|---|
| **React 19** | UI component framework — all rendering and state management |
| **TypeScript** | Type-safe JavaScript used across the entire codebase |
| **Vite 6** | Frontend bundler and development server with HMR |
| **Tailwind CSS v4** | Utility-first CSS framework for all styling |
| **Express** | Minimal Node.js HTTP server for backend API routes |
| **tsx** | TypeScript executor that runs `server.ts` without a compile step |
| **Axios** | HTTP client used on both frontend and backend |
| **Cheerio** | Server-side HTML parser (like jQuery for Node) — used for scraping National Rail |
| **motion** (Framer Motion) | Animation library — layout animations, page transitions, accordion cards |
| **date-fns** | Date/time formatting utilities |
| **lucide-react** | Icon component library |
| **clsx + tailwind-merge** | Utilities for conditionally composing Tailwind class names |
| **fast-xml-parser** | Parses the SOAP/XML response from the National Rail official API |
| **Docker + Compose** | Containerised deployment |

---

### Learning Resources

#### JavaScript (ES2020+)
Understanding modern JS is the foundation for everything else.
- [javascript.info](https://javascript.info/) — The best free, comprehensive JS guide
- [MDN JavaScript Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide) — Reference documentation
- [Async/Await explained](https://javascript.info/async-await) — Essential for understanding the data fetching in `server.ts` and `travelService.ts`
- [ES Modules (import/export)](https://javascript.info/modules-intro) — How files import from each other

#### TypeScript
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) — Official, well-structured introduction
- [TypeScript in 5 minutes](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html) — Quick onboarding for JS developers
- [Type narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) — Relevant to how types are checked in the UI data flow
- [Generic types](https://www.typescriptlang.org/docs/handbook/2/generics.html) — Used extensively in React state (`useState<T>`)

#### React
- [React Docs — Quick Start](https://react.dev/learn) — Official, modern docs (covers hooks-based React)
- [useState](https://react.dev/reference/react/useState) — Local state management (heavily used in `App.tsx`)
- [useEffect](https://react.dev/reference/react/useEffect) — Side effects and data fetching
- [useRef](https://react.dev/reference/react/useRef) — Mutable refs, used here to avoid stale closures in intervals
- [useMemo](https://react.dev/reference/react/useMemo) — Derived/computed values

#### Tailwind CSS v4
- [Tailwind CSS Docs](https://tailwindcss.com/docs) — Full utility class reference
- [Core concepts](https://tailwindcss.com/docs/utility-first) — Why utility-first CSS works the way it does
- [Responsive design](https://tailwindcss.com/docs/responsive-design) — The `sm:`, `lg:` prefixes used in the layout
- [Tailwind v4 migration](https://tailwindcss.com/docs/v4-beta) — v4 uses a Vite plugin instead of PostCSS

#### Vite
- [Vite Guide](https://vite.dev/guide/) — How Vite bundles, transforms, and serves your code
- [vite.config.ts reference](https://vite.dev/config/) — All configuration options
- [Environment variables in Vite](https://vite.dev/guide/env-and-mode) — How `.env` files work with Vite's `define`

#### Express (Node.js backend)
- [Express Getting Started](https://expressjs.com/en/starter/hello-world.html) — Quick intro
- [Routing](https://expressjs.com/en/guide/routing.html) — How `app.get('/api/...')` routes work
- [Middleware](https://expressjs.com/en/guide/using-middleware.html) — How `cors()` and `express.json()` fit in

#### Docker & Docker Compose
- [Docker Getting Started](https://docs.docker.com/get-started/) — Containers and images explained
- [Dockerfile reference](https://docs.docker.com/engine/reference/builder/) — Every instruction used in the `Dockerfile`
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/) — How the builder → runtime pattern works here
- [Docker Compose overview](https://docs.docker.com/compose/) — Service definitions, ports, and environment variable injection

#### Motion (Framer Motion)
- [Motion for React docs](https://motion.dev/docs/react-quick-start) — Getting started with `<motion.div>` and `AnimatePresence`
- [Layout animations](https://motion.dev/docs/react-layout-animations) — Used for the expanding rail cards

#### Axios
- [Axios docs](https://axios-http.com/docs/intro) — HTTP requests, params, error handling

---

### Architecture at a Glance

```
Browser (React SPA)
    │
    │  HTTP (fetch/axios)
    ▼
Express Server (server.ts) — port 3000
    ├── Serves pre-built Vite dist/ (production)
    ├── Proxies requests to National Rail (scraping / SOAP API)
    └── Proxies requests to Google Maps Distance Matrix API
```

In development (`npm run dev`), Vite is mounted as middleware inside Express — so a single port (3000) serves both the frontend with HMR and the backend API routes.

In production (Docker), Vite has already compiled the frontend to `dist/`. Express serves those static files directly and continues to handle `/api/*` routes.

---

### Code Style Notes

- **No class components** — all React components use function components and hooks
- **No Redux / external state manager** — all state lives in `App.tsx` using `useState`
- **`cn()` helper** — wraps `clsx` + `tailwind-merge` to safely compose conditional Tailwind classes without duplication
- **Graceful degradation** — every external API (National Rail, Google Maps) has a fallback; the app is usable with zero API keys
