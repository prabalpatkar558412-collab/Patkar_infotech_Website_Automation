import {createHmac,timingSafeEqual} from "node:crypto";
import {serviceDb} from "./supabase-server";
import {inWindow} from "./domain";
export function validSignature(raw:string|Uint8Array,signature:string|null,secret:string){if(!signature||!secret||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;const expected="sha256="+createHmac("sha256",secret).update(raw).digest("hex");const a=Buffer.from(expected),b=Buffer.from(signature);return a.length===b.length&&timingSafeEqual(a,b)}
export async function sendMessage(db:ReturnType<typeof serviceDb>,conversation:any,input:any,key:string){
 if(process.env.WHATSAPP_POLICY_VERIFIED!=="true")throw new Error("Review current Meta policy and complete WhatsApp setup before sending");
 const c=conversation.data;if(c.opt_out||!c.consent)throw new Error("Recorded recipient consent is required");
 let payload:any={messaging_product:"whatsapp",to:c.phone};
 if(input.template){const {data:t}=await db.from("records").select("*").eq("id",input.template).eq("kind","templates").single();if(!t||t.data.status!=="Approved")throw new Error("An approved Meta template is required");payload={...payload,type:"template",template:{name:t.data.name,language:{code:t.data.language}}};}
 else {if(!inWindow(c.last_inbound))throw new Error("Customer service window closed. Select an approved template.");if(input.media){if(!["image","document","video","audio"].includes(input.media.type)||!input.media.id)throw new Error("Unsupported attachment");payload={...payload,type:input.media.type,[input.media.type]:{id:input.media.id}}}else{if(!input.body?.trim()||input.body.length>4096)throw new Error("Message must contain 1–4096 characters");payload={...payload,type:"text",text:{body:input.body}}}}
 const {data:existing}=await db.from("messages").select("*").eq("idempotency_key",key).maybeSingle();if(existing){if(existing.conversation_id!==conversation.id)throw new Error("Idempotency key permission denied");return existing;}
 const {data:message,error}=await db.from("messages").insert({conversation_id:conversation.id,direction:"out",body:input.body||`Template: ${input.template||input.media?.type}`,status:"sending",idempotency_key:key}).select().single();if(error)throw error;
 try{if(!process.env.WHATSAPP_API_VERSION||!process.env.WHATSAPP_PHONE_NUMBER_ID||!process.env.WHATSAPP_ACCESS_TOKEN)throw new Error("Missing WhatsApp server configuration");
 const response=await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:"POST",headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
 const result=await response.json();if(!response.ok||!result.messages?.[0]?.id){await db.from("messages").update({status:"failed",error:result.error?.message||"API rejected message"}).eq("id",message.id);throw new Error(result.error?.message||"API rejected message")}
 const {data:updated,error:updateError}=await db.from("messages").update({status:"accepted",wa_id:result.messages[0].id}).eq("id",message.id).select().single();if(updateError)throw updateError;return updated;
 }catch(error){await db.from("messages").update({status:"unknown",error:"Check Meta before retrying; delivery outcome may be ambiguous"}).eq("id",message.id).eq("status","sending");throw error}
}
