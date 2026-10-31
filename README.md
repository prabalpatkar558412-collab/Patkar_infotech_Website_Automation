# Patkar Infotech workspace

A responsive Next.js / TypeScript / Tailwind application for leads, WhatsApp conversations, quotations, projects, tasks, payments and follow-ups. The navy and purple interface includes a dashboard, lead table and Kanban, shared inbox, PDF quotation builder, file storage, workflows and company settings.

## Run locally

Requires Node 20.9+.

```powershell
npm install
npm run dev
```

Open http://localhost:3000. With no Supabase variables, the app opens in **Demo workspace**. Sample records and messages persist in this browser's localStorage. Demo schedules do not run in the background. Nothing in demo mode calls WhatsApp. Reset sample data from Settings.

```powershell
npm test
npm run typecheck
npm run build
```

## Connect Supabase

1. Create a Supabase project. Run `supabase/migrations/001_workspace.sql` and `002_scheduling_and_history.sql`, in order, in its SQL editor. These create records, roles, references, indexes, RLS, quotation version history, audit logging, webhook event deduplication, a durable queue and a private file bucket.
2. Copy `.env.example` to `.env.local`. Fill in the project URL, anon key and server service-role key. Only variables prefixed `NEXT_PUBLIC_` enter the browser bundle. Never expose the service-role or Meta credentials.
3. Create your first user from Supabase Authentication, then run this in the SQL editor, using that user's actual UUID:

```sql
insert into public.profiles(id,name,role)
values ('YOUR-AUTH-USER-UUID','Amit Patkar','Admin');
```

4. Create or invite more Auth users and insert their profile with Sales or Developer. Admins can update roles through `/api/team` with their authenticated bearer token; the UI lists team members and assigns records by profile UUID. Public signup is deliberately absent. Restrict Auth signup in Supabase and enable email confirmation, strong passwords and appropriate Auth rate limits.
5. Add your app URL and `/reset-password` callback URL to Supabase Auth redirect allowlists. Password reset uses Supabase's email recovery session. Configure a production SMTP provider.
6. Restart Next.js after editing public environment variables. Sign in with an Auth user. Records are fetched through their JWT and RLS; no service-role key is used for browser CRUD.

Sales can read/write their assigned leads, clients, conversations, notes and draft quotations. Developers can access their assigned projects, tasks and notes. Admins manage all records and approval states. A won lead converts to a client and project in one database transaction; conversion requires Admin access. Assign project and task records to the developer, and lead/conversation/quotation records to Sales separately. File access follows the parent record's RLS.

The `records` table is a typed entity store with JSONB fields, indexed type/owner columns, and actual foreign keys for lead and project relationships. This keeps the reusable CRUD API small while preserving row-level access, financial checks and links. Messages, queue jobs, webhook events, audit logs, and quotation versions have separate tables. Payment writes lock the parent project and reject overpayments. Approved quotations are versioned on every edit; Sales cannot alter an approved quotation.

## Official WhatsApp Cloud API

This application uses only Meta's Graph API. There is no browser automation or unofficial WhatsApp client.

1. Create a Meta business app, add WhatsApp, verify your business, and register the sending number. Obtain a system-user access token with appropriate WhatsApp permissions.
2. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, and the currently supported `WHATSAPP_API_VERSION` (including its `v` prefix) on the server. No version is assumed.
3. Expose the app through HTTPS. Set the webhook callback to `https://YOUR-DOMAIN/api/webhooks/whatsapp`. Set the same verification token, subscribe the WhatsApp business account and app to the messages field, and test verification.
4. Incoming requests require a valid HMAC-SHA256 signature over the exact raw bytes, and a matching phone number ID. Message and status events are ingested transactionally through a service-role-only RPC. Both the event key and Meta message ID are unique. A processing failure returns HTTP 500 so Meta can retry.
5. Create templates in WhatsApp Manager. Record the exact approved name, language and body in Settings. Only Admin can mark a local template approved. **This release supports live templates without parameters**; do not register parameterized templates locally. Local editing does not submit a new version to Meta. Meta remains the authority on approval and may reject a send.
6. Record recipient consent and its source/date on the inbox contact. Incoming enquiries do not automatically record outbound marketing consent. STOP, UNSUBSCRIBE and CANCEL set opt-out and cancel queued jobs. A human must explicitly record a new consent before resuming opted-out contacts.
7. Review the current official policies before setting `WHATSAPP_POLICY_VERIFIED=true`. The implementation conservatively allows free-form text and supported attachments only within 24 hours of the last inbound message, and requires an approved template outside that window. Sending a template does not reopen the service window. Opt-out blocks all sending. Human handover blocks automation while permitting consented manual replies.

Official sources to verify:

- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
- https://business.whatsapp.com/policy

**Verification limitation:** Meta's developer documentation returned HTTP 429 during implementation (31 October 2026). Current official policy could not be fully verified, so live sending defaults to disabled. Review official documentation and your account's template eligibility before removing this deployment gate. Do not treat the demo as evidence of a connected or delivered message.

The API records `accepted` only after Meta returns a message ID. Delivery and read states come from signed webhooks. Timeouts and ambiguous sends become `unknown` / `review` and are never blindly replayed. Reconcile them against Meta before retrying. A database unique idempotency key prevents simultaneous duplicate API requests with the same key; upstream Meta does not provide an exactly-once delivery guarantee.

## Background jobs

Set a long random `WORKER_SECRET`. Configure your scheduler (Supabase Cron with pg_net, an external cron service, or your hosting scheduler) to POST once per minute to:

```text
POST https://YOUR-DOMAIN/api/worker
Authorization: Bearer YOUR_WORKER_SECRET
```

Keep this header in your scheduler's secret store. The worker uses PostgreSQL `FOR UPDATE SKIP LOCKED`, processes up to 20 due jobs per call, and applies exponential backoff (maximum five failed preparation attempts). Stale processing leases and uncertain external outcomes require review rather than blind resend. Deploy with a 60-second request duration; increase frequency or reduce batch size for slow API responses. Monitor the execution log, failed jobs and server logs.

Workflows automatically enqueue on new consented conversations, newly recorded consent, a lead moving to Contacted, an Admin approving a quotation, project creation, and project stage/progress changes. Advanced payment reminders can be scheduled explicitly from Automations, including the pending-payment workflow. A project must be linked to the original lead for automatic contact resolution. Every workflow uses its configured delay and Meta template. Acknowledgement and collection templates start the conversation; humans collect and record the customer's requirements and budget in the lead editor.

Jobs recheck enabled workflows, recipient consent, human handover, replies, relevant record versions, terminal statuses, project balances and template approval immediately before sending. Replies and relevant record edits cancel pending jobs in the database. Quiet hours use Asia/Kolkata and postpone work by an hour until allowed. The default is 21:00–09:00; Admins can edit this in Settings. Queueing a quotation requires its Approved state. Reminders never create payments. The UI prepares project updates from real status for human review; it does not invent progress.

## Validation and release checks

`npm test` covers owner/role isolation logic, quote math and rounding, payment validation, consent/reply/opt-out cancellation, Kolkata quiet hours and signature validation. Migration structure checks cover deduplication constraints and RPC privilege restrictions. To exercise actual PostgreSQL deduplication and cancellation, run `supabase/tests.sql` after creating an Admin. It uses a transaction and rolls back test records. This SQL test needs a real Supabase database and is not run by `npm test`.

Before production, also test with separate Admin, Sales and Developer users against your Supabase project; verify RLS by requesting another owner's record directly, exercise simultaneous payment writes, duplicate webhook replay, Meta delivery status and worker scheduling. No live Supabase or Meta credentials are included, and those end-to-end checks require your deployment.

## Deployment

For Vercel, import the directory containing `package.json` and `vercel.json` as the project root. The checked-in configuration selects the Next.js framework, runs `npm run build`, and uses its default output directory. In Project Settings → Build and Deployment, select **Next.js** and disable any Output Directory override set to `public`. Commit and push the configuration, then redeploy. Do not create an empty `public` directory to resolve `STATIC_BUILD_NO_OUT_DIR`; this application needs Next.js server routes.

Deploy as a standard Next.js Node application on a provider that supports server routes, private environment variables, HTTPS and scheduled HTTP calls. Run `npm run build` then `npm start`. Use your production URL in Auth redirects and Meta webhooks. Demo mode is suitable for local evaluation; connect Supabase for shared durable data. This project has not been published or connected to a business account automatically.
 
## Practical limits

Single business workspace per Supabase project. One primary assignee per record. Templates without parameters. Inbound attachment messages are labelled in history; downloading Meta-hosted inbound media is not included. PDF output uses the company name/contact branding; uploaded company logos are stored privately and are not embedded in PDFs. Projects support milestone/checklist text rather than independently assigned milestone records. These are explicit extension points, not simulated production capabilities.
