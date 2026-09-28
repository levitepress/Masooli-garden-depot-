const $=x=>document.getElementById(x);
const {createClient}=supabase;
const freshFetch=(url,options={})=>fetch(url,{...options,cache:"no-store"});
const db=createClient(MGD.url,MGD.key,{global:{fetch:freshFetch}});
let deferredInstallPrompt=null;
let cloudCheckBusy=false;
async function updateNetworkStatus(){
  const e=$("netStatus");
  if(!e)return;
  if(!navigator.onLine){e.textContent="OFFLINE";e.className="status offline";return;}
  if(cloudCheckBusy)return;
  cloudCheckBusy=true;
  e.textContent="CONNECTING…";e.className="status offline";
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),6000);
    const r=await fetch(MGD.url+"/auth/v1/settings",{headers:{apikey:MGD.key},cache:"no-store",signal:controller.signal});
    clearTimeout(timer);
    if(r.ok){e.textContent="ONLINE";e.className="status online";}
    else{e.textContent="CLOUD ERROR";e.className="status offline";}
  }catch(err){
    console.error("Supabase connectivity check failed",err);
    e.textContent="OFFLINE";e.className="status offline";
  }finally{cloudCheckBusy=false;}
}
window.addEventListener("online",updateNetworkStatus);
window.addEventListener("offline",updateNetworkStatus);
updateNetworkStatus();
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;const b=$("installBtn");if(b)b.classList.remove("hidden")});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;const b=$("installBtn");if(b)b.classList.add("hidden");toast("Masooli Garden Depot installed on this phone")});
document.addEventListener("click",e=>{if(e.target&&e.target.id==="installBtn"&&deferredInstallPrompt){deferredInstallPrompt.prompt();deferredInstallPrompt.userChoice.finally(()=>{deferredInstallPrompt=null;$("installBtn").classList.add("hidden")})}});
let profile=null,worker=null,section="dash",wsection="home",channel=null,refreshTimer=null,refreshBusy=false,refreshQueued=false,formDirty=false,interactionBusy=false;
const money=n=>new Intl.NumberFormat("en-UG",{style:"currency",currency:"UGX",maximumFractionDigits:0}).format(Number(n||0)),esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])),date=x=>x?new Date(x).toLocaleString("en-UG",{dateStyle:"medium",timeStyle:"short"}):"—";
function toast(x,bad=false){let t=$("toast");t.textContent=x;t.className="show";t.style.background=bad?"#a61b1b":"#102a43";setTimeout(()=>t.className="",3000)}
async function read(q,label="Database") {
  try {
    const r=await q;
    if(r.error){ console.error(label,r.error); toast(label+": "+r.error.message,true); return {data:[],error:r.error}; }
    return {data:r.data||[],error:null};
  } catch(e){ console.error(label,e); toast(label+": "+(e.message||e),true); return {data:[],error:e}; }
}
function dbErrorRows(cols,msg){return `<tr><td colspan="${cols}" class="bad">${esc(msg||"Could not load data.")}</td></tr>`}
function only(id){["auth","waiting","admin","worker"].forEach(x=>$(x).classList.add("hidden"));$(id).classList.remove("hidden")}
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));$("login").classList.toggle("hidden",b.dataset.tab!=="login");$("signup").classList.toggle("hidden",b.dataset.tab!=="signup")});
function syncLoginFields(){const workerMode=$("loginType")?.value==="worker";$("adminLoginWrap")?.classList.toggle("hidden",workerMode);$("workerLoginWrap")?.classList.toggle("hidden",!workerMode);$("le").required=!workerMode;$("li").required=workerMode;$("loginHelp").textContent=workerMode?"Enter the Worker ID and PIN given by the owner.":"Admin signs in with the current admin email and password."}
$("loginType")?.addEventListener("change",syncLoginFields);syncLoginFields();
document.querySelectorAll("[data-password-target]").forEach(b=>b.onclick=()=>{const i=$(b.dataset.passwordTarget);if(!i)return;const show=i.type==="password";i.type=show?"text":"password";b.textContent=show?"Hide":"Show"});

const OFF_DB="mgd-offline-v1";
function idb(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(OFF_DB,1);
    r.onupgradeneeded=()=>r.result.createObjectStore("sales",{keyPath:"client_ref"});
    r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
  });
}
async function queueSale(item){
  const d=await idb(),tx=d.transaction("sales","readwrite");
  tx.objectStore("sales").put(item);
  return new Promise(res=>tx.oncomplete=res);
}
async function queuedSales(){
  const d=await idb(),tx=d.transaction("sales","readonly");
  return new Promise((res,rej)=>{let r=tx.objectStore("sales").getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
}
async function syncOfflineSales(){
  if(!navigator.onLine || !profile || profile.role!=="worker" || !worker)return;
  const items=await queuedSales();
  for(const x of items){
    const r=await db.rpc("record_worker_sale",{p_product_id:x.product_id,p_quantity:x.quantity,p_receipt_no:x.receipt_no,p_sold_at:x.sold_at,p_notes:x.notes,p_client_ref:x.client_ref});
    if(!r.error){
      const d=await idb(),tx=d.transaction("sales","readwrite");tx.objectStore("sales").delete(x.client_ref);
    } else if(/Insufficient worker stock|Product not found|Worker account/.test(r.error.message)) {
      toast("A queued sale could not sync: "+r.error.message,true);
      break;
    }
  }
}
window.addEventListener("online",()=>{toast("Internet restored. Refreshing cloud data…");syncOfflineSales().then(()=>load())});
window.addEventListener("visibilitychange",()=>{if(!document.hidden&&navigator.onLine&&profile&&!formDirty&&!interactionBusy) refresh()});
window.addEventListener("offline",()=>toast("Offline mode: sales can be queued and synced later."));
async function load(){const {data:{user}}=await db.auth.getUser();if(!user){only("auth");$("title").textContent="Sign in";$("logout").classList.add("hidden");return}
$("logout").classList.remove("hidden");let q=await db.from("profiles").select("*").eq("id",user.id).maybeSingle();if(q.error)return toast(q.error.message,true);profile=q.data;
if(!profile){
  const meta=user.user_metadata||{};
  const reg=await db.rpc("register_worker_profile",{p_full_name:meta.full_name||null,p_phone:meta.phone||null});
  if(reg.error)return toast("Account profile setup failed: "+reg.error.message,true);
  q=await db.from("profiles").select("*").eq("id",user.id).maybeSingle();
  if(q.error)return toast(q.error.message,true);
  profile=q.data;
}
if(!profile?.business_id){
  const claim=await db.rpc("set_initial_owner",{p_business_id:MGD.businessId});
  if(!claim.error){toast("Owner account activated");return load()}
  only("waiting");$("title").textContent="Awaiting assignment";return
}
if(profile.role==="admin"){only("admin");$("title").textContent="Owner Dashboard";await admin();live()}else{let w=await db.from("workers").select("*").eq("profile_id",user.id).maybeSingle();worker=w.data;if(!worker){only("waiting");return}only("worker");$("title").textContent="My Dashboard";await workerApp();live()}}
$("login").onsubmit=async e=>{e.preventDefault();const workerMode=$("loginType").value==="worker";const password=$("lp").value.trim();const email=workerMode?$("li").value.trim().toLowerCase()+"@workers.masooligardendepot.local":$("le").value.trim();if(!email||!password)return toast("Enter your login details.",true);let r=await db.auth.signInWithPassword({email,password});if(r.error)toast(r.error.message,true);else{formDirty=false;interactionBusy=false;load()}};
$("signup").onsubmit=async e=>{e.preventDefault();let r=await db.auth.signUp({email:$("se").value,password:$("sw").value,options:{data:{full_name:$("sn").value,phone:$("sp").value}}});if(r.error)return toast(r.error.message,true);if(r.data.session){let c=await db.rpc("set_initial_owner",{p_business_id:MGD.businessId});if(!c.error){toast("Owner account created");return load()}}toast("Account created. Confirm your email if required, then sign in.")};
$("logout").onclick=async()=>{await db.auth.signOut();location.reload()};$("refresh").onclick=load;
function live(){
  if(channel) db.removeChannel(channel);
  if(refreshTimer) clearInterval(refreshTimer);
  channel=db.channel("mgd-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"products"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"product_costs"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"purchases"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"sales"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"sale_items"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"stock_movements"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"stock_adjustments"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"stock_returns"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"worker_payments"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"worker_messages"},refresh)
    .subscribe((status)=>console.log("MGD realtime:",status));
  // Realtime gives immediate updates; this periodic online refresh is a safety net for
  // tables/views that are not enabled for Realtime or changes made elsewhere.
  refreshTimer=setInterval(()=>{if(navigator.onLine&&!formDirty&&!interactionBusy) refresh()},60000);
}
async function refresh(){
  if(formDirty||interactionBusy){refreshQueued=true;return}
  if(!navigator.onLine||!profile||refreshBusy){if(refreshBusy)refreshQueued=true;return}
  refreshBusy=true;
  try{if(profile.role==="admin")await admin();else await workerApp()}
  finally{refreshBusy=false;if(refreshQueued){refreshQueued=false;setTimeout(refresh,250)}}
}
document.querySelectorAll("#anav button").forEach(b=>b.onclick=()=>{formDirty=false;section=b.dataset.s;document.querySelectorAll("#anav button").forEach(x=>x.classList.toggle("active",x===b));admin()});
document.addEventListener("input",e=>{if(e.target.closest("#acontent form")||e.target.closest("#wcontent form")){formDirty=true;interactionBusy=true}});
document.addEventListener("focusin",e=>{if(e.target.closest("form"))interactionBusy=true});
document.addEventListener("focusout",()=>setTimeout(()=>{if(!document.querySelector("form :focus"))interactionBusy=false},500));
document.addEventListener("scroll",()=>{interactionBusy=true;clearTimeout(window.__mgdScrollTimer);window.__mgdScrollTimer=setTimeout(()=>{interactionBusy=false},1500)},{passive:true});
document.querySelectorAll("#wnav button").forEach(b=>b.onclick=()=>{wsection=b.dataset.s;document.querySelectorAll("#wnav button").forEach(x=>x.classList.toggle("active",x===b));workerApp()});
async function admin(){
  const [pr,sr,wr,fr]=await Promise.all([
    read(db.from("admin_product_catalog").select("*").order("name"),"Products"),
    read(db.from("warehouse_stock_balances").select("*"),"Warehouse stock"),
    read(db.from("workers").select("*").order("name"),"Workers"),
    read(db.from("worker_financial_summary").select("*"),"Worker finances")
  ]);
  let p=pr.data||[],s=sr.data||[],w=wr.data||[],f=fr.data||[];
  let expected=f.reduce((a,x)=>a+Number(x.expected_amount||0),0),paid=f.reduce((a,x)=>a+Number(x.paid_amount||0),0);
  $("astats").innerHTML=[["Products",p.length],["Warehouse packets",s.reduce((a,x)=>a+Number(x.quantity_on_hand||0),0)],["Expected",money(expected)],["Outstanding",money(expected-paid)]].map(x=>`<div class="stat"><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join("");
  if(section==="dash"){$("acontent").innerHTML=`<div class="section"><h3>Worker balances</h3>${finTable(f)}</div><div class="section"><h3>Admin login settings</h3><p class="muted">Change the email used by the owner. Password can also be changed here.</p><form id="adminLoginForm" class="form"><div class="row"><label>New admin email<input id="newAdminEmail" type="email" required></label><label>New password (optional)<input id="newAdminPassword" type="password" minlength="8"></label></div><button class="info">Update admin login</button></form></div>`;$("adminLoginForm").onsubmit=async e=>{e.preventDefault();let r=await db.functions.invoke("worker-account-admin",{body:{op:"change_admin_login",email:$("newAdminEmail").value,password:$("newAdminPassword").value}});if(r.error)toast(r.error.message||"Could not update admin login",true);else{formDirty=false;toast("Admin login updated. Use the new email/password next time.")}}}
  if(section==="stock")stock(p,s,w);
  if(section==="dispatch")dispatch(p,w);
  if(section==="depot")depotSale(p);
  if(section==="balance")dailyBalance();
  if(section==="purchases")purchases(p);
  if(section==="settlements")settlements(w,f);
  if(section==="workers")workers(w);
  if(section==="products")products(p);
  if(section==="reports"){
    let[daily,monthly]=await Promise.all([read(db.from("admin_daily_report").select("*").limit(31),"Daily report"),read(db.from("admin_monthly_report").select("*").limit(24),"Monthly report")]);
    $("acontent").innerHTML=`<div class="section"><h3>Worker financial report</h3>${finTable(f)}</div><div class="section"><h3>Daily sales report</h3><div class="table"><table><thead><tr><th>Date</th><th>Sales</th><th>Packets</th><th>Sales amount</th><th>Commission</th></tr></thead><tbody>${(daily.data||[]).map(x=>`<tr><td>${x.report_date}</td><td>${x.sales_count}</td><td>${x.packets_sold}</td><td>${money(x.sales_amount)}</td><td>${money(x.commission_amount)}</td></tr>`).join("")||"<tr><td colspan=5>No sales yet.</td></tr>"}</tbody></table></div></div><div class="section"><h3>Monthly sales report</h3><div class="table"><table><thead><tr><th>Month</th><th>Sales</th><th>Packets</th><th>Sales amount</th><th>Commission</th></tr></thead><tbody>${(monthly.data||[]).map(x=>`<tr><td>${x.report_month}</td><td>${x.sales_count}</td><td>${x.packets_sold}</td><td>${money(x.sales_amount)}</td><td>${money(x.commission_amount)}</td></tr>`).join("")||"<tr><td colspan=5>No sales yet.</td></tr>"}</tbody></table></div></div>`;
  }
}
function finTable(f){return `<div class="table"><table><thead><tr><th>Worker</th><th>Expected</th><th>Paid</th><th>Outstanding</th><th>Commission</th></tr></thead><tbody>${f.map(x=>`<tr><td>${esc(x.worker_name)}</td><td>${money(x.expected_amount)}</td><td>${money(x.paid_amount)}</td><td class="${Number(x.outstanding_amount)>0?"bad":"good"}">${money(x.outstanding_amount)}</td><td>${money(x.commission_amount)}</td></tr>`).join("")||"<tr><td colspan=5>No activity yet.</td></tr>"}</tbody></table></div>`}
function stock(p,s,w){
 const active=p.filter(x=>x.active);
 $("acontent").innerHTML=`<div class="section"><h3>Warehouse stock</h3><div class="table"><table><thead><tr><th>Product</th><th>Packets</th><th>Buying</th><th>Selling</th><th>Margin</th></tr></thead><tbody>${p.map(x=>{let y=s.find(z=>z.product_id===x.id);return `<tr><td>${esc(x.name)}</td><td>${y?.quantity_on_hand||0}</td><td>${money(x.buying_price)}</td><td>${money(x.selling_price)}</td><td>${money(Number(x.selling_price)-Number(x.buying_price))}</td></tr>`}).join("")}</tbody></table></div></div>
 <div class="section"><h3>Quick stock correction</h3><p class="muted">Use this for physical recounts, damage, breakage or other stock differences.</p><form id="adjustForm" class="form"><div class="row"><label>Product<select id="ap">${active.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Quantity change<input id="aq" type="number" step="1" required placeholder="+10 or -2"></label><label>Reason<input id="ar" required placeholder="e.g. damaged / recount"></label></div><button>Save correction</button></form></div>`;
 $("adjustForm").onsubmit=async e=>{e.preventDefault();let r=await db.rpc("record_stock_adjustment",{p_product_id:$("ap").value,p_quantity_delta:+$("aq").value,p_reason:$("ar").value});if(r.error)toast(r.error.message,true);else{toast("Stock correction saved");admin()}};
}
function dispatch(p,w){
 const active=p.filter(x=>x.active),today=new Date().toISOString().slice(0,10);
 $("acontent").innerHTML=`<div class="section"><h3>Give stock to van / boy</h3><p class="muted">Record everything leaving the depot in one dispatch. Different products can be assigned to the same boy. Use <b>Top-up</b> when adding more stock later.</p><form id="dispatchForm" class="form"><div class="row"><label>Boy<select id="dw">${w.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Van / vehicle<input id="dv" required placeholder="Van A"></label><label>Route / area<input id="dr" placeholder="Kampala / Wakiso"></label><label>Date<input id="dd" type="date" value="${today}" required></label><label>Type<select id="dt"><option value="initial">Initial issue</option><option value="top_up">Top-up</option><option value="other">Other</option></select></label></div><div id="dispatchItems"></div><button type="button" class="info" id="addDispatchItem">+ Add product</button><label>Notes<textarea id="dn" rows="2"></textarea></label><button>Save dispatch</button></form></div>`;
 const add=()=>{let row=document.createElement("div");row.className="row dispatch-row";row.innerHTML=`<label>Product<select class="di-product">${active.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Packets<input class="di-qty" type="number" min="1" required></label><button type="button" class="small danger di-remove">Remove</button>`;row.querySelector(".di-remove").onclick=()=>row.remove();$("dispatchItems").appendChild(row)};add();$("addDispatchItem").onclick=add;
 $("dispatchForm").onsubmit=async e=>{e.preventDefault();let items=[...document.querySelectorAll(".dispatch-row")].map(r=>({product_id:r.querySelector(".di-product").value,quantity:+r.querySelector(".di-qty").value})).filter(x=>x.quantity>0);if(!items.length)return toast("Add at least one product.",true);let r=await db.rpc("record_stock_dispatch",{p_worker_id:$("dw").value,p_vehicle_label:$("dv").value,p_items:items,p_dispatch_date:$("dd").value,p_dispatch_type:$("dt").value,p_route_label:$("dr").value,p_notes:$("dn").value});if(r.error)toast(r.error.message,true);else{toast("Dispatch saved. Warehouse and worker balances updated.");formDirty=false;admin()}};
}
function depotSale(p){
 const active=p.filter(x=>x.active);
 $("acontent").innerHTML=`<div class="section"><h3>Depot sale to walk-in / client</h3><p class="muted">For clients buying directly at the depot. Stock, sales total and customer debt update automatically.</p><form id="depotSaleForm" class="form"><div class="row"><label>Customer name<input id="dc"></label><label>Phone<input id="dcp"></label><label>Payment<select id="dpay"><option value="paid">Paid</option><option value="partial">Partial</option><option value="credit">Credit</option></select></label><label>Amount paid<input id="dpaid" type="number" min="0"></label><label>Receipt<input id="drec"></label></div><div id="depotItems"></div><button type="button" class="info" id="addDepotItem">+ Add product</button><label>Notes<textarea id="dnotes" rows="2"></textarea></label><button>Save depot sale</button></form></div>`;
 const add=()=>{let row=document.createElement("div");row.className="row depot-row";row.innerHTML=`<label>Product<select class="ds-product">${active.map(x=>`<option value="${x.id}">${esc(x.name)} — ${money(x.selling_price)}</option>`).join("")}</select></label><label>Packets<input class="ds-qty" type="number" min="1" required></label><button type="button" class="small danger ds-remove">Remove</button>`;row.querySelector(".ds-remove").onclick=()=>row.remove();$("depotItems").appendChild(row)};add();$("addDepotItem").onclick=add;
 $("depotSaleForm").onsubmit=async e=>{e.preventDefault();let items=[...document.querySelectorAll(".depot-row")].map(r=>({product_id:r.querySelector(".ds-product").value,quantity:+r.querySelector(".ds-qty").value})).filter(x=>x.quantity>0);if(!items.length)return toast("Add at least one product.",true);let r=await db.rpc("record_depot_sale",{p_items:items,p_customer_name:$("dc").value,p_customer_phone:$("dcp").value,p_payment:$("dpay").value,p_amount_paid:+$("dpaid").value||0,p_receipt_no:$("drec").value,p_notes:$("dnotes").value});if(r.error)toast(r.error.message,true);else{toast("Depot sale recorded and stock updated.");formDirty=false;admin()}};
}
async function dailyBalance(){
 const d=new Date().toISOString().slice(0,10);$("acontent").innerHTML=`<div class="section"><h3>Daily van / boy balance</h3><div class="row"><label>Date<input id="bd" type="date" value="${d}"></label><button id="bload">Load balance</button></div><div id="btable">Loading…</div></div>`;
 const load=async()=>{let r=await db.rpc("admin_dispatch_balance",{p_date:$("bd").value});if(r.error){$("btable").innerHTML=`<p class="bad">${esc(r.error.message)}</p>`;return}let rows=r.data||[];$("btable").innerHTML=`<div class="table"><table><thead><tr><th>Boy</th><th>Van</th><th>Product</th><th>Issued today</th><th>Sold today</th><th>Returned</th><th>Stock remaining</th><th>Expected</th><th>Commission</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.worker_name)}</td><td>${esc(x.vehicle_label||"—")}</td><td>${esc(x.product_name)}</td><td>${x.issued}</td><td>${x.sold}</td><td>${x.returned}</td><td><b>${x.remaining}</b></td><td>${money(x.expected_amount)}</td><td>${money(x.commission)}</td></tr>`).join("")||"<tr><td colspan=9>No worker stock activity for this date.</td></tr>"}</tbody></table></div>`};$("bload").onclick=load;load();
}

async function workers(w){
  let up=await db.rpc("list_unassigned_profiles");let profiles=up.data||[];
  const callWorker=body=>db.functions.invoke("worker-account-admin",{body});
  $("acontent").innerHTML=`<div class="section"><h3>Create worker account</h3><form id="wf" class="form"><div class="row"><label>Name<input id="wn" required></label><label>Phone<input id="wp"></label><label>Commission %<input id="wr" type="number" value="5" min="0" max="100" step=".1"></label><label>Worker PIN<input id="wpin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="6 digits"></label></div><button id="workerSave">Create worker + login</button></form><p class="muted">Workers use Worker ID + 6-digit PIN. No email is required.</p></div><div class="section"><h3>Workers</h3><div class="table"><table><thead><tr><th>Name</th><th>Phone</th><th>Commission</th><th>Worker ID</th><th>Status</th><th>Action</th></tr></thead><tbody>${w.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.phone||"")}</td><td>${x.commission_rate}%</td><td><b>${esc(x.login_code||"Not set")}</b></td><td>${x.active?"Active":"Deactivated"}</td><td>${x.active?`<button type="button" class="small archive" data-deactivate-worker="${x.id}">Deactivate</button>`:""} ${x.profile_id?`<button type="button" class="small info" data-reset-worker="${x.id}">Reset PIN</button>`:""}</td></tr>`).join("")||"<tr><td colspan=6>No workers yet.</td></tr>"}</tbody></table></div></div><div class="section"><h3>Older unassigned accounts</h3><p class="muted">Accounts created before Worker ID login was enabled can still be assigned.</p>${profiles.map(p=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #d9e2ec"><div><b>${esc(p.full_name||"Unnamed")}</b><div class="muted">${esc(p.phone||"")}</div></div><select id="aw-${p.id}">${w.filter(x=>x.active&&!x.profile_id).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select><button type="button" class="small" onclick="assign('${p.id}')">Assign</button></div>`).join("")||'<p class="muted">No older unassigned accounts.</p>'}</div><div class="section"><h3>Worker communication</h3><div id="workerMessages">Loading…</div></div>`;
  $("wf").onsubmit=async e=>{e.preventDefault();const b=$("workerSave");b.disabled=true;let r=await callWorker({op:"create",name:$("wn").value,phone:$("wp").value,commission_rate:+$("wr").value,pin:$("wpin").value});b.disabled=false;if(r.error){toast(r.error.message||"Could not create worker",true);return}formDirty=false;interactionBusy=false;const d=r.data||{};const id=d.login_code||d.worker?.login_code||"";toast("Worker created: "+id);alert(`WORKER LOGIN\n\nWorker ID: ${id}\nPIN: ${$("wpin").value}\n\nGive these details to the worker.`);await admin()};
  document.querySelectorAll("[data-deactivate-worker]").forEach(b=>b.onclick=async()=>{if(!confirm("Deactivate this worker? Their history will remain."))return;let r=await callWorker({op:"deactivate",worker_id:b.dataset.deactivateWorker});if(r.error)toast(r.error.message||"Could not deactivate",true);else{toast("Worker deactivated");formDirty=false;await admin()}});
  document.querySelectorAll("[data-reset-worker]").forEach(b=>b.onclick=async()=>{const pin=prompt("Enter a new 6-digit PIN:");if(!/^\d{6}$/.test(pin||""))return toast("PIN must be exactly 6 digits.",true);let r=await callWorker({op:"reset_pin",worker_id:b.dataset.resetWorker,pin});if(r.error)toast(r.error.message||"Could not reset PIN",true);else toast("PIN reset successfully")});
  loadWorkerMessages();
}
window.assign=async pid=>{let workerId=$("aw-"+pid)?.value;if(!workerId)return toast("Add an unassigned worker record first.",true);let r=await db.rpc("assign_worker_account",{p_worker_id:workerId,p_profile_id:pid});if(r.error)toast(r.error.message,true);else{toast("Account assigned");formDirty=false;admin()}};
function products(p){
  const active=p.filter(x=>x.active),archived=p.filter(x=>!x.active);
  const rows=list=>list.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.pack_label||"Custom")}</td><td>${x.pack_size} bottles</td><td>${money(x.buying_price)}</td><td>${money(x.selling_price)}</td><td>${x.active?`<button type="button" class="small archive" data-archive-product="${x.id}">Temporary delete</button>`:`<button type="button" class="small restore" data-restore-product="${x.id}">Restore</button> <button type="button" class="small danger" data-delete-product="${x.id}">Permanent delete</button>`} <button type="button" class="small" data-edit-product="${x.id}">Edit</button></td></tr>`).join("");
  $("acontent").innerHTML=`<div class="section"><h3 id="productFormTitle">Add product</h3><form id="pf" class="form"><input id="pid" type="hidden"><div class="row"><label>Name<input id="pn" required></label><label>SKU<input id="ps"></label><label>Bottle size<select id="pkt"><option value="Small">Small</option><option value="Medium">Medium</option><option value="Big">Big</option><option value="Custom">Custom</option></select></label><label>Bottles per packet<input id="pk" type="number" value="6" min="1" required></label><label>Buying / packet<input id="pb" type="number" min="0" required></label><label>Selling / packet<input id="pv" type="number" min="0" required></label></div><p class="muted">Bottle size is only a label. Bottles per packet is always controlled separately, so Big can be 6, Small can be 12 or 24, and Custom can be any number.</p><button id="productSave">Add product</button><button id="productCancel" type="button" class="hidden">Cancel edit</button></form></div><div class="section"><h3>Active products</h3><div class="table"><table><thead><tr><th>Product</th><th>Size</th><th>Pack</th><th>Buying</th><th>Selling</th><th>Actions</th></tr></thead><tbody>${rows(active)||"<tr><td colspan=6>No active products.</td></tr>"}</tbody></table></div></div><div class="section"><h3>Temporarily deleted / archived</h3><div class="table"><table><thead><tr><th>Product</th><th>Size</th><th>Pack</th><th>Buying</th><th>Selling</th><th>Actions</th></tr></thead><tbody>${rows(archived)||"<tr><td colspan=6>No archived products.</td></tr>"}</tbody></table></div></div>`;
  const reset=()=>{formDirty=false;interactionBusy=false;$("pid").value="";$("pf").reset();$("pkt").value="Small";$("pk").value=6;$("productFormTitle").textContent="Add product";$("productSave").textContent="Add product";$("productCancel").classList.add("hidden")};
  $("productCancel").onclick=reset;
  $("pf").onsubmit=async e=>{e.preventDefault();let b=$("productSave");b.disabled=true;let r=await db.rpc("upsert_product",{p_product_id:$("pid").value||null,p_name:$("pn").value.trim(),p_sku:$("ps").value.trim(),p_pack_size:+$("pk").value,p_pack_label:$("pkt").value,p_buying_price:+$("pb").value,p_selling_price:+$("pv").value,p_active:true});b.disabled=false;if(r.error){toast(r.error.message,true);return}formDirty=false;interactionBusy=false;toast($("pid").value?"Product updated":"Product added");await admin()};
  document.querySelectorAll("[data-edit-product]").forEach(btn=>btn.onclick=()=>{let x=p.find(y=>y.id===btn.dataset.editProduct);if(!x)return;$("pid").value=x.id;$("pn").value=x.name||"";$("ps").value=x.sku||"";$("pb").value=x.buying_price??0;$("pv").value=x.selling_price??0;$("pkt").value=x.pack_label||"Custom";$("pk").value=x.pack_size||6;$("productFormTitle").textContent="Edit product";$("productSave").textContent="Update product";$("productCancel").classList.remove("hidden");formDirty=true;interactionBusy=true;window.scrollTo({top:0,behavior:"smooth"})});
  document.querySelectorAll("[data-archive-product]").forEach(btn=>btn.onclick=async()=>{if(!confirm("Temporarily delete this product? It will be archived and can be restored."))return;let r=await db.rpc("archive_product",{p_product_id:btn.dataset.archiveProduct});if(r.error)toast(r.error.message,true);else{formDirty=false;toast("Product archived");await admin()}});
  document.querySelectorAll("[data-restore-product]").forEach(btn=>btn.onclick=async()=>{let x=p.find(y=>y.id===btn.dataset.restoreProduct);if(!x)return;let r=await db.rpc("upsert_product",{p_product_id:x.id,p_name:x.name,p_sku:x.sku,p_pack_size:x.pack_size,p_pack_label:x.pack_label,p_buying_price:x.buying_price,p_selling_price:x.selling_price,p_active:true});if(r.error)toast(r.error.message,true);else{toast("Product restored");await admin()}});
  document.querySelectorAll("[data-delete-product]").forEach(btn=>btn.onclick=()=>deleteProduct(btn.dataset.deleteProduct));
}
window.deleteProduct=async id=>{const x=await db.from("products").select("name").eq("id",id).maybeSingle();const name=x.data?.name||"this product";if(!confirm(`PERMANENT DELETE\n\nDelete "${name}" permanently?\n\nThis cannot be undone.`))return;const r=await db.rpc("delete_product_permanently",{p_product_id:id});if(r.error){toast("Delete failed: "+r.error.message,true);return}formDirty=false;toast("Product permanently deleted");await admin()};
async function purchases(p){
 $("acontent").innerHTML=`<div class="section"><h3>Record purchase / stock received</h3><form id="purchaseForm" class="form"><div class="row"><label>Product<select id="pp">${p.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Packets<input id="pq" type="number" min="1" required></label><label>Buying price / packet<input id="pc" type="number" min="0" required></label><label>Supplier<input id="psup"></label><label>Reference<input id="pref"></label></div><button>Save purchase</button></form></div><div class="section"><h3>Stock receipt history</h3><div id="purchaseHistory">Loading…</div></div>`;
 $("purchaseForm").onsubmit=async e=>{e.preventDefault();let r=await db.rpc("record_purchase",{p_product_id:$("pp").value,p_quantity:+$("pq").value,p_unit_cost:+$("pc").value,p_supplier:$("psup").value,p_reference:$("pref").value});if(r.error)toast(r.error.message,true);else{toast("Purchase recorded");await admin()}};
 let q=await db.from("admin_purchases_summary").select("*").order("purchased_at",{ascending:false}).limit(50);
 $("purchaseHistory").innerHTML=`<div class="table"><table><thead><tr><th>Date</th><th>Product</th><th>Packets</th><th>Unit cost</th><th>Supplier</th></tr></thead><tbody>${(q.data||[]).map(x=>`<tr><td>${date(x.purchased_at)}</td><td>${esc(x.product_name)}</td><td>${x.quantity}</td><td>${money(x.unit_cost)}</td><td>${esc(x.supplier||"—")}</td></tr>`).join("")||"<tr><td colspan=5>No purchases recorded.</td></tr>"}</tbody></table></div>`;
}
async function settlements(w,f){
 $("acontent").innerHTML=`<div class="section"><h3>Worker settlements</h3><p class="muted">Record money returned by a worker. This changes the worker's outstanding balance but never exposes purchasing prices to the worker.</p><form id="payForm" class="form"><div class="row"><label>Worker<select id="payWorker">${w.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Amount<input id="payAmount" type="number" min="1" required></label><label>Method<select id="payMethod"><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank">Bank</option><option value="other">Other</option></select></label><label>Reference<input id="payRef"></label></div><button>Record payment</button></form></div><div class="section"><h3>Current balances</h3>${finTable(f)}</div>`;
 $("payForm").onsubmit=async e=>{e.preventDefault();let r=await db.rpc("record_worker_payment",{p_worker_id:$("payWorker").value,p_amount:+$("payAmount").value,p_method:$("payMethod").value,p_reference:$("payRef").value});if(r.error)toast(r.error.message,true);else{toast("Payment recorded");admin()}};
}

async function loadWorkerMessages(){const el=$("workerMessages");if(!el)return;let r=await db.rpc("list_worker_messages",{});if(r.error){el.innerHTML=`<p class="bad">${esc(r.error.message)}</p>`;return}const rows=r.data||[];el.innerHTML=`<form id="adminMessageForm" class="form"><div class="row"><label>Worker<select id="msgWorker">${(await db.from("workers").select("id,name").eq("business_id",MGD.businessId).order("name")).data?.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")||""}</select></label><label>Message<textarea id="msgText" rows="2" required></textarea></label></div><button class="info">Send to worker</button></form><div class="table"><table><thead><tr><th>Date</th><th>Worker</th><th>From</th><th>Message</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${date(x.created_at)}</td><td>${esc(x.worker_name)}</td><td>${esc(x.sender_role)}</td><td>${esc(x.message)}</td></tr>`).join("")||"<tr><td colspan=4>No messages yet.</td></tr>"}</tbody></table></div>`;$("adminMessageForm").onsubmit=async e=>{e.preventDefault();let q=await db.rpc("send_admin_message",{p_worker_id:$("msgWorker").value,p_message:$("msgText").value});if(q.error)toast(q.error.message,true);else{toast("Message sent");formDirty=false;await loadWorkerMessages()}}}
const SNAP="mgd-worker-snapshot-v1";
async function saveWorkerSnapshot(data){try{localStorage.setItem(SNAP,JSON.stringify({saved_at:new Date().toISOString(),...data}))}catch(e){}}
function getWorkerSnapshot(){try{return JSON.parse(localStorage.getItem(SNAP)||"null")}catch(e){return null}}
async function workerApp(){let [s,h,c,f]=await Promise.all([
  db.from("worker_offline_stock").select("*"),
  db.from("worker_offline_history").select("*").limit(200),
  db.from("worker_offline_catalog").select("*"),
  db.from("worker_financial_summary").select("*").eq("worker_id",worker.id).maybeSingle()
]);if(!navigator.onLine && (!s.data || !h.data || !c.data)){
  const snap=getWorkerSnapshot();
  if(snap){s={data:snap.stock};h={data:snap.history};c={data:snap.catalog};f={data:snap.financial}}
}
s=s.data||[];h=h.data||[];c=c.data||[];f=f.data||{};
if(navigator.onLine) saveWorkerSnapshot({stock:s,history:h,catalog:c,financial:f});let rem=s.reduce((a,x)=>a+Number(x.quantity_remaining||0),0);$("wstats").innerHTML=[["My stock",rem],["Expected",money(f.expected_amount)],["Outstanding",money(f.outstanding_amount)],["Commission",money(f.commission_amount)]].map(x=>`<div class="stat"><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join("");
if(wsection==="home"){$("wcontent").innerHTML=`<div class="section"><h3>My dashboard</h3><p class="muted">Only your own stock, sales, payments, outstanding balance and commission are shown here.</p>${saleTable(h.slice(0,8))}</div><div class="section"><h3>Communication with admin</h3><form id="workerMessageForm" class="form"><label>Message<textarea id="workerMessageText" rows="3" required placeholder="Send a report, request or explanation to the admin"></textarea></label><button class="info">Send message</button></form><div id="workerMessagesBox">Loading…</div></div>`;loadWorkerMessagesForWorker();}
if(wsection==="stock")$("wcontent").innerHTML=`<div class="section"><h3>My stock</h3><div class="table"><table><thead><tr><th>Product</th><th>Packets remaining</th><th>Pack</th></tr></thead><tbody>${s.map(x=>`<tr><td>${esc(x.product_name)}</td><td>${x.quantity_remaining}</td><td>${esc(x.pack_label||((x.pack_size||0)+" bottles"))}</td></tr>`).join("")||"<tr><td colspan=3>No stock issued yet.</td></tr>"}</tbody></table></div></div>`;
if(wsection==="history")$("wcontent").innerHTML=`<div class="section"><h3>My sales history</h3>${saleTable(h)}</div>`;
if(wsection==="sell"){let pending=await queuedSales();$("wcontent").innerHTML=`<div class="section"><h3>Record sale</h3><p class="muted">If the phone loses internet, the sale is saved securely on the phone and automatically synced when connection returns.</p><form id="sf" class="form"><label>Product<select id="spx">${c.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)} — ${money(x.selling_price)}</option>`).join("")}</select></label><div class="row"><label>Packets sold<input id="sq" type="number" min="1" required></label><label>Receipt number<input id="sr"></label></div><button>Save sale</button></form><p class="muted">Pending offline sales: ${pending.length}</p></div>`;$("sf").onsubmit=async e=>{e.preventDefault();let item={client_ref:"OFF-"+crypto.randomUUID(),product_id:$("spx").value,quantity:+$("sq").value,receipt_no:$("sr").value,sold_at:new Date().toISOString()};if(!navigator.onLine){await queueSale(item);toast("Saved offline; it will sync automatically.");return workerApp()}let r=await db.rpc("record_worker_sale",{p_product_id:item.product_id,p_quantity:item.quantity,p_receipt_no:item.receipt_no,p_sold_at:item.sold_at,p_client_ref:item.client_ref});if(r.error){if(/Failed to fetch|NetworkError|Load failed/i.test(r.error.message)){await queueSale(item);toast("Saved offline; it will sync automatically.");}else toast(r.error.message,true)}else toast("Sale recorded");workerApp()};syncOfflineSales()}}
async function loadWorkerMessagesForWorker(){const el=$("workerMessagesBox");if(!el)return;let r=await db.rpc("list_worker_messages",{});if(r.error){el.innerHTML=`<p class="bad">${esc(r.error.message)}</p>`;return}el.innerHTML=(r.data||[]).map(x=>`<div class="section"><small>${date(x.created_at)} • ${esc(x.sender_role)}</small><p>${esc(x.message)}</p></div>`).join("")||'<p class="muted">No messages yet.</p>';$("workerMessageForm").onsubmit=async e=>{e.preventDefault();let q=await db.rpc("send_worker_message",{p_message:$("workerMessageText").value});if(q.error)toast(q.error.message,true);else{toast("Message sent to admin");formDirty=false;await loadWorkerMessagesForWorker()}}}
function saleTable(h){return `<div class="table"><table><thead><tr><th>Date</th><th>Receipt</th><th>Expected</th><th>Commission</th></tr></thead><tbody>${h.map(x=>`<tr><td>${date(x.sold_at)}</td><td>${esc(x.receipt_no||"—")}</td><td>${money(x.expected_amount)}</td><td>${money(x.commission_amount)}</td></tr>`).join("")||"<tr><td colspan=4>No sales yet.</td></tr>"}</tbody></table></div>`}
db.auth.onAuthStateChange(()=>setTimeout(load,0));if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});window.addEventListener("load",()=>setTimeout(syncOfflineSales,1000));load();