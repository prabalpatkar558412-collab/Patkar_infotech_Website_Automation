import {auth,apiError} from "@/lib/workspace-auth";
import {schemas,kinds,Kind,canAccess} from "@/lib/domain";
export async function GET(req:Request){try{
 const {db,profile}=await auth(req);const records=[];
 // Page through PostgREST's row limit so totals include every permitted record.
 for(let offset=0;;offset+=500){const {data,error}=await db.from("records").select("*").order("created_at",{ascending:false}).order("id").range(offset,offset+499);if(error)throw error;records.push(...data);if(data.length<500)break;}
 const {data:team,error}=await db.from("profiles").select("id,name,role");if(error)throw error;
 return Response.json({records,team,profile},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return apiError(e)}}
export async function POST(req:Request){try{
 const {db,user,profile}=await auth(req);const body=await req.json();const kind=body.kind as Kind;
 if(body.action && !["convert","delete"].includes(body.action))throw new Error("Invalid action");
 if(body.action==="delete"&&!body.id)throw new Error("Record ID required");
 if(!kinds.includes(kind))throw new Error("Invalid record type");
 if(body.action==="convert"){const {data,error}=await db.rpc("convert_lead",{lead:body.id});if(error)throw error;return Response.json(data)}
 let old:any=null;if(body.id){const {data,error}=await db.from("records").select("*").eq("id",body.id).single();if(error)throw error;old=data;if(old.kind!==kind)throw new Error("Invalid record type")}
 const assigned=body.assigned_to||old?.assigned_to||user.id;
 if(!canAccess(profile.role,kind,old?.assigned_to||assigned,user.id)||!canAccess(profile.role,kind,assigned,user.id))throw new Error("Insufficient permission");
 if(body.action==="delete"){const {error}=await db.from("records").delete().eq("id",body.id);if(error)throw error;return Response.json({ok:true})}
 const data=schemas[kind].parse(body.data) as Record<string,any>;
 if(kind==="quotations"&&data.status!=="Draft"&&old?.data.status!==data.status&&profile.role!=="Admin")throw new Error("Admin permission required for quotation approval");
 const record={kind,data,assigned_to:assigned,lead_id:body.lead_id??old?.lead_id??null,project_id:body.project_id??old?.project_id??null};
 if(kind==="payments")record.project_id=data.project_id;
 const query=old?db.from("records").update(record).eq("id",body.id):db.from("records").insert(record);
 const {data:saved,error}=await query.select().single();if(error)throw error;return Response.json(saved);
 }catch(e){return apiError(e)}}
