import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {readFileSync, existsSync} from "node:fs";
import {createWebhookHandlers} from "../lib/whatsapp-webhook";

const env = {WHATSAPP_VERIFY_TOKEN:"test-verify", META_APP_SECRET:"test-secret", WHATSAPP_PHONE_NUMBER_ID:"123"};
const url = "https://example.test/api/webhooks/whatsapp";
const payload = {object:"whatsapp_business_account",entry:[{changes:[{field:"messages",value:{metadata:{phone_number_id:"123"},contacts:[{wa_id:"9191",profile:{name:"Customer"}}],messages:[{id:"wamid.in",from:"9191",timestamp:"1793400000",type:"text",text:{body:"Hello 👋"}}],statuses:[{id:"wamid.out",status:"delivered"}]}}]}]};
function signed(body = JSON.stringify(payload), secret = env.META_APP_SECRET) {
  return new Request(url,{method:"POST",body,headers:{"X-Hub-Signature-256":"sha256="+createHmac("sha256",secret).update(Buffer.from(body)).digest("hex")}});
}
test("GET verifies without login and returns exact plain-text challenge",async()=>{
  const h=createWebhookHandlers(()=>env,async()=>{throw Error("GET must not access database");});
  const r=await h.GET(new Request(url+"?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=001234"));
  assert.equal(r.status,200);assert.match(r.headers.get("content-type")!,/text\/plain/);assert.equal(await r.text(),"001234");
  for(const query of ["hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1","hub.mode=bad&hub.verify_token=test-verify&hub.challenge=1","hub.mode=subscribe&hub.verify_token=test-verify"]){assert.equal((await h.GET(new Request(url+"?"+query))).status,403);}
  assert.equal((await createWebhookHandlers(()=>({}),async()=>{}).GET(new Request(url))).status,503);
});
test("POST authenticates exact bytes and persists messages and statuses before 200",async()=>{
  const events:any[]=[];const h=createWebhookHandlers(()=>env,async(key,event)=>{events.push({key,event});});
  assert.equal((await h.POST(signed())).status,200);assert.deepEqual(events.map(e=>e.key),["wamid.in","wamid.out:delivered"]);assert.equal(events[0].event.name,"Customer");
  assert.equal((await h.POST(signed(undefined,"wrong"))).status,401);
  const changed=signed();const signature=changed.headers.get("x-hub-signature-256")!;
  assert.equal((await h.POST(new Request(url,{method:"POST",body:JSON.stringify(payload)+" ",headers:{"x-hub-signature-256":signature}}))).status,401);
  assert.equal((await h.POST(new Request(url,{method:"POST",body:"{}"}))).status,401);
  assert.equal(events.length,2);
});
test("POST configuration, invalid JSON and persistence failures never report success",async()=>{
  assert.equal((await createWebhookHandlers(()=>({}),async()=>{}).POST(signed())).status,503);
  assert.equal((await createWebhookHandlers(()=>({...env,WHATSAPP_PHONE_NUMBER_ID:undefined}),async()=>{}).POST(signed())).status,503);
  const h=createWebhookHandlers(()=>env,async()=>{throw Error("private database error");});
  const failed=await h.POST(signed());assert.equal(failed.status,500);assert.doesNotMatch(await failed.text(),/private/);
  assert.equal((await h.POST(signed("{"))).status,400);
  assert.equal((await h.POST(signed("{}"))).status,400);
});
test("legacy app secret supported; primary secret takes precedence; unrelated numbers ignored",async()=>{
  assert.equal((await createWebhookHandlers(()=>({...env,META_APP_SECRET:undefined,WHATSAPP_APP_SECRET:env.META_APP_SECRET}),async()=>{}).POST(signed())).status,200);
  assert.equal((await createWebhookHandlers(()=>({...env,WHATSAPP_APP_SECRET:"old"}),async()=>{}).POST(signed(undefined,"old"))).status,401);
  assert.equal((await createWebhookHandlers(()=>({...env,WHATSAPP_PHONE_NUMBER_ID:"other"}),async()=>{throw Error();}).POST(signed())).status,200);
});
test("public route has no application auth or middleware and worker requires explicit opt-in",()=>{
  const route=readFileSync("app/api/webhooks/whatsapp/route.ts","utf8");assert.doesNotMatch(route,/\bauth\(/);
  for(const file of ["middleware.ts","middleware.js","proxy.ts","proxy.js","src/middleware.ts","src/proxy.ts"])assert.equal(existsSync(file),false);
  assert.match(readFileSync("app/api/worker/route.ts","utf8"),/WHATSAPP_AUTOMATION_ENABLED!=="true"/);
  const sql=readFileSync("supabase/migrations/003_webhook_hardening.sql","utf8");assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/on conflict do nothing;if not found then return false/);
});
