import {createClient, SupabaseClient} from "@supabase/supabase-js";
export const configured=!!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
let browserClient:SupabaseClient|undefined;
export const browserDb=()=>browserClient??=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
export async function auth(request:Request){
 if(!configured)throw new Error("Supabase is not configured");
 const token=request.headers.get("authorization")?.replace(/^Bearer /,"");if(!token)throw new Error("Unauthorized");
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
 const {data:{user},error}=await db.auth.getUser(token);if(error||!user)throw new Error("Unauthorized");
 const {data:profile}=await db.from("profiles").select("*").eq("id",user.id).single();if(!profile)throw new Error("No team role assigned");return {db,user,profile};
}
export function serviceDb(){if(!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error("Missing server credentials");return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})}
export function apiError(error:unknown){const message=error instanceof Error?error.message:"Request failed";return Response.json({error:message},{status:message==="Unauthorized"?401:message.includes("permission")?403:400})}
