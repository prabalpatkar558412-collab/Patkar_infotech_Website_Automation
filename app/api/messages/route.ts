import {auth,apiError} from "@/lib/workspace-auth";
import {serviceDb} from "@/lib/supabase-server";
import {sendMessage} from "@/lib/messaging";
export async function GET(req:Request){try{
 const {db}=await auth(req);const id=new URL(req.url).searchParams.get("conversation");
 if(!id||! /^[0-9a-f-]{36}$/i.test(id))throw new Error("Valid conversation ID required");
 const {data:c,error:contactError}=await db.from("records").select("id").eq("id",id).eq("kind","conversations").maybeSingle();
 if(contactError)throw contactError;if(!c)throw new Error("Conversation permission denied");
 const messages=[];for(let offset=0;;offset+=500){const {data,error}=await db.from("messages").select("*").eq("conversation_id",id).order("created_at").order("id").range(offset,offset+499);if(error)throw error;messages.push(...data);if(data.length<500)break;}
 return Response.json(messages,{headers:{"Cache-Control":"no-store"}});
 }catch(e){return apiError(e)}}
export async function POST(req:Request){try{const {db,profile}=await auth(req);if(!["Admin","Sales"].includes(profile.role))throw new Error("Insufficient permission");const input=await req.json();if(!/^[a-zA-Z0-9-]{16,100}$/.test(input.key))throw new Error("Invalid idempotency key");const {data:c}=await db.from("records").select("*").eq("id",input.conversation_id).eq("kind","conversations").single();if(!c)throw new Error("Conversation permission denied");return Response.json(await sendMessage(serviceDb(),c,input,input.key))}catch(e){return apiError(e)}}
