import {z} from "zod";
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
export const paymentSchema=z.object({amount:z.number().positive().max(100000000),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),method:z.enum(["UPI","Bank transfer","Cash","Card"]),reference:z.string().min(1).max(200),project_id:z.string().uuid()}).passthrough();
export const itemSchema=z.object({description:z.string().min(1),quantity:z.number().positive(),price:z.number().nonnegative()});
const base=z.object({name:z.string().min(1).max(200)}).passthrough();
export const schemas:Record<Kind,z.ZodTypeAny>={
 leads:base.extend({phone:z.string().regex(/^\+?[1-9]\d{7,14}$/),email:z.string().email().or(z.literal("")),stage:z.enum(["New","Contacted","Requirement Collected","Quotation Sent","Negotiation","Won","Lost"]),budget:z.number().nonnegative(),service:z.enum(["Website","App","Custom Software"])}),
 clients:base.extend({phone:z.string().regex(/^\+?[1-9]\d{7,14}$/)}),
 quotations:base.extend({items:z.array(itemSchema).min(1),discount:z.number().nonnegative(),tax:z.number().min(0).max(100),advance:z.number().min(0).max(100),status:z.enum(["Draft","Approved","Sent","Accepted","Rejected"])}),
 projects:base.extend({stage:z.enum(["Planning","Development","Testing","Delivered","Maintenance"]),value:z.number().nonnegative(),progress:z.number().min(0).max(100).optional()}),
 tasks:base.extend({status:z.enum(["To do","In progress","Done"])}),payments:paymentSchema,
 conversations:base.extend({phone:z.string().regex(/^\+?[1-9]\d{7,14}$/)}),notes:z.object({text:z.string().min(1).max(5000)}).passthrough(),
 workflows:base.extend({enabled:z.boolean(),delay:z.number().min(1),template:z.string().min(1),trigger:z.enum(["enquiry","requirements","quotation","advance","payment","milestone"])}),
 settings:base.extend({advance:z.number().min(0).max(100),quiet_start:z.number().int().min(0).max(23),quiet_end:z.number().int().min(0).max(23)}),templates:base.extend({body:z.string().min(1),status:z.enum(["Draft","Approved","Rejected"]),language:z.string().min(2)})};
export function canAccess(role:string,kind:Kind,assigned:string|null|undefined,user:string){return role==="Admin"||(role==="Sales"&&["leads","clients","quotations","conversations","notes"].includes(kind)&&assigned===user)||(role==="Developer"&&["projects","tasks","notes"].includes(kind)&&assigned===user)}
export function shouldCancel(job:any,contact:any,related:any){return !!(contact.opt_out||!contact.consent||contact.handover||!related||contact.last_inbound&&new Date(contact.last_inbound)>new Date(job.created_at)||["Won","Lost","Accepted","Rejected","Delivered"].includes(related?.stage||related?.status)||related?.outstanding===0)}
export function inWindow(last?:string){const age=last?Date.now()-new Date(last).getTime():Infinity;return age>=0&&age<86400000}
export function quietNow(start=21,end=9,date=new Date()){const h=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",hourCycle:"h23"}).format(date));return start===end?false:start>end?h>=start||h<end:h>=start&&h<end}
