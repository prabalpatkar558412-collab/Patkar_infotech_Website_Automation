from pathlib import Path
Path('app/api/records/route.ts').write_text('''import {auth,apiError} from "@/lib/supabase";
import {schemas,kinds,Kind,canAccess} from "@/lib/domain";
export async function GET(req:Request){try{const {db}=await auth(req);const [{data,error},{data:team}]=await Promise.all([db.from("records").select("*").order("created_at",{ascending:false}),db.from("profiles").select("id,name,role")]);if(error)throw error;return Response.json({records:data,team});}catch(e){return apiError(e)}}
export async function POST(req:Request){try{
 const {db,user,profile}=await auth(req);const body=await req.json();const kind=body.kind as Kind;
 if(!kinds.includes(kind))throw new Error("Invalid record type");
 if(body.action==="convert"){const {data,error}=await db.rpc("convert_lead",{lead:body.id});if(error)throw error;return Response.json(data)}
 let old:any=null;if(body.id){const {data,error}=await db.from("records").select("*").eq("id",body.id).single();if(error)throw error;old=data;if(old.kind!==kind)throw new Error("Invalid record type")}
 const assigned=body.assigned_to||old?.assigned_to||user.id;
 if(!canAccess(profile.role,kind,old?.assigned_to||assigned,user.id)||!canAccess(profile.role,kind,assigned,user.id))throw new Error("Insufficient permission");
 if(body.action==="delete"){const {error}=await db.from("records").delete().eq("id",body.id);if(error)throw error;return Response.json({ok:true})}
 const data=schemas[kind].parse(body.data);
 if(kind==="quotations"&&data.status!=="Draft"&&old?.data.status!==data.status&&profile.role!=="Admin")throw new Error("Admin permission required for quotation approval");
 const record={kind,data,assigned_to:assigned,lead_id:body.lead_id??old?.lead_id??null,project_id:body.project_id??old?.project_id??null};
 if(kind==="payments")record.project_id=data.project_id;
 const query=old?db.from("records").update(record).eq("id",body.id):db.from("records").insert(record);
 const {data:saved,error}=await query.select().single();if(error)throw error;return Response.json(saved);
 }catch(e){return apiError(e)}}
''',encoding='utf-8')
Path('lib/messaging.ts').write_text('''import {createHmac,timingSafeEqual} from "node:crypto";
import {serviceDb} from "./supabase";
import {inWindow} from "./domain";
export function validSignature(raw:string,signature:string|null,secret:string){if(!signature||!secret)return false;const expected="sha256="+createHmac("sha256",secret).update(raw).digest("hex");const a=Buffer.from(expected),b=Buffer.from(signature);return a.length===b.length&&timingSafeEqual(a,b)}
export async function sendMessage(db:ReturnType<typeof serviceDb>,conversation:any,input:any,key:string){
 if(process.env.WHATSAPP_POLICY_VERIFIED!=="true")throw new Error("Review current Meta policy and complete WhatsApp setup before sending");
 const c=conversation.data;if(c.opt_out||!c.consent)throw new Error("Recorded recipient consent is required");
 let payload:any={messaging_product:"whatsapp",to:c.phone};
 if(input.template){const {data:t}=await db.from("records").select("*").eq("id",input.template).eq("kind","templates").single();if(!t||t.data.status!=="Approved")throw new Error("An approved Meta template is required");payload={...payload,type:"template",template:{name:t.data.name,language:{code:t.data.language}}};}
 else {if(!inWindow(c.last_inbound))throw new Error("Customer service window closed. Select an approved template.");if(input.media){if(!["image","document","video","audio"].includes(input.media.type)||!input.media.id)throw new Error("Unsupported attachment");payload={...payload,type:input.media.type,[input.media.type]:{id:input.media.id}}}else{if(!input.body?.trim()||input.body.length>4096)throw new Error("Message must contain 1–4096 characters");payload={...payload,type:"text",text:{body:input.body}}}}
 const {data:existing}=await db.from("messages").select("*").eq("idempotency_key",key).maybeSingle();if(existing)return existing;
 const {data:message,error}=await db.from("messages").insert({conversation_id:conversation.id,direction:"out",body:input.body||`Template: ${input.template||input.media?.type}`,status:"sending",idempotency_key:key}).select().single();if(error)throw error;
 try{if(!process.env.WHATSAPP_API_VERSION||!process.env.WHATSAPP_PHONE_NUMBER_ID||!process.env.WHATSAPP_ACCESS_TOKEN)throw new Error("Missing WhatsApp server configuration");
 const response=await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:"POST",headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
 const result=await response.json();if(!response.ok||!result.messages?.[0]?.id){await db.from("messages").update({status:"failed",error:result.error?.message||"API rejected message"}).eq("id",message.id);throw new Error(result.error?.message||"API rejected message")}
 const {data:updated,error:updateError}=await db.from("messages").update({status:"accepted",wa_id:result.messages[0].id}).eq("id",message.id).select().single();if(updateError)throw updateError;return updated;
 }catch(error){await db.from("messages").update({status:"unknown",error:"Check Meta before retrying; delivery outcome may be ambiguous"}).eq("id",message.id).eq("status","sending");throw error}
}
''',encoding='utf-8')
Path('app/api/messages/route.ts').write_text('''import {auth,serviceDb,apiError} from "@/lib/supabase";
import {sendMessage} from "@/lib/messaging";
export async function GET(req:Request){try{const {db}=await auth(req);const id=new URL(req.url).searchParams.get("conversation");const {data,error}=await db.from("messages").select("*").eq("conversation_id",id).order("created_at");if(error)throw error;return Response.json(data)}catch(e){return apiError(e)}}
export async function POST(req:Request){try{const {db,profile}=await auth(req);if(!["Admin","Sales"].includes(profile.role))throw new Error("Insufficient permission");const input=await req.json();if(!/^[a-zA-Z0-9-]{16,100}$/.test(input.key))throw new Error("Invalid idempotency key");const {data:c}=await db.from("records").select("*").eq("id",input.conversation_id).eq("kind","conversations").single();if(!c)throw new Error("Conversation permission denied");return Response.json(await sendMessage(serviceDb(),c,input,input.key))}catch(e){return apiError(e)}}
''',encoding='utf-8')
