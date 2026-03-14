# CFT MCP Server

Remote MCP server for the Chrome Fair Trade platform, intended for deployment on Render.

## What was fixed

- Renamed `package-1.json` to `package.json`
- Added a real TypeScript build pipeline
- Fixed the `start` script to run compiled output from `dist/index.js`
- Fixed `tsconfig.json` so TypeScript actually includes `src/**/*.ts`
- Added required dev dependencies: `typescript`, `tsx`, `@types/node`, `@types/express`
- Removed the hard-coded fallback admin secret from runtime code
- Updated `render.yaml` so `CFT_ADMIN_SECRET` is not committed in plaintext
- Added a `/health` route and safer MCP endpoint error handling

## Tools

| Tool | What it does |
|---|---|
| `cft_health` | Platform + DB health check |
| `cft_market_prices` | Live CIF China + FOT rates, all grades |
| `cft_list_deals` | All deals, filter by status |
| `cft_deal_stats` | KPIs: tonnage, fees, grade breakdown |
| `cft_whatsapp_sessions` | Active WhatsApp conversation states |
| `cft_reset_whatsapp_session` | Unstick a supplier's WhatsApp flow |
| `cft_update_deal_status` | Approve / reject a deal |
| `cft_verify_certificate` | QR-verified deal certificate lookup |
| `cft_calculate_fot` | Reverse-Netback FOT calculation |
| `cft_list_suppliers` | All registered supplier accounts |

## Local development

```bash
npm install
npm run build
CFT_BASE_URL=https://cft-terminal-hub.vercel.app CFT_ADMIN_SECRET=your-secret npm start
```

Server routes:

- `GET /`
- `GET /health`
- `POST /mcp`

## Render deployment

Render accepts custom build and start commands for Node services, which fits this project layout. citeturn150812view3

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "fix: productionize CFT MCP server"
git branch -M main
git remote add origin https://github.com/Afrinov8/cft-mcp-server.git
git push -u origin main
```

### 2. Create the service on Render

- New → Web Service
- Connect the repository
- Render will use:
  - Build Command: `npm install && npm run build`
  - Start Command: `npm start`

### 3. Set environment variables

Set these in Render:

- `CFT_BASE_URL=https://cft-terminal-hub.vercel.app`
- `CFT_ADMIN_SECRET=...your actual admin secret...`
- `NODE_ENV=production`

Do not commit the real admin secret into the repo. Render blueprints support `sync: false` for secrets so values are not hardcoded in `render.yaml`. citeturn652236search0turn652236search3

### 4. Verify after deploy

- Root health: `https://your-service.onrender.com/health`
- MCP endpoint: `https://your-service.onrender.com/mcp`

## Notes

This project still assumes the upstream CFT app exposes these endpoints:

- `/api/health`
- `/api/market`
- `/api/deals`
- `/api/admin`
- `/api/verify`

If any of those routes differ on the Vercel app, the MCP server will deploy correctly but those specific tools will fail at runtime.
