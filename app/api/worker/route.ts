import {timingSafeEqual} from "node:crypto";
import {serviceDb} from "@/lib/supabase";
import {shouldCancel,quietNow} from "@/lib/domain";
import {sendMessage} from "@/lib/messaging";
export const maxDuration=60;
export async function POST(req:Request){const supplied=Buffer.from(req.headers.get("authorization")||""),expected=Buffer.from(`Bearer ${process.env.WORKER_SECRET||""}`);if(!process.env.WORKER_SECRET||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return new Response("Unauthorized",{status:401});
 if(process.env.WHATSAPP_AUTOMATION_ENABLED!=="true")return Response.json({enabled:false,processed:0});
 const db=serviceDb();
 // A crashed send cannot safely be replayed. Flag stale claims for human reconciliation.
 await db.from("jobs").update({status:"review",error:"Worker lease expired. Reconcile message before retry."}).eq("status","processing").lt("locked_at",new Date(Date.now()-300000).toISOString());
 const {data:jobs,error}=await db.rpc("claim_jobs");if(error)return Response.json({error:error.message},{status:500});
 const {data:setting}=await db.from("records").select("data").eq("kind","settings").limit(1).maybeSingle();let processed=0;
 for(const job of jobs||[]){try{
 const {data:rows}=await db.from("records").select("*").in("id",[job.workflow_id,job.conversation_id,job.related_id]);const w=rows?.find(r=>r.id===job.workflow_id),c=rows?.find(r=>r.id===job.conversation_id),r=rows?.find(r=>r.id===job.related_id);
 const {data:receipts}=r?.kind==="projects"?await db.from("records").select("data").eq("kind","payments").eq("project_id",r.id):{data:[]};
 const related=r?{...r.data,...(r.kind==="projects"?{outstanding:r.data.value-(receipts||[]).reduce((s,p)=>s+Number(p.data.amount),0)}:{})}:null;
 if(!w?.data.enabled||!c||shouldCancel(job,c.data,related)||r?.updated_at!==job.snapshot.updated_at||(w.data.trigger==="quotation"&&r?.data.status!=="Approved")){await db.from("jobs").update({status:"cancelled",error:"Reply, consent, handover or relevant status changed"}).eq("id",job.id);continue}
 if(quietNow(setting?.data.quiet_start??21,setting?.data.quiet_end??9)){await db.from("jobs").update({status:"retry",run_at:new Date(Date.now()+3600000).toISOString()}).eq("id",job.id);continue}
 const {data:t}=await db.from("records").select("*").eq("kind","templates").eq("data->>name",w.data.template).limit(1).maybeSingle();if(!t||t.data.status!=="Approved")throw new Error("Template is not approved");
 const message=await sendMessage(db,c,{template:t.id},job.idempotency_key);
 if(!["accepted","sent","delivered","read"].includes(message.status)){await db.from("jobs").update({status:"review",error:`Message state: ${message.status}. Do not replay automatically.`}).eq("id",job.id);continue}
 await db.from("jobs").update({status:"completed",error:null}).eq("id",job.id);processed++;
 }catch(e){const {data:message}=await db.from("messages").select("status").eq("idempotency_key",job.idempotency_key).maybeSingle();const uncertain=!!message;await db.from("jobs").update({status:uncertain?"review":job.attempts>=5?"failed":"retry",error:(e as Error).message,run_at:new Date(Date.now()+Math.min(3600000,2**job.attempts*60000)).toISOString()}).eq("id",job.id)}}return Response.json({claimed:jobs?.length||0,processed})}
