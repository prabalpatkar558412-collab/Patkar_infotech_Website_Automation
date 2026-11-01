import {createWebhookHandlers} from "@/lib/whatsapp-webhook";
import {serviceDb} from "@/lib/supabase-server";
export const runtime = "nodejs";
// Public Meta endpoint, authenticated by token or signed body, without application login.
const handlers = createWebhookHandlers(() => process.env, async (event_key, event) => {
  const {data, error} = await serviceDb().rpc("ingest_whatsapp", {event_key, event});
  if (error || typeof data !== "boolean") throw new Error("Webhook persistence failed");
});
export const GET = handlers.GET;
export const POST = handlers.POST;
