import test from "node:test";
import assert from "node:assert/strict";
import {auth,apiError} from "../lib/workspace-auth";
import {GET as records,POST as writeRecord} from "../app/api/records/route";
import {GET as messages} from "../app/api/messages/route";
test("protected APIs reject requests without credentials",async()=>{
 for(const handler of [records,writeRecord,messages]){
 const response=await handler(new Request("http://localhost/api/records"));
 assert.equal(response.status,401);assert.equal((await response.json()).error,"Unauthorized");
 }
});
test("role and RLS errors return forbidden",()=>{
 assert.equal(apiError(new Error("No team role assigned")).status,403);
 assert.equal(apiError({code:"42501",message:"row-level security policy"}).status,403);
 assert.equal(apiError(new Error("Supabase is not configured")).status,503);
});

test("public workspace explicitly allows anonymous access through server credentials",async()=>{
 const names=["NEXT_PUBLIC_PUBLIC_WORKSPACE","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
 const saved=names.map(n=>process.env[n]);const originalFetch=globalThis.fetch;
 try{
 process.env.NEXT_PUBLIC_PUBLIC_WORKSPACE="true";
 process.env.NEXT_PUBLIC_SUPABASE_URL="https://workspace.supabase.co";
 process.env.SUPABASE_SERVICE_ROLE_KEY="test-server-key";
 globalThis.fetch=async()=>Response.json([{id:"11111111-1111-4111-8111-111111111111",name:"Workspace owner",role:"Admin"}]);
 const context=await auth(new Request("http://localhost/api/records"));
 assert.equal(context.profile.role,"Admin");assert.equal(context.user.id,context.profile.id);
 globalThis.fetch=async()=>Response.json([]);
 await assert.rejects(()=>auth(new Request("http://localhost/api/records")),/Create a team profile/);
 }finally{globalThis.fetch=originalFetch;names.forEach((n,i)=>{if(saved[i]===undefined)delete process.env[n];else process.env[n]=saved[i]})}
});
