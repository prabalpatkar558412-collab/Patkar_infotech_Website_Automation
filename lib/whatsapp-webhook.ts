import {validSignature} from "./messaging";

type Environment = Record<string, string | undefined>;
type Persist = (key: string, event: Record<string, unknown>) => Promise<void>;

export function createWebhookHandlers(environment: () => Environment, persist: Persist) {
  return {
    async GET(req: Request) {
      const token = environment().WHATSAPP_VERIFY_TOKEN;
      if (!token) return new Response("Webhook configuration error: WHATSAPP_VERIFY_TOKEN is missing", {status: 503});
      const p = new URL(req.url).searchParams;
      if (p.get("hub.mode") !== "subscribe" || p.get("hub.verify_token") !== token || !p.get("hub.challenge")) return new Response("Forbidden", {status: 403});
      return new Response(p.get("hub.challenge"), {headers: {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}});
    },
    async POST(req: Request) {
      const env = environment();
      const secret = env.META_APP_SECRET || env.WHATSAPP_APP_SECRET;
      if (!secret) return new Response("Webhook configuration error: META_APP_SECRET is missing", {status: 503});
      const raw = Buffer.from(await req.arrayBuffer());
      if (!validSignature(raw, req.headers.get("x-hub-signature-256"), secret)) return new Response("Invalid signature", {status: 401});
      if (!env.WHATSAPP_PHONE_NUMBER_ID) return new Response("Webhook configuration error: WHATSAPP_PHONE_NUMBER_ID is missing", {status: 503});
      let payload;
      try { payload = JSON.parse(raw.toString("utf8")); }
      catch { return new Response("Invalid JSON", {status: 400}); }
      if (payload?.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return new Response("Invalid WhatsApp payload", {status: 400});
      try {
        for (const entry of payload.entry) for (const change of entry.changes || []) {
          if (change.field !== "messages") continue;
          const v = change.value;
          if (v?.metadata?.phone_number_id !== env.WHATSAPP_PHONE_NUMBER_ID) continue;
          for (const message of v.messages || []) {
            if (!message.id || !message.from || !message.timestamp || !message.type) throw new Error("Malformed message");
            const name = v.contacts?.find((c: {wa_id: string}) => c.wa_id === message.from)?.profile?.name;
            await persist(message.id, {message, name});
          }
          for (const status of v.statuses || []) {
            if (!status.id || !["sent", "delivered", "read", "failed"].includes(status.status)) throw new Error("Malformed status");
            await persist(`${status.id}:${status.status}`, {status});
          }
        }
        // All relevant events committed before acknowledgement; retries are idempotent.
        return Response.json({received: true});
      } catch { return new Response("Webhook processing failed; retry", {status: 500}); }
    }
  };
}
