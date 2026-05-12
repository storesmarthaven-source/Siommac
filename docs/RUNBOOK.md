# RUNBOOK.md — Operations, Deployment & Incident Response

> **Machine-executable reference.**  
> Every procedure is numbered. Execute steps in order. Verify after each step.

---

## 1. Deployment Procedure

### 1.1 Normal Deploy (No Schema Changes)

```bash
# Step 1: Run local verification
npx tsc --noEmit
# Must exit code 0

# Step 2: Run tests
npm test
# Must exit code 0

# Step 3: Deploy to staging first
npx netlify deploy --alias staging
# Note the staging URL from output

# Step 4: Smoke test staging
STAGING_URL="https://staging--<site>.netlify.app"
curl -s -X POST "$STAGING_URL/.netlify/functions/api" \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}' | grep '"ok":true'
# Must find "ok":true

# Step 5: Deploy to production
npx netlify deploy --prod
# Note the deploy ID from output — needed for rollback

# Step 6: Smoke test production
curl -s -X POST "https://<your-site>.netlify.app/.netlify/functions/api" \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}' | grep '"ok":true'
```

### 1.2 Deploy with Schema Changes

```bash
# Step 1: Apply migration to Supabase production
supabase db push
# OR run SQL directly:
# supabase db query --db-url "$SUPABASE_DB_URL" < supabase/migrations/<filename>.sql

# Step 2: Verify migration applied
supabase db query "SELECT version FROM supabase_migrations ORDER BY version DESC LIMIT 3;"

# Step 3: Then follow normal deploy (1.1) above
```

### 1.3 Environment Variable Changes

```bash
# Set a new env var in Netlify
npx netlify env:set VARIABLE_NAME "value"

# List all env vars
npx netlify env:list

# After setting, redeploy to pick up the change
npx netlify deploy --prod
```

---

## 2. Rollback Procedure

### 2.1 Application Rollback (No Schema Changes)

```bash
# List recent deploys
npx netlify api listSiteDeploys --data '{"site_id":"<your-site-id>"}' | \
  python3 -c "import sys,json; deploys=json.load(sys.stdin); [print(d['id'],d['created_at'],d['state']) for d in deploys[:5]]"

# Restore a specific deploy by ID
npx netlify api restoreSiteDeploy \
  --data '{"site_id":"<site-id>","deploy_id":"<deploy-id-to-restore>"}'

# Verify rollback
curl -s -X POST "https://<your-site>.netlify.app/.netlify/functions/api" \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}' | grep '"ok":true'
```

### 2.2 Database Rollback

For each migration, maintain a corresponding undo SQL file at:
`supabase/migrations/<timestamp>_undo_<description>.sql`

```bash
# Apply undo migration
supabase db query < supabase/migrations/<timestamp>_undo_<description>.sql

# Verify table structure
supabase db query "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '<table>';"
```

---

## 3. Secrets Rotation

### 3.1 Rotate JWT Keys (RS256)

**When to rotate:** Suspected key compromise, every 12 months as good practice.

```bash
# Step 1: Generate new key pair
openssl genrsa -out jwt_private_new.pem 4096
openssl rsa -in jwt_private_new.pem -pubout -out jwt_public_new.pem

# Step 2: Format for env var (newlines → \n literal)
NEW_PRIVATE=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' jwt_private_new.pem)
NEW_PUBLIC=$(awk  'NF {sub(/\r/, ""); printf "%s\\n",$0;}' jwt_public_new.pem)

# Step 3: Set new keys (keep old JWT_SECRET for fallback if still in use)
npx netlify env:set JWT_PRIVATE_KEY "$NEW_PRIVATE"
npx netlify env:set JWT_PUBLIC_KEY  "$NEW_PUBLIC"

# Step 4: Deploy (new tokens will use new key; old tokens expire within 8h)
npx netlify deploy --prod

# Step 5: After 8 hours (all old tokens expired), remove legacy fallback
npx netlify env:unset JWT_SECRET   # only if JWT_SECRET fallback is no longer needed
npx netlify deploy --prod

# Step 6: Delete key files
rm jwt_private_new.pem jwt_public_new.pem
```

### 3.2 Rotate Supabase Service Role Key

```bash
# Step 1: Go to Supabase dashboard → Settings → API
# Step 2: Click "Rotate" on the service_role key
# Step 3: Copy the new key

# Step 4: Update Netlify env var
npx netlify env:set SUPABASE_SERVICE_ROLE_KEY "<new-key>"

# Step 5: Deploy immediately (old key is now invalid)
npx netlify deploy --prod

# Step 6: Smoke test
curl -s -X POST "https://<your-site>.netlify.app/.netlify/functions/api" \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}' | grep '"ok":true'
```

### 3.3 Rotate Upstash Redis Credentials

```bash
# Step 1: Go to Upstash console → your database → Reset credentials
# Step 2: Update env vars
npx netlify env:set UPSTASH_REDIS_REST_URL   "<new-url>"
npx netlify env:set UPSTASH_REDIS_REST_TOKEN "<new-token>"

# Step 3: Deploy
npx netlify deploy --prod
```

---

## 4. Monitoring Setup

### 4.1 Netlify Function Log Alerts

```bash
# Stream live function logs
npx netlify functions:log api --tail

# Search for errors in the last 24h
npx netlify functions:log api | grep -i "error\|fail\|exception"
```

### 4.2 Supabase Monitoring

```bash
# Check database connections
supabase db query "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"

# Check table sizes (identify bloat)
supabase db query "
  SELECT relname AS table, pg_size_pretty(pg_relation_size(oid)) AS size
  FROM pg_class
  WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
  ORDER BY pg_relation_size(oid) DESC
  LIMIT 10;
"

# Check attendance table row count (growth indicator)
supabase db query "SELECT COUNT(*) FROM attendance WHERE created_at > NOW() - INTERVAL '30 days';"

# Check for slow queries (> 5 seconds)
supabase db query "
  SELECT query, mean_exec_time, calls
  FROM pg_stat_statements
  WHERE mean_exec_time > 5000
  ORDER BY mean_exec_time DESC
  LIMIT 10;
"
```

### 4.3 Uptime Monitoring

Set up a free uptime monitor (e.g., UptimeRobot) to ping:
- URL: `https://<your-site>.netlify.app/.netlify/functions/api`
- Method: POST
- Body: `{"action":"ping"}`
- Expected response: contains `"ok":true`
- Interval: 5 minutes
- Alert: Email + webhook on failure

---

## 5. Incident Response

### 5.1 Service Down (Lambda Not Responding)

```
Symptoms: All API calls return 502/503. Frontend shows "Connection error."

Step 1: Check Netlify status page → status.netlify.com
Step 2: Check function logs for errors:
  npx netlify functions:log api --tail
Step 3: If a recent deploy caused it:
  → Rollback to last working deploy (see Section 2.1)
Step 4: If infrastructure issue:
  → Wait for Netlify status resolution
  → Post status update to users
Step 5: After recovery — write a post-mortem in this section
```

### 5.2 Database Connection Failure

```
Symptoms: "Failed to load employees", "Internal server error" on all data routes.
Function logs show: "supabase error: connection refused" or "relation does not exist"

Step 1: Check Supabase status → status.supabase.com
Step 2: Verify env vars are set:
  npx netlify env:list | grep SUPABASE
Step 3: Test connection directly:
  supabase db query "SELECT 1;"
Step 4: If env vars changed, rotate and redeploy (Section 3.2)
Step 5: If Supabase incident — wait, then test recovery:
  curl -s -X POST "https://<site>/.netlify/functions/api" \
    -d '{"action":"ping"}' | grep '"ok":true'
```

### 5.3 Suspected Security Breach

```
Symptoms: Unusual activity in activity_logs. Unknown admin actions. Employees reporting
          password changes they didn't make.

IMMEDIATE ACTIONS (within 15 minutes):
Step 1: Rotate ALL secrets (JWT keys, Supabase key, Upstash tokens — Sections 3.1-3.3)
        This invalidates all active tokens and sessions immediately.

Step 2: Query activity_logs for suspicious actions:
  supabase db query "
    SELECT user_id, username, action, entity, details, created_at
    FROM activity_logs
    WHERE created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
    LIMIT 100;
  "

Step 3: Identify compromised accounts:
  supabase db query "
    SELECT username, action, created_at
    FROM activity_logs
    WHERE action IN ('login', 'update', 'delete')
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC;
  "

Step 4: Deactivate suspected compromised accounts:
  supabase db query "
    UPDATE app_users SET status = 'inactive' WHERE username = '<suspect>';
  "

Step 5: Force password reset for all admin accounts:
        Manually update password_hash via Supabase dashboard for each admin.

Step 6: Review and document the breach timeline.
Step 7: Notify affected employees per T&T Data Protection Act (Section 23 — 72h notification).
```

### 5.4 Auto-Checkout Not Running

```
Symptoms: Employees still show as "checked in" after work hours. Project site cards
          showing stale checked-in counts.

Step 1: Check scheduled function logs:
  npx netlify functions:log auto-checkout --tail

Step 2: Verify schedule is registered:
  npx netlify api listSiteFunctions \
    --data '{"site_id":"<site-id>"}' | grep auto-checkout

Step 3: Manually trigger the function:
  curl -X POST "https://<site>/.netlify/functions/auto-checkout"

Step 4: Check settings table for workHours key:
  supabase db query "SELECT * FROM settings WHERE key = 'workHours';"

Step 5: If the function is missing from Netlify:
  → Ensure auto-checkout.js exists in netlify/functions/
  → Redeploy: npx netlify deploy --prod
```

---

## 6. Database Maintenance

### 6.1 Vacuum (run monthly)

```sql
-- Run via supabase db query
VACUUM ANALYZE public.attendance;
VACUUM ANALYZE public.activity_logs;
VACUUM ANALYZE public.leave_requests;
```

### 6.2 Index Health Check

```sql
-- Identify unused indexes
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY schemaname, tablename;
```

### 6.3 Check for Long-Running Queries

```sql
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes';
```

---

## 7. Backup Strategy

Supabase Pro plans include automatic daily backups with 7-day retention. For the free/starter plan:

```bash
# Manual backup via pg_dump (replace with actual DB URL from Supabase settings)
pg_dump "$SUPABASE_DB_URL" \
  --no-owner \
  --no-acl \
  --format=custom \
  --file="siomac_backup_$(date +%Y%m%d).dump"

# Restore from backup
pg_restore \
  --dbname="$SUPABASE_DB_URL" \
  --no-owner \
  --clean \
  siomac_backup_20260101.dump
```

**Backup schedule recommendation:** Daily automated backup via a cron job on any server, or via Supabase Pro.

---

## 8. Common Admin Tasks

### Reset an employee's password

```bash
# Generate hash at cost 12 (use Node)
node -e "const b=require('bcryptjs'); b.hash('NewPass123!', 12).then(h => console.log(h));"

# Update in DB (replace hash and username)
supabase db query "
  UPDATE app_users
  SET password_hash = '\$2a\$12\$...(paste hash here)...',
      updated_at = NOW()
  WHERE username = 'john_doe';
"
```

### Manually check out a stuck employee

```sql
-- Replace with actual values
UPDATE public.attendance
SET check_out_time = NOW(),
    total_hours    = ROUND(EXTRACT(EPOCH FROM (NOW() - check_in_time)) / 3600, 2),
    notes          = 'Manually checked out by admin',
    updated_at     = NOW()
WHERE username = 'john_doe'
  AND work_date = CURRENT_DATE
  AND check_out_time IS NULL;
```

### View today's live attendance summary

```sql
SELECT
  u.full_name,
  u.position,
  d.name AS department,
  a.check_in_time,
  a.check_out_time,
  a.status
FROM attendance a
JOIN app_users u  ON u.id = a.user_id
LEFT JOIN departments d ON d.id = u.department_id
WHERE a.work_date = CURRENT_DATE
ORDER BY a.check_in_time DESC;
```
