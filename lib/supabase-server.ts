import {createClient} from "@supabase/supabase-js";
// This module must never be imported by a client component.
export function serviceDb(){
 if(typeof window!=="undefined")throw new Error("Server credentials cannot be used in a browser");
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new Error("Supabase server credentials are not configured");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
