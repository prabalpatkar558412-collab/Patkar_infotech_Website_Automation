import {createClient, SupabaseClient} from "@supabase/supabase-js";
export const configured=!!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
let browserClient:SupabaseClient|undefined;
export const browserDb=()=>browserClient??=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
