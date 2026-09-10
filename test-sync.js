/* Exercises the real Sync code against a mock GitHub and an in-memory
   IndexedDB. Nobody had ever confirmed this app can actually write a set to
   the repo — the token step was being blamed for a path that had never run.
   Run: node test-sync.js */
const fs=require("fs"), vm=require("vm");
const src=fs.readFileSync("index.html","utf8").split('<script>\n"use strict";')[1].split("</script>")[0];
const noop=()=>{};

/* ---- minimal in-memory IndexedDB ---- */
function makeIDB(){
  const stores={events:new Map(),kv:new Map(),photos:new Map()};
  let auto=1;
  const req=(fn)=>{ const r={}; setTimeout(()=>{ try{ r.result=fn(); r.onsuccess&&r.onsuccess(); }
    catch(e){ r.error=e; r.onerror&&r.onerror(); } },0); return r; };
  return { open(){ const r={}; setTimeout(()=>{ r.result={
        objectStoreNames:{contains:()=>true},
        transaction(name){ const t={};
          setTimeout(()=>t.oncomplete&&t.oncomplete(),0);
          t.objectStore=()=>({
            add:(v)=>{ const id=auto++; stores[name].set(id,Object.assign({},v,{id})); return {result:id}; },
            put:(v,k)=>{ const key=k!==undefined?k:v.id; stores[name].set(key,v); return {result:key}; },
            get:(k)=>({result:stores[name].get(k)}),
            getAll:()=>({result:[...stores[name].values()]}),
          });
          return t; },
      }; r.onsuccess&&r.onsuccess(); },0); return r; }, _stores:stores };
}

/* ---- mock GitHub ---- */
const CALLS=[]; const FILES={};
function mockFetch(url, opts){
  opts=opts||{}; CALLS.push({url, method:opts.method||"GET", headers:opts.headers||{}, body:opts.body});
  const m=url.match(/\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
  const path=m?decodeURIComponent(m[3]):null;
  if((opts.method||"GET")==="GET"){
    if(path && FILES[path]!==undefined)
      return Promise.resolve({ok:true,status:200,json:async()=>({sha:"sha_"+path,content:Buffer.from(FILES[path]).toString("base64")})});
    return Promise.resolve({ok:false,status:404,json:async()=>({})});
  }
  const body=JSON.parse(opts.body);
  FILES[path]=Buffer.from(body.content,"base64").toString("utf8");
  return Promise.resolve({ok:true,status:body.sha?200:201,json:async()=>({content:{path}})});
}

const stub={classList:{add:noop,remove:noop,toggle:noop},addEventListener:noop,setAttribute:noop,
  querySelector:()=>stub,querySelectorAll:()=>[],insertAdjacentHTML:noop,set innerHTML(v){},get innerHTML(){return""},
  textContent:"",value:"",dataset:{},click:noop,style:{}};
const ctx={self:{},top:{},console,addEventListener:noop,
  document:{addEventListener:noop,querySelector:()=>stub,querySelectorAll:()=>[],createElement:()=>stub,body:stub},
  indexedDB:makeIDB(),navigator:{storage:null},location:{},
  setInterval:noop,setTimeout:(f,ms)=>setTimeout(f,ms),clearTimeout,
  crypto:{getRandomValues:a=>a,subtle:{}},fetch:mockFetch,
  btoa:s=>Buffer.from(s,"binary").toString("base64"),atob:s=>Buffer.from(s,"base64").toString("binary"),
  alert:noop,confirm:()=>true,CSS:{escape:s=>s},TextEncoder,TextDecoder,URL,Buffer};
ctx.self.top=ctx.top; ctx.window=ctx; vm.createContext(ctx);
vm.runInContext('"use strict";'+src, ctx, {filename:"overload.js"});
const run=c=>vm.runInContext(c,ctx);

let pass=0,fail=0;
const ok=(n,c,e)=>{ if(c){pass++;console.log("  ✓ "+n);} else {fail++;console.log("  ✗ "+n+(e?"  → "+e:""));} };

(async ()=>{
  // boot() runs on script load and calls Sync.init(); let it settle first or it
  // overwrites the test's setup a tick later.
  await new Promise(r=>setTimeout(r,250));
  console.log("\nSYNC — can this app actually write a set to GitHub?");
  await run(`(async()=>{
    S.events=[]; S.settings=defaultSettings();
    S.settings.startDate="2026-09-01"; S.settings.rampUntil="2026-09-22";
    for(const m of MUSCLES) S.mus[m]=newMuscleState();
    for(const j of JOINTS) S.irr[j]={sev:0,at:null,quality:null};
    S.ex={}; S.sessions=[]; S.plans={}; S.planEdits={}; S.voided=new Set();
    S.bw=[]; S.waist=[]; S.notes=[]; S.diffs=[];
    Sync.token="github_pat_TESTTOKEN"; Sync.owner="meni-gottesman"; Sync.repo="overload-data";
    Sync.pending=[];
    await append("settings",{startDate:"2026-09-11",rampUntil:"2026-10-02"});
    await append("set",{d:"2026-09-11",ex:"lat_pulldown",load:45.36,reps:8,rir:2,
      endpoint:"STOPPED_AT_RIR",warmup:false,rom:1,assisted:0,calibration:false,
      priorHard:0,hoursSince:999,pos:1,pReps:6});
    await Sync.flush();
    SYNC_STATE = Sync.state; SYNC_PENDING = Sync.pending.length; SYNC_ERR = Sync.lastErr;
  })()`);
  await new Promise(r=>setTimeout(r,300));

  const TODAY=run("todayISO()");
  const SHARD=`log/${TODAY.slice(0,4)}/${TODAY.slice(5,7)}/${TODAY}.ndjson`;
  const puts=CALLS.filter(c=>c.method==="PUT");
  console.log("  (first PUT headers = "+JSON.stringify((puts[0]||{}).headers)+")");
  const logPut=puts.find(c=>/contents\/log\//.test(c.url));
  const statePut=puts.find(c=>/contents\/state\.json/.test(c.url));

  ok("sync reports success", ctx.SYNC_STATE==="ok", ctx.SYNC_STATE+" "+(ctx.SYNC_ERR||""));
  ok("the pending queue drains", ctx.SYNC_PENDING===0, ctx.SYNC_PENDING);
  ok("it writes a dated log shard", !!logPut, logPut?logPut.url.split("/contents/")[1]:"none");
  ok("shard path is log/YYYY/MM/YYYY-MM-DD.ndjson",
     !!logPut && logPut.url.endsWith(SHARD), logPut&&logPut.url.split("/contents/")[1]);
  ok("it writes the derived-state snapshot", !!statePut);
  ok("auth header is a bearer token", (puts[0]||{headers:{}}).headers.Authorization==="Bearer github_pat_TESTTOKEN");
  ok("it pins the GitHub API version", !!(puts[0]||{headers:{}}).headers["X-GitHub-Api-Version"]);

  const written = FILES[SHARD]||"";
  const lines = written.split("\n").filter(Boolean).map(l=>JSON.parse(l));
  ok("both events reached the file", lines.length===2, lines.length);
  ok("the set survives the round trip with its load and reps",
     lines.some(l=>l.type==="set" && l.payload.reps===8 && Math.abs(l.payload.load-45.36)<1e-6),
     JSON.stringify(lines.map(l=>l.type)));
  ok("every line is valid standalone JSON", lines.every(l=>l.id&&l.type&&l.payload));
  ok("the file ends with a newline so appends do not corrupt it", /\n$/.test(written));

  console.log("\nAPPEND — a second session must not clobber the first");
  CALLS.length=0;
  await run(`(async()=>{
    await append("set",{d:"2026-09-11",ex:"lat_pulldown",load:45.36,reps:7,rir:1,
      endpoint:"STOPPED_AT_RIR",warmup:false,rom:1,assisted:0,calibration:false,
      priorHard:1,hoursSince:999,pos:1,pReps:6});
    await Sync.flush();
  })()`);
  await new Promise(r=>setTimeout(r,300));
  const after=(FILES[SHARD]||"").split("\n").filter(Boolean);
  console.log("  (PUT calls this step = "+CALLS.filter(c=>c.method==="PUT").length+")");
  ok("the earlier events are still there", after.length===3, after.length+" lines");
  ok("the update sends the existing sha (no blind overwrite)",
     CALLS.filter(c=>c.method==="PUT" && /log\//.test(c.url)).every(c=>JSON.parse(c.body).sha));

  console.log("\nIDEMPOTENCE — a retried flush must not duplicate lines");
  await run(`(async()=>{
    Sync.pending = S.events.slice();   // simulate a retry of everything
    await Sync.flush();
  })()`);
  await new Promise(r=>setTimeout(r,300));
  const final=(FILES[SHARD]||"").split("\n").filter(Boolean);
  ok("re-flushing every event adds nothing", final.length===3, final.length+" lines");

  console.log("\nAUTH FAILURE — a bad token must be loud, not silent");
  ctx.fetch = (u,o)=>{ CALLS.push({url:u,method:(o||{}).method||"GET",headers:(o||{}).headers||{},body:(o||{}).body});
    return Promise.resolve({ok:false,status:401,json:async()=>({message:"Bad credentials"})}); };
  CALLS.length=0;
  await run(`(async()=>{
    Sync.pending=[{id:999,type:"set",d:"2026-09-12",payload:{d:"2026-09-12"}}];
    await Sync.flush();
    AUTH_STATE=Sync.state; AUTH_PENDING=Sync.pending.length;
  })()`);
  await new Promise(r=>setTimeout(r,300));
  console.log("  (calls during auth-failure step = "+CALLS.length+", first status path = "+((CALLS[0]||{}).url||"none")+")");
  ok("state becomes unauthorized", ctx.AUTH_STATE==="unauthorized", ctx.AUTH_STATE);
  ok("the unsent event is NOT dropped", ctx.AUTH_PENDING===1, ctx.AUTH_PENDING);

  console.log("\nREGRESSION — the bug that kept backup from ever starting");
  /* kvGet on a MISSING key used to resolve to the IDBRequest object rather
     than undefined, because the guard tested `out.result !== undefined`
     instead of testing for the property. `kvGet("gh_pending") || []` then
     produced an object, and the first Sync.pending.find(...) on Connect threw
     "not a function". Backup could never start on a device that had not
     already stored a queue. */
  await run(`(async()=>{
    MISSING = await kvGet("definitely_not_stored");
    MISSING_TYPE = MISSING === undefined ? "undefined" : typeof MISSING;
    await kvPut("roundtrip", {a:1});
    RT = (await kvGet("roundtrip")||{}).a;
    // a device that has never connected
    Sync.token=null; Sync.owner=null; Sync.repo=null; Sync.pending=[];
    await Sync.init();
    FRESH_PENDING_IS_ARRAY = Array.isArray(Sync.pending);
    FRESH_TOKEN = Sync.token;
    FRESH_CONFIGURED = Sync.configured();
    // now do exactly what tapping Connect does
    CONNECT_ERR="";
    try{
      Sync.owner="meni-gottesman"; Sync.repo="overload-data"; Sync.token="github_pat_X";
      for(const e of S.events) if(!Sync.pending.find(p=>p.id===e.id)) Sync.pending.push(e);
      CONNECT_QUEUED = Sync.pending.length;
    }catch(err){ CONNECT_ERR = String(err && err.message); }
  })()`);
  await new Promise(r=>setTimeout(r,300));
  ok("a missing key reads as undefined, not an IDBRequest", ctx.MISSING_TYPE==="undefined", ctx.MISSING_TYPE);
  ok("a stored value still round-trips", ctx.RT===1, ctx.RT);
  ok("pending is an array on a device that never connected", ctx.FRESH_PENDING_IS_ARRAY===true);
  ok("token reads null, not a truthy object", ctx.FRESH_TOKEN===null, JSON.stringify(ctx.FRESH_TOKEN));
  ok("a fresh device does not claim to be configured", ctx.FRESH_CONFIGURED===false);
  ok("tapping Connect does not throw", ctx.CONNECT_ERR==="", ctx.CONNECT_ERR);
  ok("Connect queues the existing history for upload", ctx.CONNECT_QUEUED>0, ctx.CONNECT_QUEUED+" events");

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail?1:0);
})();
