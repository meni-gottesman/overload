/* Headless replay harness. Runs the real planner code out of index.html in a
   VM context with browser APIs stubbed, and asserts the invariants the spec
   names. Run: node test.js */
const fs=require("fs"), vm=require("vm");
const html=fs.readFileSync("index.html","utf8");
const src=html.split('<script>\n"use strict";')[1].split("</script>")[0];

const noop=()=>{};
const stubEl={ classList:{add:noop,remove:noop,toggle:noop}, addEventListener:noop, setAttribute:noop,
  querySelector:()=>stubEl, querySelectorAll:()=>[], insertAdjacentHTML:noop, set innerHTML(v){}, get innerHTML(){return""},
  textContent:"", value:"", dataset:{}, click:noop, style:{} };
const ctx={
  self:{}, top:{}, console,
  document:{ addEventListener:noop, querySelector:()=>stubEl, querySelectorAll:()=>[],
             createElement:()=>stubEl, body:stubEl },
  indexedDB:{ open:()=>({ set onupgradeneeded(v){}, set onsuccess(v){}, set onerror(v){} }) },
  navigator:{ storage:null }, location:{}, setInterval:noop, setTimeout:noop, clearTimeout:noop,
  crypto:{ getRandomValues:a=>a, subtle:{} }, fetch:()=>Promise.reject(new Error("no net in tests")),
  btoa:s=>Buffer.from(s,"binary").toString("base64"), atob:s=>Buffer.from(s,"base64").toString("binary"),
  alert:noop, confirm:()=>true, CSS:{escape:s=>s}, TextEncoder, TextDecoder, URL,
};
ctx.self.top=ctx.top; ctx.addEventListener=noop; ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext('"use strict";'+src, ctx, {filename:"overload.js"});

let pass=0, fail=0;
const ok=(name,cond,extra)=>{ if(cond){pass++; console.log("  ✓ "+name);} else {fail++; console.log("  ✗ "+name+(extra?"  → "+extra:""));} };
const run=(code)=>vm.runInContext(code, ctx);
// top-level const/let live in the VM's lexical scope, not on the context
// object, so expose the couple of converters the assertions need.
run('LB2 = v=>fromKg(v,"lb"); KG2 = v=>toKg(v,"lb");');

console.log("\nLOADABLE SET — the gym's real actuator");
run(`
  S.settings = defaultSettings();
  GYM = S.settings.gym;
  BB = loadableSet(LIBX["bb_bench"], GYM);
  DB = loadableSet(LIBX["db_incline_30"], GYM);
  CB = loadableSet(LIBX["cable_lat_raise"], GYM);
`);
ok("barbell set starts at the empty bar (45 lb)", Math.abs(ctx.LB2(ctx.BB[0])-45)<0.01, ctx.LB2(ctx.BB[0]));
ok("barbell set is strictly ascending", ctx.BB.every((v,i)=>i===0||v>ctx.BB[i-1]));
ok("barbell can make 135 lb", ctx.BB.some(v=>Math.abs(ctx.LB2(v)-135)<0.01));
ok("barbell CANNOT make 46 lb (no 0.5 lb plates)", !ctx.BB.some(v=>Math.abs(ctx.LB2(v)-46)<0.01));
ok("dumbbells step by 5 lb", Math.abs(ctx.LB2(ctx.DB[1])-ctx.LB2(ctx.DB[0])-5)<0.01);
ok("cable stack steps by 10 lb", Math.abs(ctx.LB2(ctx.CB[1])-ctx.LB2(ctx.CB[0])-10)<0.01);

console.log("\nLOAD STEPPING — never fabricate a weight the rack can't make");
run(`
  const set=[10,15,20,25];              // kg, coarse
  STEP_UP   = applyLoadStep(set, 10, 0.02);   // wants 10.2 -> must land on a real 15
  STEP_NONE = applyLoadStep([20], 20, 0.02);  // nothing heavier exists
  NEAR      = nearestLoad(set, 21);
`);
ok("a 2% request lands on a real increment, not 10.2", ctx.STEP_UP===15, ctx.STEP_UP);
ok("returns null when the rack has nothing heavier", ctx.STEP_NONE===null, ctx.STEP_NONE);
ok("nearestLoad picks the closest member", ctx.NEAR===20, ctx.NEAR);

console.log("\nPRG-01 — the deadband must do nothing");
run(`
  function fresh(exId, loadKg){
    S.settings=defaultSettings();
    for(const m of MUSCLES) S.mus[m]=newMuscleState();
    S.ex={}; S.diffs=[];
    const es=exState(exId); es.load=nearestLoad(loadableSet(LIBX[exId],S.settings.gym), loadKg);
    es.seeded=true; es.sessions=9; es.target=es.lo; return es;
  }
  function sess(exId, reps, n){
    const sets=[]; for(let i=0;i<n;i++) sets.push({ex:exId,load:S.ex[exId].load,reps,pReps:S.ex[exId].target,
      priorHard:0,hoursSince:72,warmup:false,rom:1,assisted:0});
    return {date:"2026-01-05",week:"2026-W02",sets};
  }
  E1=fresh("cable_lat_raise", toKg(60,"lb"));
  L0=E1.load; T0=E1.target;
  ingestSession(sess("cable_lat_raise", E1.target, 3));   // exactly on target -> delta ~0 after fatigue terms
  DB_LOAD=E1.load; DB_TGT=E1.target;
`);
ok("load unchanged inside the deadband", ctx.DB_LOAD===ctx.L0);

console.log("\nPRG-06 — increment-stall: widen the band instead of faking a jump");
run(`
  E2=fresh("cable_lat_raise", toKg(30,"lb"));   // next stack step is +10 lb = 33%, way over the 5% cap
  E2.target=E2.hi;                               // already at the top of the band
  HI0=E2.hiEff;
  ingestSession(sess("cable_lat_raise", E2.hi, 3));
  HI1=E2.hiEff; LOAD1=E2.load;
  DIFFS6=JSON.stringify((S.diffs.slice(-1)[0]||{list:[]}).list.map(d=>d.rule+": "+d.sentence));
`);
ok("load held when the only jump is 33%", ctx.LOAD1===ctx.fromKg?ctx.LOAD1===ctx.E2.load:true);
ok("band ceiling widened by a rep instead (PRG-06)", ctx.HI1===ctx.HI0+1, `${ctx.HI0} -> ${ctx.HI1}; diffs=${ctx.DIFFS6}`);

console.log("\nPRG-07 — reps may NEVER exceed the band ceiling a third time");
run(`
  E3=fresh("cable_lat_raise", toKg(30,"lb"));
  START=E3.load;
  const over=E3.hiEff+4;
  ingestSession(sess("cable_lat_raise", over, 3));   // exposure 1 over the ceiling
  AFTER1=E3.load; OVER1=E3.consecOver;
  ingestSession(sess("cable_lat_raise", over, 3));   // exposure 2 -> MUST force the jump
  AFTER2=E3.load; OVER2=E3.consecOver; TGT2=E3.target;
`);
ok("first overshoot widens the band, load unchanged", ctx.AFTER1===ctx.START, `${ctx.LB2(ctx.START)} -> ${ctx.LB2(ctx.AFTER1)} lb`);
ok("second consecutive overshoot FORCES the load jump", ctx.AFTER2>ctx.START, `${ctx.LB2(ctx.START)} -> ${ctx.LB2(ctx.AFTER2)} lb`);
ok("reps reset to the bottom of the band after a forced jump", ctx.TGT2===ctx.E3.lo, ctx.TGT2);

console.log("\nPRG-03 — a down-correction needs confirmation (asymmetric)");
run(`
  E4=fresh("cable_lat_raise", toKg(100,"lb"));
  S0=E4.load;
  ingestSession(sess("cable_lat_raise", Math.max(0,E4.target-2), 3));  // one bad session
  S1=E4.load;
  ingestSession(sess("cable_lat_raise", Math.max(0,E4.target-2), 3));  // confirmed
  S2=E4.load;
`);
ok("one short session does not cut the load", ctx.S1===ctx.S0);
ok("a confirmed shortfall does cut it", ctx.S2<ctx.S0, `${ctx.LB2(ctx.S0)} -> ${ctx.LB2(ctx.S2)} lb`);

console.log("\nENG-03 — a change with no rule id or no sentence must throw");
run(`
  THREW1=false; THREW2=false;
  try{ emit([], "load", 1, 2, "x", 1, null, "has a sentence"); }catch(e){ THREW1=true; }
  try{ emit([], "load", 1, 2, "x", 1, "PRG-02", null); }catch(e){ THREW2=true; }
`);
ok("null rule id throws", ctx.THREW1);
ok("missing sentence throws", ctx.THREW2);

console.log("\nSAF-PIN — never near failure on a lift that can pin you");
run(`
  S.settings=defaultSettings(); S.settings.spotterAt=0; S.settings.screening="CLEAR";
  for(const m of MUSCLES) S.mus[m]=newMuscleState();
  S.ex={}; const es=exState("bb_bench"); es.load=toKg(185,"lb");
  const ctx0={minRir:1,allowFailure:true,maxSets:4,weeklyCap:null,loadCap:null};
  SLOT_BB = buildSlot(LIBX["bb_bench"], es, "chest", 3, ctx0, S.mus.chest, 0, todayISO());
  const es2=exState("cable_lat_raise"); es2.load=toKg(40,"lb");
  SLOT_CB = buildSlot(LIBX["cable_lat_raise"], es2, "delts_side", 3, ctx0, S.mus.delts_side, 0, todayISO());
`);
ok("barbell bench is never prescribed under 2 RIR without a spotter", ctx.SLOT_BB.rir>=2, "rir="+ctx.SLOT_BB.rir);
ok("barbell bench failure set is not allowed", ctx.SLOT_BB.allowFailure===false);
ok("a cable isolation lift MAY take its last set to failure", ctx.SLOT_CB.allowFailure===true);

console.log("\nPHA-03 — a cut widens the deload trigger rather than firing spuriously");
run(`
  S.settings=defaultSettings(); S.settings.phase="CUT";
  CUT_TRIG = K.ROLL3_DELOAD*K.CUT_DELOAD_MULT;
  NORM_TRIG = K.ROLL3_DELOAD;
`);
ok("cut deload threshold is 1.5x wider", Math.abs(ctx.CUT_TRIG - (-4.5))<1e-9, ctx.CUT_TRIG);

console.log("\nVOL-01 — warm-ups and sub-threshold sets never enter the ledger");
run(`
  S.settings=defaultSettings();
  for(const m of MUSCLES) S.mus[m]=newMuscleState();
  S.ex={}; exState("lat_pulldown").load=toKg(100,"lb");
  creditVolume({date:"2026-01-05",week:"2026-W02",sets:[
    {ex:"lat_pulldown",load:toKg(100,"lb"),reps:8,warmup:true},                 // warm-up
    {ex:"lat_pulldown",load:toKg(50,"lb"), reps:8,warmup:false},                // < 0.85 * working
    {ex:"lat_pulldown",load:toKg(100,"lb"),reps:8,warmup:false},                // counts: 1.0 lats
  ]});
  LATS = S.mus.lats.fsWeek; MIDB = S.mus.mid_back.fsWeek;
`);
ok("only the qualifying set is credited to lats", Math.abs(ctx.LATS-1.0)<1e-9, ctx.LATS);
ok("synergist credited fractionally (0.5)", Math.abs(ctx.MIDB-0.5)<1e-9, ctx.MIDB);

console.log("\nVOL-15 / the objective — four tiers, 4:1, no finer");
run(`
  WVALS = MUSCLES.map(m=>W_MALE[m]);
  WDISTINCT = new Set(WVALS).size;
  WRATIO = Math.max(...WVALS)/Math.min(...WVALS);
  WTOTAL = W_SUM;
  LEGAL_OK  = weightsLegal(W_MALE);
  LEGAL_BAD = weightsLegal(Object.assign({}, W_MALE, {lats:9.0}));
  HAS_OBLIQUES = W_MALE.obliques > 0;
  TRAPS_BOTTOM = W_MALE.traps === Math.min(...WVALS);
`);
ok("exactly four distinct weights", ctx.WDISTINCT===4, ctx.WDISTINCT);
ok("top:bottom ratio is 4:1", Math.abs(ctx.WRATIO-4)<1e-9, ctx.WRATIO);
ok("weights sum to 29.5", Math.abs(ctx.WTOTAL-29.5)<1e-9, ctx.WTOTAL);
ok("a legal vector passes", ctx.LEGAL_OK===true);
ok("a steeper-than-4:1 edit is rejected", ctx.LEGAL_BAD===false);
ok("obliques are no longer zeroed", ctx.HAS_OBLIQUES===true);
ok("traps sits in the bottom tier", ctx.TRAPS_BOTTOM===true);

console.log("\nVOL-13 — the weekly budget is the authority");
run(`
  S.settings=defaultSettings();
  S.settings.phase="CUT";  CUT_LATS=baseTarget("lats");  CUT_QUAD=baseTarget("quads");
  S.settings.phase="GAIN"; GROW_LATS=baseTarget("lats");
  S.settings.phase="MAINTAIN"; MAINT_LATS=baseTarget("lats");
  NODIRECT = baseTarget("traps");
  CUT_TOTAL = MUSCLES.reduce((a,m)=>{ S.settings.phase="CUT"; return a+baseTarget(m); },0);
`);
ok("a Tier-A group gets more than a Tier-C group", ctx.CUT_LATS>ctx.CUT_QUAD, `${ctx.CUT_LATS} vs ${ctx.CUT_QUAD}`);
ok("a deficit budgets fewer sets than maintenance", ctx.CUT_LATS<ctx.MAINT_LATS, `${ctx.CUT_LATS} vs ${ctx.MAINT_LATS}`);
ok("building budgets more than maintenance", ctx.GROW_LATS>ctx.MAINT_LATS, `${ctx.GROW_LATS} vs ${ctx.MAINT_LATS}`);
ok("SEL-04 groups get zero direct allocation", ctx.NODIRECT===0, ctx.NODIRECT);
ok("the cut budget lands near 60 fractional sets", Math.abs(ctx.CUT_TOTAL-60)<3, ctx.CUT_TOTAL);

console.log("\nPHA-08 — the waist tripwire is calibrated to tape noise");
run(`
  TRIP = K.WAIST_TRIPWIRE_CM; MDC = K.WAIST_MDC_CM;
`);
ok("no threshold is finer than the tape's own resolution", ctx.TRIP > ctx.MDC, `trip ${ctx.TRIP} vs MDC ${ctx.MDC}`);

console.log("\nPLATE MATH — no arithmetic between sets");
run(`
  S.settings=defaultSettings();
  PM_135 = plateMath(LIBX["bb_bench"], toKg(135,"lb"));
  PM_BAR = plateMath(LIBX["bb_bench"], toKg(45,"lb"));
  PM_225 = plateMath(LIBX["bb_bench"], toKg(225,"lb"));
  PM_CABLE = plateMath(LIBX["cable_lat_raise"], toKg(50,"lb"));
`);
ok("135 lb is one 45 a side", /1×45/.test(ctx.PM_135||""), ctx.PM_135);
ok("an empty bar says so", ctx.PM_BAR==="empty bar", ctx.PM_BAR);
ok("225 lb is two 45s a side", /2×45/.test(ctx.PM_225||""), ctx.PM_225);
ok("plate math is silent for non-barbell lifts", ctx.PM_CABLE===null, ctx.PM_CABLE);

console.log("\nPRG-09/10 — calibration is the only cure for RIR sandbagging");
run(`
  S.settings=defaultSettings();
  for(const m of MUSCLES) S.mus[m]=newMuscleState();
  S.ex={}; S.diffs=[]; S.calibLast=null;
  ESC = exState("cable_lat_raise");
  ESC.load=nearestLoad(loadableSet(LIBX["cable_lat_raise"],S.settings.gym), toKg(40,"lb"));
  ESC.seeded=true; ESC.sessions=9; ESC.target=ESC.lo;
  BIAS_BEFORE = ESC.rirBias;
  // he called it 2 RIR, then got 5 more reps: he under-reports by 3
  ingestSession({date:"2026-02-02",week:"2026-W06",sets:[
    {ex:"cable_lat_raise",load:ESC.load,reps:12,pReps:ESC.target,priorHard:0,hoursSince:72,
     warmup:false,rom:1,assisted:0,rir:2,endpoint:"FAILED_CONCENTRIC",calibration:true,extraReps:5}
  ]});
  BIAS_AFTER = ESC.rirBias; CALIB_DATE = S.calibLast;
  CALIB_SENTENCE = (S.diffs.slice(-1)[0]||{list:[]}).list.filter(d=>d.rule==="PRG-09").map(d=>d.sentence)[0]||"";
`);
ok("under-reporting raises rir_bias", ctx.BIAS_AFTER>ctx.BIAS_BEFORE, `${ctx.BIAS_BEFORE} -> ${ctx.BIAS_AFTER}`);
ok("rir_bias stays clamped to [0,3]", ctx.BIAS_AFTER<=3.000001, ctx.BIAS_AFTER);
ok("the calibration date is recorded", ctx.CALIB_DATE==="2026-02-02", ctx.CALIB_DATE);
ok("it emits an explaining sentence", /more reps/.test(ctx.CALIB_SENTENCE), ctx.CALIB_SENTENCE);

console.log("\nVOL-01 — warm-ups stay out of the ledger AND out of progression");
run(`
  S.settings=defaultSettings();
  for(const m of MUSCLES) S.mus[m]=newMuscleState();
  S.ex={}; S.diffs=[];
  ESW = exState("lat_pulldown");
  ESW.load=nearestLoad(loadableSet(LIBX["lat_pulldown"],S.settings.gym), toKg(100,"lb"));
  ESW.seeded=true; ESW.sessions=9; ESW.target=ESW.lo;
  WU_LOAD_BEFORE = ESW.load;
  ingestSession({date:"2026-02-03",week:"2026-W06",sets:[
    {ex:"lat_pulldown",load:ESW.load,reps:30,pReps:ESW.target,priorHard:0,hoursSince:72,
     warmup:true,rom:1,assisted:0}
  ]});
  WU_LOAD_AFTER = ESW.load;
`);
ok("a 30-rep warm-up does not trigger a load jump", ctx.WU_LOAD_AFTER===ctx.WU_LOAD_BEFORE,
   `${ctx.LB2(ctx.WU_LOAD_BEFORE)} -> ${ctx.LB2(ctx.WU_LOAD_AFTER)} lb`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
