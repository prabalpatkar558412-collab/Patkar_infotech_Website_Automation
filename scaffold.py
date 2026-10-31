from pathlib import Path
files = {
 'tsconfig.json': '''{"compilerOptions":{"target":"ES2022","lib":["dom","dom.iterable","esnext"],"allowJs":true,"skipLibCheck":true,"strict":true,"noEmit":true,"esModuleInterop":true,"module":"esnext","moduleResolution":"bundler","resolveJsonModule":true,"isolatedModules":true,"jsx":"react-jsx","incremental":true,"plugins":[{"name":"next"}],"paths":{"@/*":["./*"]}},"include":["next-env.d.ts","**/*.ts","**/*.tsx",".next/types/**/*.ts"],"exclude":["node_modules"]}''',
 'postcss.config.mjs': 'export default { plugins: { "@tailwindcss/postcss": {} } };',
 '.gitignore': 'node_modules/\n.next/\n.env*\n!.env.example\n.npm-cache/\n*.tsbuildinfo\n',
 '.env.example': '''NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_API_VERSION=
# Set true only after reviewing the current official Meta policy and setup
WHATSAPP_POLICY_VERIFIED=false
WORKER_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
''',
 'app/layout.tsx': '''import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"Patkar Infotech · Business workspace",description:"Your conversations, clients and projects. One connected workspace."};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>}''',
 'lib/domain.ts': '''import {z} from "zod";
export const kinds = ["leads","clients","quotations","projects","tasks","payments","conversations","notes","workflows","settings","templates"] as const;
export type Kind = typeof kinds[number];
export type RecordData = {id:string;kind:Kind;data:Record<string,any>;assigned_to?:string|null;lead_id?:string|null;project_id?:string|null;created_at?:string};
export const stages=["New","Contacted","Requirement Collected","Quotation Sent","Negotiation","Won","Lost"];
export const projectStages=["Planning","Development","Testing","Delivered","Maintenance"];
export const money=(n:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(n);
export const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date());
export function totals(items:{quantity:number;price:number}[],discount=0,tax=0,advance=30){
 const subtotal=Math.round(items.reduce((s,i)=>s+i.quantity*i.price,0)*100)/100;
 const net=Math.max(0,subtotal-discount);const total=Math.round(net*(1+tax/100)*100)/100;
 const advanceDue=Math.round(total*advance)/100;return {subtotal,total,advanceDue,balance:Math.round((total-advanceDue)*100)/100};
}
export const paymentSchema=z.object({amount:z.number().positive().max(100000000),date:z.string().min(10),method:z.enum(["UPI","Bank transfer","Cash","Card"]),reference:z.string().min(1).max(200),project_id:z.string().uuid()});
export const itemSchema=z.object({description:z.string().min(1),quantity:z.number().positive(),price:z.number().nonnegative()});
const base=z.object({name:z.string().min(1).max(200)}).passthrough();
export const schemas:Record<Kind,z.ZodTypeAny>={
 leads:base.extend({phone:z.string().regex(/^\\+?[1-9]\\d{7,14}$/),email:z.string().email().or(z.literal("")),stage:z.enum(["New","Contacted","Requirement Collected","Quotation Sent","Negotiation","Won","Lost"]),budget:z.number().nonnegative(),service:z.enum(["Website","App","Custom Software"])}),
 clients:base.extend({phone:z.string().regex(/^\\+?[1-9]\\d{7,14}$/)}),
 quotations:base.extend({items:z.array(itemSchema).min(1),discount:z.number().nonnegative(),tax:z.number().min(0).max(100),advance:z.number().min(0).max(100),status:z.enum(["Draft","Approved","Sent","Accepted","Rejected"])}),
 projects:base.extend({stage:z.enum(["Planning","Development","Testing","Delivered","Maintenance"]),value:z.number().nonnegative()}),
 tasks:base.extend({status:z.enum(["To do","In progress","Done"])}),payments:paymentSchema,
 conversations:base.extend({phone:z.string().regex(/^\\+?[1-9]\\d{7,14}$/)}),notes:z.object({text:z.string().min(1).max(5000)}).passthrough(),
 workflows:base.extend({enabled:z.boolean(),delay:z.number().min(1),template:z.string().min(1),trigger:z.enum(["enquiry","requirements","quotation","advance","payment","milestone"])}),
 settings:base,templates:base.extend({body:z.string().min(1),status:z.enum(["Draft","Approved","Rejected"]),language:z.string().min(2)})};
export function canAccess(role:string,kind:Kind,assigned:string|null|undefined,user:string){return role==="Admin"||(role==="Sales"&&["leads","clients","quotations","conversations","notes"].includes(kind)&&assigned===user)||(role==="Developer"&&["projects","tasks","notes"].includes(kind)&&assigned===user)}
export function shouldCancel(job:any,contact:any,related:any){return !!(contact.opt_out||!contact.consent||contact.handover||!related||contact.last_inbound&&new Date(contact.last_inbound)>new Date(job.created_at)||["Won","Lost","Accepted","Rejected","Delivered"].includes(related?.stage||related?.status)||related?.outstanding===0)}
export function inWindow(last?:string){return !!last&&Date.now()-new Date(last).getTime()<86400000}
export function quietNow(start=21,end=9,date=new Date()){const h=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",hourCycle:"h23"}).format(date));return start===end?false:start>end?h>=start||h<end:h>=start&&h<end}
''',
 'lib/supabase.ts': '''import {createClient} from "@supabase/supabase-js";
export const configured=!!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const browserDb=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
export async function auth(request:Request){
 if(!configured)throw new Error("Supabase is not configured");
 const token=request.headers.get("authorization")?.replace(/^Bearer /,"");if(!token)throw new Error("Unauthorized");
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
 const {data:{user},error}=await db.auth.getUser(token);if(error||!user)throw new Error("Unauthorized");
 const {data:profile}=await db.from("profiles").select("*").eq("id",user.id).single();if(!profile)throw new Error("No team role assigned");return {db,user,profile};
}
export function serviceDb(){if(!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error("Missing server credentials");return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})}
export function apiError(error:unknown){const message=error instanceof Error?error.message:"Request failed";return Response.json({error:message},{status:message==="Unauthorized"?401:message.includes("permission")?403:400})}
'''
}
for name,content in files.items(): Path(name).write_text(content,encoding='utf-8')
