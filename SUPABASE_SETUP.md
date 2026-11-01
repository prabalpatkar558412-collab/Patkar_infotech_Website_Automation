# Supabase integration and release runbook

Local Supabase credentials are configured and the project is reachable. The latest records API check failed because `public.profiles` is missing from the schema cache. Public workspace access is enabled locally; database initialization and a team profile are still required. TypeScript and 17 automated tests pass. Production compilation succeeded, but the build's TypeScript subprocess was blocked by the sandbox (`spawn EPERM`); no production deployment was changed.

For a fresh database, run `supabase/setup-fresh.sql` in Supabase Dashboard > SQL Editor. This applies migrations 001?004 in one transaction and aborts if the core workspace tables already exist. Then create an Auth user and its Admin profile as described below. For an existing database, apply only pending migrations.

## Secure local configuration

From this project directory, run:

```powershell
powershell -NoProfile -File .\scripts\configure-supabase.ps1
npm run dev
```

The script prompts locally with hidden input and preserves other environment entries. Obtain the project URL and anon key from the same Supabase project's Connect/API settings, and its legacy service_role key from API Keys. Do not use a service_role key as the anon key. The service key must never have a NEXT_PUBLIC prefix. All three values must belong to the same project. Never paste keys into chat. Never commit `.env.local`. Demo is available only with `NEXT_PUBLIC_DEMO_MODE=true`; keep it `false` for live operation. Restart/rebuild after changing public variables.

## Apply SQL without touching existing records

Inspect the SQL editor migration history or, with an authorized linked CLI, run `supabase migration list`. If a CLI link is already configured, use `supabase db push --dry-run`, verify that only pending files are listed, then `supabase db push`. Do not repair migration history blindly. Do not use database reset, clean, or a seed script.

Run ONLY files not already applied, in this exact order, using Supabase Dashboard > SQL Editor:

1. `supabase/migrations/001_workspace.sql`
2. `supabase/migrations/002_scheduling_and_history.sql`
3. `supabase/migrations/003_webhook_hardening.sql`
4. `supabase/migrations/004_integration_permissions.sql`

001 and 002 create tables/triggers and cannot be replayed against an existing installation. If SQL was previously applied manually and no migration history exists, inspect the existing tables, policies, triggers and functions before deciding which files are missing. For an existing deployment already on 003, run only 004. The new 004 migration preserves existing data, adds grants and replaces validation functions; it does not reset or delete records. If any migration fails, stop and resolve that error before continuing. Execute each file as a transaction (004 already includes BEGIN/COMMIT).

Create the first user under Authentication > Users, copy its UUID (not a secret), then run:

```sql
insert into public.profiles(id,name,role)
values ('REPLACE-WITH-AUTH-USER-UUID','Amit Patkar','Admin');
```

Do not overwrite an existing profile accidentally. Create additional Auth users with separate profiles for Sales and Developer. Keep public signup disabled for this internal workspace. Admin has full access; Sales sees assigned leads, clients, conversations, notes and quotations; Developer sees assigned projects, tasks and notes. Assign linked parents so the assigned user has permission to access them. Financial metrics are meaningful for Admin; other roles see only the records allowed by RLS.

Run these verification SQL files after migrations:

- `supabase/tests.sql`: webhook deduplication, reply cancellation, opt-out.
- `supabase/verify_integration.sql`: database create/read/update across business entities, message read isolation, Sales/Developer restrictions, role escalation rejection and anonymous rejection. Fixtures are transaction-scoped and roll back. Requires SQL editor privileges; do not run in the migration directory.

These SQL tests were prepared but could not be executed without a database connection.

## Auth URLs

Supabase > Authentication > URL Configuration:

- Site URL: `https://patkarinfotechwebsiteautomation-jnf.vercel.app`
- Redirect URLs: `https://patkarinfotechwebsiteautomation-jnf.vercel.app/reset-password`
- For development also allow `http://localhost:3000/reset-password`.

Configure an SMTP provider for password recovery emails.

## Vercel configuration and redeployment

1. Open the Vercel project serving `patkarinfotechwebsiteautomation-jnf.vercel.app`.
2. Settings > Environment Variables: add or update the following in **Production**. Configure Preview/Development separately with the intended database.

| Name | Value | Exposure |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL | Public, embedded during build |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Same project's anon key | Public, protected by RLS |
| SUPABASE_SERVICE_ROLE_KEY | Same project's service_role key | Server only; mark Sensitive |
| NEXT_PUBLIC_DEMO_MODE | false | Public mode setting |
| NEXT_PUBLIC_APP_URL | https://patkarinfotechwebsiteautomation-jnf.vercel.app | Public app URL |

3. Save variables. Deploy the updated source from this workspace using the project's connected Git repository or an authorized Vercel CLI deployment. Redeploying an old commit will not include these implementation changes.
4. Confirm Framework Preset **Next.js**, build command `npm run build`, and no custom Output Directory override.
5. Deployments > select the deployment containing the updated source > Redeploy > Production. Rebuild without the previous build cache to ensure public values are embedded. Wait for Ready and verify the production domain points to that deployment.
6. WhatsApp still requires its separate server credentials and Meta webhook setup in `WHATSAPP_SETUP.md`. Supabase connectivity alone does not establish WhatsApp delivery.

## Verify persistence and authorization after deployment

1. In a fresh browser session, open the production URL: it must show sign-in, or an explicit setup error when configuration is absent. It must not open sample records.
2. Sign in as Admin. Create a lead, client, conversation, draft quotation, project and linked task. Record a small payment against the project. Note the record UUIDs from the SQL editor or browser Network responses.
3. Edit each record. Reload the page fully and sign out/in. Confirm values and IDs match both the UI and `public.records`, including payment/project links. Confirm dashboard payment totals match the stored receipts and project values. Do not delete existing business data during verification.
4. Incoming signed WhatsApp events should appear in `public.messages` and survive refresh. Outbound messages require valid Meta setup, consent and service-window/template checks; do not send test messages to real customers.
5. Assign a lead/conversation to Sales A and a project/task to Developer A. Sign in as Sales B and confirm the first user's rows/messages are absent, direct record updates cannot change them, project/payment access is blocked, and profile role escalation fails. Developer A should only see assigned permitted entities.
6. Call `/api/records` and `/api/messages` without Authorization: expect 401. Invalid/expired tokens must also return 401 once Supabase is configured. Valid users with no team role must be denied. RLS-filtered unauthorized reads can return empty rows; write attempts must either fail or affect zero rows.
7. Temporarily simulate offline requests in browser developer tools and reload: expect an explicit error, never demo rows. Restore connectivity and Retry.

Automated tests verify unauthenticated API rejection locally. Real database CRUD, persistence after browser refresh, SQL policy tests, and production connectivity remain unverified until the above steps run with authorized credentials.

## Public workspace access

Set `NEXT_PUBLIC_PUBLIC_WORKSPACE=true` and `NEXT_PUBLIC_DEMO_MODE=false` in `.env.local` to open real data without sign-in. Restart/rebuild after changes. All website visitors can use the workspace APIs as Admin, including editing and deleting records, team management and configured messaging actions. The service role key stays on the server. Set public workspace to false to restore sign-in and normal per-user permissions.

Public access still requires the migrations above and at least one existing team profile. New records default to the first Admin profile (or first available profile); public requests do not identify individual visitors in the audit trail.
