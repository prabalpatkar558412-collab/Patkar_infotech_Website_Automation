import {createClient} from "@supabase/supabase-js";
import {configured} from "./supabase";
import {serviceDb} from "./supabase-server";
export async function auth(request:Request){
 if(process.env.NEXT_PUBLIC_PUBLIC_WORKSPACE==="true"){
 const db=serviceDb();
 const {data:profiles,error}=await db.from("profiles").select("id,name,role").order("id").limit(1000);
 if(error){if(error.code==="PGRST205")throw new Error("Database setup required: run supabase/setup-fresh.sql in Supabase SQL Editor for a fresh project, then create an Admin team profile. For an existing database, check migrations and reload the schema cache.");throw error;}
 const owner=profiles?.find(p=>p.role==="Admin")||profiles?.[0];
 if(!owner)throw new Error("Create a team profile in Supabase before opening the public workspace");
 return {db,user:{id:owner.id},profile:{...owner,role:"Admin"}};
 }

 const token=request.headers.get("authorization")?.replace(/^Bearer /,"");if(!token)throw new Error("Unauthorized");
 if(!configured)throw new Error("Supabase is not configured");
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
 const {data:{user},error}=await db.auth.getUser(token);if(error||!user)throw new Error("Unauthorized");
 const {data:profile,error:profileError}=await db.from("profiles").select("*").eq("id",user.id).maybeSingle();if(profileError)throw profileError;if(!profile)throw new Error("No team role assigned");return {db,user,profile};
}
export function apiError(error:unknown){
 const e=error as {message?:string;code?:string};const message=e?.message||"Database request failed";
 const status=message==="Unauthorized"?401:/permission|team role/i.test(message)||e?.code==="42501"?403:message.includes("configured")?503:400;
 return Response.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
}
