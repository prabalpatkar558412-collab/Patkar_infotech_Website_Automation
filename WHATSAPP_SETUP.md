# Connect Patkar Infotech to Meta WhatsApp

Callback (GET and POST):
https://patkarinfotechwebsiteautomation-jnf.vercel.app/api/webhooks/whatsapp

Code is prepared locally. Deployment, Meta verification and an end-to-end message test have not been completed. No credentials were read or created.

## Vercel environment variables

Set these in the existing Vercel project's Settings → Environment Variables for Production. Use Preview only if intentionally testing another callback. Never prefix a secret with NEXT_PUBLIC_. Enter secrets directly into Vercel, not chat, source control or logs.

| Purpose | Exact variable | Where to obtain its value |
| --- | --- | --- |
| GET verification only | WHATSAPP_VERIFY_TOKEN | Create a long random secret locally using a password manager; use exactly the same value in Meta's Verify token field. This is not an API access token. |
| POST authentication | META_APP_SECRET | Meta App Dashboard → App settings → Basic → App secret → Show. Use the app subscribed to this WABA. |
| Receiving and sending | WHATSAPP_PHONE_NUMBER_ID | Meta App Dashboard → WhatsApp → API Setup → Phone number ID. This is the numeric asset ID, not the telephone number or WABA ID. |
| Receiving database writes | NEXT_PUBLIC_SUPABASE_URL | Supabase project → Settings → API / Data API → Project URL. This URL is public. |
| Receiving database writes | SUPABASE_SERVICE_ROLE_KEY | Supabase project → Settings → API Keys → legacy service_role key supported by this project. Server-only privileged key. |
| Existing UI login and database access | NEXT_PUBLIC_SUPABASE_ANON_KEY | Same Supabase project's legacy anon key. Public; database access is protected by RLS. Not needed for the webhook's service-role writes. |
| Sending only | WHATSAPP_ACCESS_TOKEN | Meta Business Settings → Users → System users → assign the app and WhatsApp account → generate an app token with whatsapp_business_messaging. For managing WABA subscriptions also grant whatsapp_business_management and access to the WABA. A temporary API Setup token is for testing. Monitor token expiration/revocation. |
| Sending only | WHATSAPP_API_VERSION | Select a currently supported Graph API version from Meta's dashboard/version documentation, including the v prefix. No version is hardcoded. |
| Sending gate | WHATSAPP_POLICY_VERIFIED | Keep false during receiving setup. Set true only after reviewing current policy and completing sending setup. Manual sends also require recorded consent and the existing window/template checks. |
| Automatic sending gate | WHATSAPP_AUTOMATION_ENABLED | Keep false. Set true only when explicitly enabling scheduled automation, after reviewing workflows and consent. This is separate from manual sending. |
| Worker only | WORKER_SECRET | A separate long random secret you generate locally. Configure it in the scheduler's Authorization: Bearer header. Not required for receiving. |
| Existing app configuration | NEXT_PUBLIC_APP_URL | https://patkarinfotechwebsiteautomation-jnf.vercel.app (public). Keep Supabase Auth redirects configured for the production URL and /reset-password. |

META_APP_SECRET replaces WHATSAPP_APP_SECRET. The old name is temporarily accepted if META_APP_SECRET is unset; META_APP_SECRET takes precedence if both exist. Remove the old Vercel variable after migration. Neither is exposed by this code to the browser or logged. `.env.example` contains empty placeholders and disabled sending gates only.

GET verification needs only WHATSAPP_VERIFY_TOKEN. Receiving needs META_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY plus the migrations. Receiving does not require an access token, API version or sending gates.

## Database and deployment

1. Back up the production database. If this is a new Supabase project, apply 001_workspace.sql and 002_scheduling_and_history.sql in order and create the first Admin profile as described in README.md. Do not reapply these initial migrations to an existing database.
2. Apply supabase/migrations/003_webhook_hardening.sql once through Supabase SQL Editor. It replaces the existing ingestion function without changing the UI schema. It serializes new-contact creation per sender, retains transactional event/message deduplication and retries delivery statuses that arrive before an outbound message is committed.
3. Run supabase/tests.sql in SQL Editor. It rolls back test data and checks actual database deduplication, a second enquiry reusing one lead/conversation, reply cancellation and STOP handling. These database checks were not executed locally; no connected database is available. The SQL script does not simulate concurrent sessions; the advisory lock is the concurrency protection.
4. Add Vercel environment variables above, leaving both sending gates false. Commit/push the local changes to the connected repository and redeploy Production. Changes to environment variables require a new deployment.
5. Retain the checked-in vercel.json (Next.js preset, default output); do not set output to public. Ensure Vercel Deployment Protection, firewall challenges or any upstream login do not prevent Meta reaching this production callback. There is no application auth/middleware on this route.

## Meta setup

1. Open the intended app in Meta for Developers and its WhatsApp use case/product. Confirm the WABA and registered Cloud API phone number belong to the intended business. For testing, follow API Setup's permitted test-recipient procedure.
2. In WhatsApp → Configuration → Webhooks (or Webhooks → WhatsApp Business Account), edit the callback URL to the exact HTTPS URL above. Enter the same private WHATSAPP_VERIFY_TOKEN stored in Vercel. Click Verify and save. A valid subscribe GET returns the unmodified challenge as text/plain with HTTP 200. Wrong token/mode or missing challenge returns 403; missing server token returns a clear 503 configuration error.
3. Subscribe to the **messages** webhook field for the **whatsapp_business_account** object. It carries incoming messages and outgoing delivery/read/failure statuses. Saving/verifying the callback alone is insufficient.
4. Subscribe this app to the actual WABA as well. In Meta's Graph API Explorer select this app and a token with whatsapp_business_management and access to this WABA. Execute POST /<WABA_ID>/subscribed_apps using a currently supported API version. Then GET /<WABA_ID>/subscribed_apps and confirm the intended app ID is present. WABA ID is shown in WhatsApp API Setup / Business Settings → Accounts → WhatsApp accounts. It is needed for this setup step, not an application environment variable. Keep tokens in the tool's token field, not URL query strings or logs.
5. Use Meta's messages webhook test, then send a real WhatsApp message from a separate permitted phone to the configured number. Dashboard sample phone IDs may differ from the configured number; such samples are intentionally ignored. Confirm an inbox message, one conversation and one lead in Supabase/the signed-in UI. Resend/replay an identical signed event and confirm there is still only one message. Send a second distinct message from the same phone and confirm the existing lead is reused. No automatic reply should be sent.
6. After separately enabling manual sending (policy gate and recorded recipient consent), send a deliberate reply within the service window or an approved template as appropriate. Confirm Meta accepts it and webhook delivery/read statuses update the existing outgoing message. Only after successful verification and an end-to-end real-message test should this connection be considered complete.

## Persistence and limits

POST validates HMAC-SHA256 over the original bytes with constant-time comparison before JSON parsing. Missing/malformed/incorrect signatures return 401. Missing POST secret or phone configuration returns 503. Database/RPC errors return 500 so Meta can retry; success is never returned for a failed relevant write. Events are acknowledged only after synchronous database commits; no detached background task or outgoing API call is started. Partial-batch retries are safe through transactional event keys and unique WhatsApp message IDs. A status for an unknown outgoing message returns 500 rather than being permanently marked consumed; messages sent outside this app need reconciliation. Signed events for other phone IDs or unsubscribed field types are intentionally ignored with 200. Existing duplicate leads are not merged by this migration.

## Publishing and official-source verification

Checked 31 October 2026. Meta's current developers.facebook.com overview, permissions, App Review and Graph webhook pages returned HTTP 429. Consequently a complete current publishing checklist could not be verified; do not treat the following account-dependent items as a verified approval determination.

Meta's official Postman Cloud API collection confirms WABA app subscription and documents tokens/WhatsApp permissions:
https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api

Meta's official Embedded Signup collection documents App Review and Advanced Access for releasing an integration that onboards business customers:
https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup

For Patkar's own WABA, first determine the app's own-business access in the dashboard; webhook URL verification is not App Review and does not prove production eligibility. If onboarding other businesses, follow the current Tech Provider/Embedded Signup process and obtain the applicable Advanced Access/App Review approvals. Do not assume every own-business integration must undergo that separate provider review.

Before public release inspect the app dashboard's required actions, publication/Live-mode controls, business verification, requested permission access levels, real-number registration/display-name status and any payment requirements. Complete the privacy-policy/contact/data-deletion information the dashboard requires and confirm URLs actually exist; this change does not create legal pages. Exact applicability remains to be checked in the authenticated dashboard/current documentation, particularly for provider access verification requirements that may have changed.

Official references to revisit once accessible:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions
- https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review/
- https://business.whatsapp.com/policy

## Local validation

`npm test`: 14 passed, including GET success/403/missing configuration, signed Unicode payloads, missing/wrong/tampered signatures, legacy secret precedence, persistence failure, ignored phone IDs and automation gate checks. `npm run build`: passed, including TypeScript. Test persistence uses a stub; real SQL and Meta end-to-end checks remain manual. No UI files changed.
