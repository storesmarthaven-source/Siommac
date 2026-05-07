# Netlify + Supabase Setup

This project is now scaffolded to run the frontend on Netlify and the backend on a Netlify Function backed by Supabase.

## 1. Create Supabase Project

1. Create a free Supabase project.
2. Open **SQL Editor**.
3. Run `supabase/schema.sql`.
4. Run `supabase/seed.sql`.

## 2. Configure Netlify Environment Variables

In Netlify, add these environment variables:

```text
SUPABASE_URL=your Supabase project URL
SUPABASE_SERVICE_ROLE_KEY=your Supabase service role key
JWT_SECRET=a long random string
APP_TZ=Asia/Karachi
```

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in browser JavaScript. It belongs only in Netlify environment variables.

## 3. Deploy To Netlify

Connect this folder/repository to Netlify.

The included `netlify.toml` publishes the current folder and routes `/api` to `netlify/functions/api.js`.

## 4. Seed Demo Login Users

After the first deploy, call the setup route once:

```powershell
Invoke-RestMethod -Method Post -Uri "https://YOUR-SITE.netlify.app/api" -ContentType "text/plain" -Body '{"action":"setupDemoUsers","args":{}}'
```

Demo accounts:

```text
admin / admin123
manager1 / manager123
employee1 / emp123
```

Delete or change these passwords before real use.

## 5. Local Development

Install dependencies:

```powershell
npm install
```

Run Netlify locally:

```powershell
npm run dev
```

Then open the local Netlify URL. The frontend calls `/api`, so it works locally and after deploy.

## Migration Status

Implemented in the Netlify/Supabase backend:

- login/logout with signed 1-hour JWT
- demo user setup
- employee CRUD
- department CRUD
- project site CRUD
- attendance check-in/check-out with geofence enforcement
- personal attendance status/history
- leave submit/list/approve/reject
- manager department stats/employees/pending leaves
- admin stats/list attendance/list leaves
- settings read/update
- user color/layout preferences
- profile update/logo upload
- hourly rates and basic payroll generation

Still needs completion before production:

- dashboard chart parity with the Apps Script version's exact monthly calculations
- live map photo/detail parity polish
- payroll deduction parity with the Apps Script version
- profile image/logo upload hardening and image size/type validation
- full data migration from the existing Google Sheet
- stricter Supabase Storage signed URLs for private employee photos

The old `Code.gs` is left in place as a reference during migration.
