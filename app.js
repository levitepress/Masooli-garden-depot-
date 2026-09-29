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
  const [pr,sr,wr,fr,qr]=await Promise.all([
    read(db.from("admin_product_catalog").select("*").order("name"),"Products"),
    read(db.from("warehouse_stock_balances").select("*"),"Warehouse stock"),
    read(db.from("workers").select("*").order("name"),"Workers"),
    read(db.from("worker_financial_summary").select("*"),"Worker finances"),
    read(db.rpc("admin_dispatch_quick_report",{p_date:new Date().toISOString().slice(0,10)}),"Today dispatches")
  ]);
  let p=pr.data||[],s=sr.data||[],w=wr.data||[],f=fr.data||[],quick=qr.data||[];
  let expected=f.reduce((a,x)=>a+Number(x.expected_amount||0),0),paid=f.reduce((a,x)=>a+Number(x.paid_amount||0),0);
  $("astats").innerHTML=[["Products",p.length],["Warehouse packets",s.reduce((a,x)=>a+Number(x.quantity_on_hand||0),0)],["Expected",money(expected)],["Outstanding",money(expected-paid)]].map(x=>`<div class="stat"><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join("");
  if(section==="dash"){$("acontent").innerHTML=`<div class="section"><h3>Today at a glance</h3>${dispatchQuickTable(quick)}</div><div class="section"><h3>Financial expectations</h3>${finTable(f,quick)}</div><div class="section"><h3>Admin login settings</h3><p class="muted">Change the email used by the owner. Password can also be changed here.</p><form id="adminLoginForm" class="form"><div class="row"><label>New admin email<input id="newAdminEmail" type="email" required></label><label>New password (optional)<input id="newAdminPassword" type="password" minlength="8"></label></div><button class="info">Update admin login</button></form></div>`;$("adminLoginForm").onsubmit=async e=>{e.preventDefault();let r=await db.functions.invoke("worker-account-admin",{body:{op:"change_admin_login",email:$("newAdminEmail").value,password:$("newAdminPassword").value}});if(r.error)toast(r.error.message||"Could not update admin login",true);else{formDirty=false;toast("Admin login updated. Use the new email/password next time.")}}}
  if(section==="stock")stock(p,s,w);
  if(section==="dispatch")dispatch(p,w);
  if(section==="depot")depotSale(p);
  if(section==="balance")dailyBalance();
  if(section==="purchases")purchases(p);
  if(section==="settlements")settlements(w,f);
  if(section==="overall")overallReport();
  if(section==="workers")workers(w);
  if(section==="products")products(p);
  if(section==="reports"){
    let[daily,monthly]=await Promise.all([read(db.from("admin_daily_report").select("*").limit(31),"Daily report"),read(db.from("admin_monthly_report").select("*").limit(24),"Monthly report")]);
    const today=new Date().toISOString().slice(0,10);
    $("acontent").innerHTML=`
      <div class="section">
        <h3>Final day report — ready for review</h3>
        <p class="muted">Choose a date. This joins the stock each boy took, what was sold, what remains, money expected and commission in one simple report.</p>
        <div class="row"><label>Date<input id="frDate" type="date" value="${today}"></label><button id="frLoad" type="button" class="info">Show final report</button><button id="frPrint" type="button">Print</button><button id="frShare" type="button">Share</button></div>
        <div id="finalReport">Loading…</div>
      </div>
      <div class="section"><h3>Daily sales history</h3><div class="table"><table><thead><tr><th>Date</th><th>Sales</th><th>Packets</th><th>Sales amount</th><th>Commission</th></tr></thead><tbody>${(daily.data||[]).map(x=>`<tr><td>${x.report_date}</td><td>${x.sales_count}</td><td>${x.packets_sold}</td><td>${money(x.sales_amount)}</td><td>${money(x.commission_amount)}</td></tr>`).join("")||"<tr><td colspan=5>No sales yet.</td></tr>"}</tbody></table></div></div>
      <div class="section"><h3>Monthly sales history</h3><div class="table"><table><thead><tr><th>Month</th><th>Sales</th><th>Packets</th><th>Sales amount</th><th>Commission</th></tr></thead><tbody>${(monthly.data||[]).map(x=>`<tr><td>${x.report_month}</td><td>${x.sales_count}</td><td>${x.packets_sold}</td><td>${money(x.sales_amount)}</td><td>${money(x.commission_amount)}</td></tr>`).join("")||"<tr><td colspan=5>No sales yet.</td></tr>"}</tbody></table></div></div>`;
    let finalText="";
    async function loadFinalReport(){
      const day=$("frDate").value||today;
      $("finalReport").innerHTML="Loading final day report…";
      const r=await db.rpc("admin_dispatch_balance",{p_date:day});
      if(r.error){$("finalReport").innerHTML=`<p class="bad">${esc(r.error.message)}</p>`;return}
      const rows=(r.data||[]).filter(x=>Number(x.issued||0)||Number(x.sold||0)||Number(x.returned||0)||Number(x.remaining||0));
      const groups={};
      rows.forEach(x=>{const k=x.worker_id; if(!groups[k])groups[k]={name:x.worker_name,vans:new Set(),items:[],issued:0,sold:0,returned:0,remaining:0,issuedValue:0,soldValue:0,remainingValue:0,commission:0}; const g=groups[k];if(x.vehicle_label)String(x.vehicle_label).split(', ').forEach(v=>g.vans.add(v));g.items.push(x);g.issued+=Number(x.issued||0);g.sold+=Number(x.sold||0);g.returned+=Number(x.returned||0);g.remaining+=Number(x.remaining||0);g.issuedValue+=Number(x.issued_value||0);g.soldValue+=Number(x.sold_value||0);g.remainingValue+=Number(x.remaining_value||0);g.commission+=Number(x.commission||0)});
      const gs=Object.values(groups),tot=gs.reduce((a,g)=>{a.issued+=g.issued;a.sold+=g.sold;a.returned+=g.returned;a.remaining+=g.remaining;a.issuedValue+=g.issuedValue;a.soldValue+=g.soldValue;a.remainingValue+=g.remainingValue;a.commission+=g.commission;return a},{issued:0,sold:0,returned:0,remaining:0,issuedValue:0,soldValue:0,remainingValue:0,commission:0});
      finalText=`MASOOLI GARDEN DEPOT — FINAL DAY REPORT\nDate: ${day}\n\n`+gs.map(g=>`${g.name} — ${[...g.vans].join(', ')||'No van'}\nTaken: ${g.issued} packets = ${money(g.issuedValue)}\nSold: ${g.sold} packets = ${money(g.soldValue)}\nReturned: ${g.returned} packets\nRemaining: ${g.remaining} packets = ${money(g.remainingValue)}\nMoney expected from sales: ${money(g.soldValue)}\nCommission: ${money(g.commission)}\n`+g.items.filter(x=>Number(x.issued)||Number(x.sold)||Number(x.returned)||Number(x.remaining)).map(x=>`  ${x.product_name}: taken ${x.issued}, sold ${x.sold}, returned ${x.returned}, remaining ${x.remaining}, expected ${money(x.sold_value)}`).join('\n')+`\n`).join('\n')+`TOTAL\nTaken: ${tot.issued} = ${money(tot.issuedValue)}\nSold: ${tot.sold} = ${money(tot.soldValue)}\nReturned: ${tot.returned}\nRemaining: ${tot.remaining} = ${money(tot.remainingValue)}\nMoney expected: ${money(tot.soldValue)}\nCommission: ${money(tot.commission)}`;
      $("finalReport").innerHTML=gs.length?`<div class="stats"><div class="stat"><small>People</small><strong>${gs.length}</strong></div><div class="stat"><small>Taken</small><strong>${tot.issued}</strong><small>${money(tot.issuedValue)}</small></div><div class="stat"><small>Sold</small><strong>${tot.sold}</strong><small>${money(tot.soldValue)}</small></div><div class="stat"><small>Remaining</small><strong>${tot.remaining}</strong><small>${money(tot.remainingValue)}</small></div><div class="stat"><small>Money expected</small><strong>${money(tot.soldValue)}</strong></div><div class="stat"><small>Commission</small><strong>${money(tot.commission)}</strong></div></div>`+gs.map(g=>`<div class="section"><h4>${esc(g.name)} — ${esc([...g.vans].join(', ')||'No van')}</h4><div class="table"><table><thead><tr><th>Product</th><th>Taken</th><th>Sold</th><th>Returned</th><th>Remaining</th><th>Value taken</th><th>Money expected</th><th>Remaining value</th></tr></thead><tbody>${g.items.filter(x=>Number(x.issued)||Number(x.sold)||Number(x.returned)||Number(x.remaining)).map(x=>`<tr><td>${esc(x.product_name)}</td><td>${x.issued}</td><td>${x.sold}</td><td>${x.returned}</td><td><b>${x.remaining}</b></td><td>${money(x.issued_value)}</td><td>${money(x.sold_value)}</td><td>${money(x.remaining_value)}</td></tr>`).join('')}</tbody></table></div><p><b>${esc(g.name)} total:</b> taken ${g.issued} (${money(g.issuedValue)}) · sold ${g.sold} (${money(g.soldValue)}) · remaining ${g.remaining} (${money(g.remainingValue)}) · expected ${money(g.soldValue)} · commission ${money(g.commission)}</p></div>`).join('')+`<div class="section"><h3>Day total</h3><p><b>All boys:</b> ${tot.issued} packets taken, ${tot.sold} sold, ${tot.returned} returned, ${tot.remaining} remaining.</p><p><b>Money:</b> ${money(tot.issuedValue)} value taken · ${money(tot.soldValue)} expected from sales · ${money(tot.remainingValue)} value remaining · ${money(tot.commission)} commission.</p></div>`:`<div class="empty"><b>No worker stock activity for ${day}.</b><p class="muted">When stock is given out, the final report will appear here.</p></div>`;
    }
    $("frLoad").onclick=loadFinalReport;
    $("frPrint").onclick=()=>window.print();
    $("frShare").onclick=async()=>{const t=finalText||"Final day report";if(navigator.share){try{await navigator.share({title:"Masooli Garden Depot Final Day Report",text:t})}catch(e){}}else{await navigator.clipboard?.writeText(t);toast("Final report copied. You can paste it into WhatsApp or print it.")}};
    loadFinalReport();
  }
}
function finTable(f,quick=[]){
 const taken={};
 quick.forEach(x=>{taken[x.worker_id]=(taken[x.worker_id]||0)+Number(x.value_taken||0)});
 return `<div class="table"><table><thead><tr><th>Person</th><th>Stock taken value</th><th>Sales expected</th><th>Paid</th><th>Balance</th><th>Commission</th></tr></thead><tbody>${f.map(x=>`<tr><td>${esc(x.worker_name)}</td><td>${money(taken[x.worker_id]||0)}</td><td>${money(x.expected_amount)}</td><td>${money(x.paid_amount)}</td><td class="${Number(x.outstanding_amount)>0?"bad":"good"}">${money(x.outstanding_amount)}</td><td>${money(x.commission_amount)}</td></tr>`).join("")||"<tr><td colspan=6>No worker activity yet.</td></tr>"}</tbody></table></div>`
}
function dispatchQuickTable(rows=[]){
 if(!rows.length)return `<div class="empty"><b>No stock has been given out today.</b><p class="muted">When you save a dispatch, James/Van A or another boy and all products will appear here immediately.</p></div>`;
 const totals=rows.reduce((a,x)=>{a.qty+=Number(x.quantity||0);a.value+=Number(x.value_taken||0);return a},{qty:0,value:0});
 return `<div class="stats"><div class="stat"><small>People / vans</small><strong>${new Set(rows.map(x=>x.worker_id+"|"+x.vehicle_label)).size}</strong></div><div class="stat"><small>Packets given out</small><strong>${totals.qty}</strong></div><div class="stat"><small>Value given out</small><strong>${money(totals.value)}</strong></div></div><div class="table"><table><thead><tr><th>Boy</th><th>Van</th><th>Route</th><th>Product</th><th>Packets</th><th>Value</th><th>Commission</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${esc(x.worker_name)}</b></td><td>${esc(x.vehicle_label)}</td><td>${esc(x.route_label||"—")}</td><td>${esc(x.product_name)}</td><td>${x.quantity}</td><td>${money(x.value_taken)}</td><td>${Number(x.commission_rate||0)}%</td></tr>`).join("")}</tbody></table></div>`
}
async function loadDispatchQuick(target,dateValue){
 const box=$(target); if(!box)return;
 const r=await db.rpc("admin_dispatch_quick_report",{p_date:dateValue});
 if(r.error){box.innerHTML=`<p class="bad">${esc(r.error.message)}</p>`;return []}
 box.innerHTML=dispatchQuickTable(r.data||[]);return r.data||[];
}
function dispatch(p,w){
 const active=p.filter(x=>x.active),today=new Date().toISOString().slice(0,10);
 $("acontent").innerHTML=`<div class="section"><h3>Give stock to van / boy</h3><p class="muted">Record everything leaving the depot in one dispatch. After saving, check the quick report below before the boy leaves.</p><form id="dispatchForm" class="form"><div class="row"><label>Boy<select id="dw">${w.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Van / vehicle<input id="dv" required placeholder="Van A, Van B, or custom name">
<label>Number plate (optional)<input id="dp" placeholder="e.g. UAX 123A"></label></label><label>Route / area<input id="dr" placeholder="Kampala / Wakiso"></label><label>Date<input id="dd" type="date" value="${today}" required></label><label>Type<select id="dt"><option value="initial">Initial issue</option><option value="top_up">Top-up</option><option value="other">Other</option></select></label></div><div id="dispatchItems"></div><button type="button" class="info" id="addDispatchItem">+ Add product</button><label>Notes<textarea id="dn" rows="2"></textarea></label><button>Save dispatch</button></form></div><div class="section"><h3>Quick report — what has just gone out</h3><p class="muted">This is the same information used by Today, Daily balance and the financial expectation view.</p><div id="dispatchQuick">Loading…</div></div>`;
 const add=()=>{let row=document.createElement("div");row.className="row dispatch-row";row.innerHTML=`<label>Product<select class="di-product">${active.map(x=>`<option value="${x.id}">${esc(x.name)} — ${money(x.selling_price)}</option>`).join("")}</select></label><label>Packets / fraction<input class="di-qty" type="number" min="0.01" step="0.01" required placeholder="0.25, 0.5, 1"></label><button type="button" class="small danger di-remove">Remove</button>`;row.querySelector(".di-remove").onclick=()=>row.remove();$("dispatchItems").appendChild(row)};add();$("addDispatchItem").onclick=add;
 loadDispatchQuick("dispatchQuick",today);
 loadRecallPanel();
 $("dispatchForm").onsubmit=async e=>{e.preventDefault();let items=[...document.querySelectorAll(".dispatch-row")].map(r=>({product_id:r.querySelector(".di-product").value,quantity:+r.querySelector(".di-qty").value})).filter(x=>x.quantity>0);if(!items.length)return toast("Add at least one product.",true);let r=await db.rpc("record_stock_dispatch",{p_worker_id:$("dw").value,p_vehicle_label:$("dv").value,p_items:items,p_dispatch_date:$("dd").value,p_dispatch_type:$("dt").value,p_route_label:$("dr").value,p_notes:$("dn").value});if(r.error)toast(r.error.message,true);else{toast("Dispatch saved. Checking all reports now…");formDirty=false;interactionBusy=false;await admin();await loadDispatchQuick("dispatchQuick",$("dd").value)}};
}
async function loadRecallPanel(){
 const wrap=document.createElement("div");wrap.className="section";wrap.id="recallSection";
 wrap.innerHTML=`<h3>Recall stock from van</h3><p class="muted">Bring unsold stock back to the depot. You can recall a whole packet or a fraction such as 0.25 or 0.5. The return is recorded in the stock history and daily balance.</p><form id="recallForm" class="form"><div class="row"><label>Worker<select id="rw">${(await db.from("workers").select("id,name").eq("business_id",MGD.businessId).eq("active",true).order("name")).data?.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")||""}</select></label><label>Dispatch (optional)<select id="rd"><option value="">Any current van stock</option></select></label><label>Product<select id="rp">${pActiveOptions()}</select></label><label>Quantity / fraction<input id="rq" type="number" min="0.01" step="0.01" placeholder="0.25, 0.5, 1" required></label></div><label>Reason / notes<input id="rn" placeholder="Unsold stock returned"></label><button class="info">Recall to depot</button></form><div id="recallHistory">Loading current dispatches…</div>`;
 $("acontent").appendChild(wrap);
 function pActiveOptions(){return [...document.querySelectorAll(".di-product option")].map(o=>`<option value="${o.value}">${o.textContent}</option>`).join("")}
 async function loadDispatches(){const workerId=$("rw").value;const q=await db.from("stock_dispatches").select("id,dispatch_date,vehicle_label,number_plate,route_label").eq("worker_id",workerId).order("dispatch_date",{ascending:false}).limit(50);$("rd").innerHTML='<option value="">Any current van stock</option>'+(q.data||[]).map(x=>`<option value="${x.id}">${esc(x.vehicle_label||"Van")} ${x.number_plate?"— "+esc(x.number_plate):""} — ${x.dispatch_date}${x.route_label?" — "+esc(x.route_label):""}</option>`).join("");}
 $("rw").onchange=loadDispatches;await loadDispatches();
 $("recallForm").onsubmit=async e=>{e.preventDefault();const qty=Number($("rq").value);if(!(qty>0))return toast("Enter a quantity greater than zero.",true);const r=await db.rpc("record_stock_recall",{p_worker_id:$("rw").value,p_product_id:$("rp").value,p_quantity:qty,p_dispatch_id:$("rd").value||null,p_notes:$("rn").value});if(r.error){toast(r.error.message,true);return}formDirty=false;interactionBusy=false;toast("Stock recalled to depot. Reports will update.");await admin();}
}

async function overallReport(){
  const end=new Date().toISOString().slice(0,10);
  const start=new Date(Date.now()-29*86400000).toISOString().slice(0,10);
  $("acontent").innerHTML=`<div class="section"><h3>Overall business report</h3><p class="muted">One place to see all boys' sales, depot/walk-in sales, stock given out and money received for any period.</p><div class="row"><label>From<input id="orStart" type="date" value="${start}"></label><label>To<input id="orEnd" type="date" value="${end}"></label><button id="orLoad" type="button" class="info">Show report</button><button id="orPrint" type="button">Print</button><button id="orShare" type="button">Share</button></div><div id="orSummary">Loading…</div><div id="orPeople"></div></div>`;
  let reportText="";
  const load=async()=>{
    const from=$("orStart").value,to=$("orEnd").value;
    if(!from||!to||from>to)return toast("Choose a valid date range.",true);
    $("orSummary").innerHTML="Loading overall report…";$("orPeople").innerHTML="";
    const r=await db.rpc("admin_overall_report",{p_start:from,p_end:to});
    if(r.error){$("orSummary").innerHTML=`<p class="bad">${esc(r.error.message)}</p>`;return}
    const rows=r.data||[],total=rows.find(x=>x.section==="total")||{packets_sold:0,sales_amount:0,commission:0,payments_received:0,packets_dispatched:0,dispatched_value:0};
    const boys=rows.filter(x=>x.section==="boy");
    const depot=rows.filter(x=>x.section==="depot").reduce((a,x)=>({packets_sold:a.packets_sold+Number(x.packets_sold||0),sales_amount:a.sales_amount+Number(x.sales_amount||0)}),{packets_sold:0,sales_amount:0});
    reportText=`MASOOLI GARDEN DEPOT — OVERALL BUSINESS REPORT\nFrom: ${from}\nTo: ${to}\n\nWHOLE BUSINESS\nPackets sold: ${Number(total.packets_sold||0)}\nSales amount: ${money(total.sales_amount)}\nPackets dispatched: ${Number(total.packets_dispatched||0)}\nDispatched value: ${money(total.dispatched_value)}\nCommission: ${money(total.commission)}\nWorker payments received: ${money(total.payments_received)}\n\nBOYS\n`+boys.map(x=>`${x.worker_name}: sold ${Number(x.packets_sold||0)} packets = ${money(x.sales_amount)}; dispatched ${Number(x.packets_dispatched||0)} = ${money(x.dispatched_value)}; commission ${money(x.commission)}; payments received ${money(x.payments_received)}`).join('\n')+`\n\nDEPOT / WALK-IN\nSold: ${depot.packets_sold} packets = ${money(depot.sales_amount)}`;
    $("orSummary").innerHTML=`<div class="stats"><div class="stat"><small>Total packets sold</small><strong>${Number(total.packets_sold||0)}</strong></div><div class="stat"><small>Total sales</small><strong>${money(total.sales_amount)}</strong></div><div class="stat"><small>Stock dispatched</small><strong>${Number(total.packets_dispatched||0)}</strong></div><div class="stat"><small>Dispatched value</small><strong>${money(total.dispatched_value)}</strong></div><div class="stat"><small>Commission</small><strong>${money(total.commission)}</strong></div><div class="stat"><small>Worker payments received</small><strong>${money(total.payments_received)}</strong></div><div class="stat"><small>Depot packets sold</small><strong>${depot.packets_sold}</strong></div><div class="stat"><small>Depot sales</small><strong>${money(depot.sales_amount)}</strong></div></div>`;
    $("orPeople").innerHTML=`<div class="section"><h3>Boys / workers</h3><div class="table"><table><thead><tr><th>Boy</th><th>Packets sold</th><th>Sales</th><th>Packets given out</th><th>Value given out</th><th>Commission</th><th>Payments received</th></tr></thead><tbody>${boys.map(x=>`<tr><td><b>${esc(x.worker_name)}</b></td><td>${x.packets_sold}</td><td>${money(x.sales_amount)}</td><td>${x.packets_dispatched}</td><td>${money(x.dispatched_value)}</td><td>${money(x.commission)}</td><td>${money(x.payments_received)}</td></tr>`).join('')||'<tr><td colspan="7">No worker sales in this period.</td></tr>'}</tbody></table></div></div><div class="section"><h3>Depot / walk-in sales</h3><div class="stats"><div class="stat"><small>Packets sold</small><strong>${depot.packets_sold}</strong></div><div class="stat"><small>Sales amount</small><strong>${money(depot.sales_amount)}</strong></div></div><p class="muted">These are sales recorded directly at the depot, separate from boys' sales.</p></div><div class="section"><h3>Period totals</h3><p><b>All sales:</b> ${money(total.sales_amount)} from ${Number(total.packets_sold||0)} packets.</p><p><b>Stock given to boys:</b> ${Number(total.packets_dispatched||0)} packets valued at ${money(total.dispatched_value)}.</p><p><b>Worker payments received:</b> ${money(total.payments_received)}.</p><p><b>Commission:</b> ${money(total.commission)}.</p></div>`;
  };
  $("orLoad").onclick=load;$("orPrint").onclick=()=>window.print();$("orShare").onclick=async()=>{const t=reportText||"Overall business report";if(navigator.share){try{await navigator.share({title:"Masooli Garden Depot Overall Business Report",text:t})}catch(e){}}else{await navigator.clipboard?.writeText(t);toast("Report copied. You can paste it into WhatsApp or print it.")}};
  load();
}
async function dailyBalance(){
 const d=new Date().toISOString().slice(0,10);
 $("acontent").innerHTML=`<div class="section"><h3>Daily balance — person first</h3><p class="muted">See each boy/van first. Open the person to see every product taken, sold, remaining and the money connected to it.</p><div class="row"><label>Date<input id="bd" type="date" value="${d}"></label><button id="bload" class="info">Refresh balance</button><button id="bprint" type="button">Print / review</button><button id="bshare" type="button">Share report</button></div><div id="bsummary">Loading…</div><div id="bdetail"></div></div>`;
 const load=async()=>{
  let r=await db.rpc("admin_dispatch_balance",{p_date:$("bd").value});
  if(r.error){$("bsummary").innerHTML=`<p class="bad">${esc(r.error.message)}</p>`;return}
  const rows=r.data||[],groups={};
  rows.forEach(x=>{(groups[x.worker_id]??={id:x.worker_id,name:x.worker_name,van:new Set(),issued:0,sold:0,returned:0,remaining:0,issuedValue:0,soldValue:0,remainingValue:0,commission:0,items:[]});const g=groups[x.worker_id];if(x.vehicle_label)String(x.vehicle_label).split(", ").forEach(v=>g.van.add(v));g.issued+=Number(x.issued||0);g.sold+=Number(x.sold||0);g.returned+=Number(x.returned||0);g.remaining+=Number(x.remaining||0);g.issuedValue+=Number(x.issued_value||0);g.soldValue+=Number(x.sold_value||0);g.remainingValue+=Number(x.remaining_value||0);g.commission+=Number(x.commission||0);g.items.push(x)});
  const gs=Object.values(groups),total=gs.reduce((a,g)=>({issued:a.issued+g.issued,sold:a.sold+g.sold,remaining:a.remaining+g.remaining,issuedValue:a.issuedValue+g.issuedValue,soldValue:a.soldValue+g.soldValue,remainingValue:a.remainingValue+g.remainingValue,commission:a.commission+g.commission}),{issued:0,sold:0,remaining:0,issuedValue:0,soldValue:0,remainingValue:0,commission:0});
  $("bsummary").innerHTML=`<div class="stats"><div class="stat"><small>People</small><strong>${gs.length}</strong></div><div class="stat"><small>Packets taken</small><strong>${total.issued}</strong></div><div class="stat"><small>Sold</small><strong>${total.sold}</strong></div><div class="stat"><small>Stock left</small><strong>${total.remaining}</strong></div><div class="stat"><small>Money expected from sales</small><strong>${money(total.soldValue)}</strong></div></div><div class="table"><table><thead><tr><th>Person</th><th>Van</th><th>Taken</th><th>Sold</th><th>Remaining</th><th>Value taken</th><th>Sales expected</th><th>Value remaining</th></tr></thead><tbody>${gs.map((g,i)=>`<tr><td><button type="button" class="small" data-open-balance="${i}">${esc(g.name)}</button></td><td>${esc([...g.van].join(", ")||"—")}</td><td>${g.issued}</td><td>${g.sold}</td><td><b>${g.remaining}</b></td><td>${money(g.issuedValue)}</td><td><b>${money(g.soldValue)}</b></td><td>${money(g.remainingValue)}</td></tr>`).join("")||'<tr><td colspan="8">No worker stock activity for this date.</td></tr>'}</tbody></table></div>`;
  $("bdetail").innerHTML=gs.map((g,i)=>`<div class="section hidden balance-person" id="bp-${i}"><h3>${esc(g.name)} — ${esc([...g.van].join(", ")||"No van")}</h3><div class="stats"><div class="stat"><small>Taken</small><strong>${g.issued}</strong><small>${money(g.issuedValue)}</small></div><div class="stat"><small>Sold</small><strong>${g.sold}</strong><small>${money(g.soldValue)}</small></div><div class="stat"><small>Remaining</small><strong>${g.remaining}</strong><small>${money(g.remainingValue)}</small></div><div class="stat"><small>Commission</small><strong>${money(g.commission)}</strong></div></div><div class="table"><table><thead><tr><th>Product</th><th>Taken</th><th>Sold</th><th>Returned</th><th>Remaining</th><th>Value taken</th><th>Sold money</th><th>Remaining value</th></tr></thead><tbody>${g.items.map(x=>`<tr><td>${esc(x.product_name)}</td><td>${x.issued}</td><td>${x.sold}</td><td>${x.returned}</td><td><b>${x.remaining}</b></td><td>${money(x.issued_value)}</td><td>${money(x.sold_value)}</td><td>${money(x.remaining_value)}</td></tr>`).join("")}</tbody></table></div></div>`).join("");
  document.querySelectorAll("[data-open-balance]").forEach(b=>b.onclick=()=>$("bp-"+b.dataset.openBalance).classList.toggle("hidden"));
  window.__balanceText=`MASOOLI GARDEN DEPOT — DAILY BALANCE\nDate: ${$("bd").value}\n\n`+gs.map(g=>`${g.name} (${[...g.van].join(", ")||"No van"})\nTaken: ${g.issued} packets = ${money(g.issuedValue)}\nSold: ${g.sold} packets = ${money(g.soldValue)}\nRemaining: ${g.remaining} packets = ${money(g.remainingValue)}\nSales expected: ${money(g.soldValue)}\nCommission: ${money(g.commission)}\n`+g.items.map(x=>`  ${x.product_name}: taken ${x.issued}, sold ${x.sold}, returned ${x.returned}, remaining ${x.remaining}, sales ${money(x.sold_value)}`).join("\n")+"\n").join("\n")+`TOTAL\nTaken: ${total.issued} = ${money(total.issuedValue)}\nSold: ${total.sold} = ${money(total.soldValue)}\nRemaining: ${total.remaining} = ${money(total.remainingValue)}`;
 };
 $("bload").onclick=load;$("bprint").onclick=()=>window.print();$("bshare").onclick=async()=>{let t=window.__balanceText||"Daily balance";if(navigator.share){try{await navigator.share({title:"Masooli Garden Depot Daily Balance",text:t})}catch(e){}}else{await navigator.clipboard?.writeText(t);toast("Report copied. You can paste it into WhatsApp or print it.")}};load();
}
async function workers(w){
  let up=await db.rpc("list_unassigned_profiles");let profiles=up.data||[];
  const callWorker=body=>db.functions.invoke("worker-account-admin",{body});
  $("acontent").innerHTML=`<div class="section"><h3>Create worker account</h3><form id="wf" class="form"><div class="row"><label>Name<input id="wn" required></label><label>Phone<input id="wp"></label><label>Commission %<input id="wr" type="number" value="0" min="0" max="100" step=".1"></label><label>Worker PIN<input id="wpin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="6 digits"></label></div><button id="workerSave">Create worker + login</button></form><p class="muted">Workers use Worker ID + 6-digit PIN. No email is required.</p></div><div class="section"><h3>Workers</h3><div class="table"><table><thead><tr><th>Name</th><th>Phone</th><th>Commission</th><th>Worker ID</th><th>Status</th><th>Action</th></tr></thead><tbody>${w.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.phone||"")}</td><td>${x.commission_rate}%</td><td><b>${esc(x.login_code||"Not set")}</b></td><td>${x.active?"Active":"Deactivated"}</td><td>${x.active?`<button type="button" class="small archive" data-deactivate-worker="${x.id}">Deactivate</button>`:""} ${x.profile_id?`<button type="button" class="small info" data-reset-worker="${x.id}">Reset PIN</button>`:""}</td></tr>`).join("")||"<tr><td colspan=6>No workers yet.</td></tr>"}</tbody></table></div></div><div class="section"><h3>Older unassigned accounts</h3><p class="muted">Accounts created before Worker ID login was enabled can still be assigned.</p>${profiles.map(p=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #d9e2ec"><div><b>${esc(p.full_name||"Unnamed")}</b><div class="muted">${esc(p.phone||"")}</div></div><select id="aw-${p.id}">${w.filter(x=>x.active&&!x.profile_id).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select><button type="button" class="small" onclick="assign('${p.id}')">Assign</button></div>`).join("")||'<p class="muted">No older unassigned accounts.</p>'}</div><div class="section"><h3>Worker communication</h3><div id="workerMessages">Loading…</div></div>`;
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