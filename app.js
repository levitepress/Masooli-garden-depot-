const {createClient}=supabase;
const db=createClient(MGD.url,MGD.key);
const $=x=>document.getElementById(x);
const money=n=>new Intl.NumberFormat("en-UG",{style:"currency",currency:"UGX",maximumFractionDigits:0}).format(Number(n||0));
const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const date=x=>x?new Date(x).toLocaleString("en-UG",{dateStyle:"medium",timeStyle:"short"}):"—";
let deferredInstallPrompt=null;
function updateNetworkStatus(){const e=$("netStatus");if(!e)return;e.textContent=navigator.onLine?"ONLINE":"OFFLINE";e.className="status "+(navigator.onLine?"online":"offline");}
window.addEventListener("online",updateNetworkStatus);window.addEventListener("offline",updateNetworkStatus);updateNetworkStatus();
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;const b=$("installBtn");if(b)b.classList.remove("hidden")});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;const b=$("installBtn");if(b)b.classList.add("hidden");toast("Masooli Garden Depot installed on this phone")});
document.addEventListener("click",e=>{if(e.target&&e.target.id==="installBtn"&&deferredInstallPrompt){deferredInstallPrompt.prompt();deferredInstallPrompt.userChoice.finally(()=>{deferredInstallPrompt=null;$("installBtn").classList.add("hidden")})}});
let profile=null,worker=null,section="dash",wsection="home",channel=null;
function toast(x,bad=false){let t=$("toast");t.textContent=x;t.className="show";t.style.background=bad?"#a61b1b":"#102a43";setTimeout(()=>t.className="",3000)}
function only(id){["auth","waiting","admin","worker"].forEach(x=>$(x).classList.add("hidden"));$(id).classList.remove("hidden")}
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));$("login").classList.toggle("hidden",b.dataset.tab!=="login");$("signup").classList.toggle("hidden",b.dataset.tab!=="signup")});

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
window.addEventListener("online",()=>{toast("Internet restored. Syncing…");syncOfflineSales().then(()=>workerApp())});
window.addEventListener("offline",()=>toast("Offline mode: sales can be queued and synced later."));
async function load(){const {data:{user}}=await db.auth.getUser();if(!user){only("auth");$("title").textContent="Sign in";$("logout").classList.add("hidden");return}
$("logout").classList.remove("hidden");let q=await db.from("profiles").select("*").eq("id",user.id).maybeSingle();if(q.error)return toast(q.error.message,true);profile=q.data;
if(!profile?.business_id){
  const claim=await db.rpc("set_initial_owner",{p_business_id:MGD.businessId});
  if(!claim.error){toast("Owner account activated");return load()}
  only("waiting");$("title").textContent="Awaiting assignment";return
}
if(profile.role==="admin"){only("admin");$("title").textContent="Owner Dashboard";await admin();live()}else{let w=await db.from("workers").select("*").eq("profile_id",user.id).maybeSingle();worker=w.data;if(!worker){only("waiting");return}only("worker");$("title").textContent="My Dashboard";await workerApp();live()}}
$("login").onsubmit=async e=>{e.preventDefault();let r=await db.auth.signInWithPassword({email:$("le").value,password:$("lp").value});if(r.error)toast(r.error.message,true);else load()};
$("signup").onsubmit=async e=>{e.preventDefault();let r=await db.auth.signUp({email:$("se").value,password:$("sw").value,options:{data:{full_name:$("sn").value,phone:$("sp").value}}});if(r.error)return toast(r.error.message,true);if(r.data.session){let c=await db.rpc("set_initial_owner",{p_business_id:MGD.businessId});if(!c.error){toast("Owner account created");return load()}}toast("Account created. Confirm your email if required, then sign in.")};
$("logout").onclick=async()=>{await db.auth.signOut();location.reload()};$("refresh").onclick=load;
function live(){if(channel)db.removeChannel(channel);channel=db.channel("mgd-live").on("postgres_changes",{event:"*",schema:"public",table:"sales"},refresh).on("postgres_changes",{event:"*",schema:"public",table:"stock_movements"},refresh).on("postgres_changes",{event:"*",schema:"public",table:"worker_payments"},refresh).subscribe()}
async function refresh(){if(profile?.role==="admin")admin();else workerApp()}
document.querySelectorAll("#anav button").forEach(b=>b.onclick=()=>{section=b.dataset.s;document.querySelectorAll("#anav button").forEach(x=>x.classList.toggle("active",x===b));admin()});
document.querySelectorAll("#wnav button").forEach(b=>b.onclick=()=>{wsection=b.dataset.s;document.querySelectorAll("#wnav button").forEach(x=>x.classList.toggle("active",x===b));workerApp()});
async function admin(){let [p,s,w,f]=await Promise.all([db.from("admin_product_catalog").select("*"),db.from("warehouse_stock_balances").select("*"),db.from("workers").select("*").order("name"),db.from("worker_financial_summary").select("*")]);p=p.data||[];s=s.data||[];w=w.data||[];f=f.data||[];let expected=f.reduce((a,x)=>a+Number(x.expected_amount||0),0),paid=f.reduce((a,x)=>a+Number(x.paid_amount||0),0);$("astats").innerHTML=[["Products",p.length],["Warehouse packets",s.reduce((a,x)=>a+Number(x.quantity_on_hand||0),0)],["Expected",money(expected)],["Outstanding",money(expected-paid)]].map(x=>`<div class="stat"><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join("");
if(section==="dash")$("acontent").innerHTML=`<div class="section"><h3>Worker balances</h3>${finTable(f)}</div>`;
if(section==="stock")stock(p,s,w); if(section==="purchases")purchases(p); if(section==="settlements")settlements(w,f);
if(section==="workers")workers(w);
if(section==="products")products(p);
if(section==="reports"){let[daily,monthly]=await Promise.all([db.from("admin_daily_report").select("*").limit(31),db.from("admin_monthly_report").select("*").limit(24)]);$("acontent").innerHTML=`<div class="section"><h3>Worker financial report</h3>${finTable(f)}</div><div class="section"><h3>Daily sales report</h3><div class="table"><table><thead><tr><th>Date</th><th>Sales</th><th>Packets</th><th>Sales amount</th><th>Commission</th></tr></thead><tbody>${(daily.data||[]).map(x=>`<tr><td>${x.report_date}</td><td>${x.sales_count}</td><td>${x.packets_sold}</td><td>${money(x.sales_amount)}</td><td>${money(x.commission_amount)}</td></tr>`).join("")||"<tr><td colspan=5>No sales yet.</td></tr>"}</tbody></table></div></div><div class="section"><h3>Monthly sales report</h3><div class="table"><table><thead><tr><th>Month</th><th>Sales</th><th>Packets</th><th>Sales amount</th><th>Commission</th></tr></thead><tbody>${(monthly.data||[]).map(x=>`<tr><td>${x.report_month}</td><td>${x.sales_count}</td><td>${x.packets_sold}</td><td>${money(x.sales_amount)}</td><td>${money(x.commission_amount)}</td></tr>`).join("")||"<tr><td colspan=5>No sales yet.</td></tr>"}</tbody></table></div></div>`}}
function finTable(f){return `<div class="table"><table><thead><tr><th>Worker</th><th>Expected</th><th>Paid</th><th>Outstanding</th><th>Commission</th></tr></thead><tbody>${f.map(x=>`<tr><td>${esc(x.worker_name)}</td><td>${money(x.expected_amount)}</td><td>${money(x.paid_amount)}</td><td class="${Number(x.outstanding_amount)>0?"bad":"good"}">${money(x.outstanding_amount)}</td><td>${money(x.commission_amount)}</td></tr>`).join("")||"<tr><td colspan=5>No activity yet.</td></tr>"}</tbody></table></div>`}
function stock(p,s,w){$("acontent").innerHTML=`<div class="section"><h3>Warehouse stock</h3><div class="table"><table><thead><tr><th>Product</th><th>Packets</th><th>Buying</th><th>Selling</th><th>Margin</th></tr></thead><tbody>${p.map(x=>{let y=s.find(z=>z.product_id===x.id);return `<tr><td>${esc(x.name)}</td><td>${y?.quantity_on_hand||0}</td><td>${money(x.buying_price)}</td><td>${money(x.selling_price)}</td><td>${money(Number(x.selling_price)-Number(x.buying_price))}</td></tr>`}).join("")}</tbody></table></div></div>
<div class="section"><h3>Issue stock to worker</h3><form id="issue" class="form"><div class="row"><label>Worker<select id="iw">${w.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Product<select id="ip">${p.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Packets<input id="iq" type="number" min="1" required></label></div><button>Issue stock</button></form></div>
<div class="section"><h3>Receive returned stock</h3><form id="returnForm" class="form"><div class="row"><label>Worker<select id="rw">${w.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Product<select id="rp">${p.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Packets<input id="rq" type="number" min="1" required></label></div><button>Record return</button></form></div>
<div class="section"><h3>Stock correction</h3><form id="adjustForm" class="form"><div class="row"><label>Product<select id="ap">${p.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Quantity change<input id="aq" type="number" step="1" required></label><label>Reason<input id="ar" required placeholder="e.g. damaged / recount"></label></div><button>Save correction</button></form></div>`;
$("issue").onsubmit=async e=>{e.preventDefault();let r=await db.rpc("issue_stock",{p_worker_id:$("iw").value,p_product_id:$("ip").value,p_quantity:+$("iq").value});if(r.error)toast(r.error.message,true);else{toast("Stock issued");admin()}};
$("returnForm").onsubmit=async e=>{e.preventDefault();let r=await db.rpc("record_stock_return",{p_worker_id:$("rw").value,p_product_id:$("rp").value,p_quantity:+$("rq").value});if(r.error)toast(r.error.message,true);else{toast("Return recorded");admin()}};
$("adjustForm").onsubmit=async e=>{e.preventDefault();let r=await db.rpc("record_stock_adjustment",{p_product_id:$("ap").value,p_quantity_delta:+$("aq").value,p_reason:$("ar").value});if(r.error)toast(r.error.message,true);else{toast("Correction saved");admin()}}}
async function workers(w){
  let up=await db.rpc("list_unassigned_profiles"); let profiles=up.data||[];
  $("acontent").innerHTML=`<div class="section"><h3>Add worker</h3><form id="wf" class="form"><div class="row"><label>Name<input id="wn" required></label><label>Phone<input id="wp"></label><label>Commission %<input id="wr" type="number" value="5" min="0" max="100" step=".1"></label></div><button>Add worker</button></form></div><div class="section"><h3>Workers</h3><div class="table"><table><thead><tr><th>Name</th><th>Phone</th><th>Commission</th><th>Account</th></tr></thead><tbody>${w.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.phone||"")}</td><td>${x.commission_rate}%</td><td>${x.profile_id?"Assigned":"Not assigned"}</td></tr>`).join("")}</tbody></table></div></div><div class="section"><h3>Assign worker accounts</h3><p class="muted">A worker creates an account first. Then select the worker record and their unassigned account.</p>${profiles.map(p=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #d9e2ec"><div><b>${esc(p.full_name||"Unnamed")}</b><div class="muted">${esc(p.phone||"")}</div></div><select id="aw-${p.id}">${w.filter(x=>x.active&&!x.profile_id).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select><button type="button" class="small" onclick="assign('${p.id}')">Assign</button></div>`).join("")||'<p class="muted">No unassigned worker accounts.</p>'}</div>`;
  $("wf").onsubmit=async e=>{e.preventDefault();let r=await db.rpc("create_worker",{p_name:$("wn").value,p_phone:$("wp").value,p_commission_rate:+$("wr").value});if(r.error)toast(r.error.message,true);else{toast("Worker added");admin()}}
}
window.assign=async pid=>{let workerId=$("aw-"+pid)?.value;if(!workerId)return toast("Add an unassigned worker record first.",true);let r=await db.rpc("assign_worker_account",{p_worker_id:workerId,p_profile_id:pid});if(r.error)toast(r.error.message,true);else{toast("Account assigned");admin()}};
function products(p){$("acontent").innerHTML=`<div class="section"><h3>Products & prices</h3><form id="pf" class="form"><div class="row"><label>Name<input id="pn" required></label><label>SKU<input id="ps"></label><label>Pack size<input id="pk" type="number" value="6" min="1"></label><label>Buying<input id="pb" type="number" min="0" required></label><label>Selling<input id="pv" type="number" min="0" required></label></div><button>Add product</button></form></div><div class="section"><div class="table"><table><thead><tr><th>Product</th><th>Pack</th><th>Buying</th><th>Selling</th></tr></thead><tbody>${p.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.pack_size}</td><td>${money(x.buying_price)}</td><td>${money(x.selling_price)}</td></tr>`).join("")}</tbody></table></div></div>`;$("pf").onsubmit=async e=>{e.preventDefault();let r=await db.rpc("upsert_product",{p_name:$("pn").value,p_sku:$("ps").value,p_pack_size:+$("pk").value,p_buying_price:+$("pb").value,p_selling_price:+$("pv").value,p_active:true});if(r.error)toast(r.error.message,true);else{toast("Product added");admin()}}}

async function purchases(p){
 $("acontent").innerHTML=`<div class="section"><h3>Record purchase / stock received</h3><form id="purchaseForm" class="form"><div class="row"><label>Product<select id="pp">${p.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Packets<input id="pq" type="number" min="1" required></label><label>Buying price / packet<input id="pc" type="number" min="0" required></label><label>Supplier<input id="psup"></label><label>Reference<input id="pref"></label></div><button>Save purchase</button></form></div><div class="section"><h3>Stock receipt history</h3><div id="purchaseHistory">Loading…</div></div>`;
 $("purchaseForm").onsubmit=async e=>{e.preventDefault();let r=await db.rpc("record_purchase",{p_product_id:$("pp").value,p_quantity:+$("pq").value,p_unit_cost:+$("pc").value,p_supplier:$("psup").value,p_reference:$("pref").value});if(r.error)toast(r.error.message,true);else{toast("Purchase recorded");purchases(p)}};
 let q=await db.from("admin_purchases_summary").select("*").order("purchased_at",{ascending:false}).limit(50);
 $("purchaseHistory").innerHTML=`<div class="table"><table><thead><tr><th>Date</th><th>Product</th><th>Packets</th><th>Unit cost</th><th>Supplier</th></tr></thead><tbody>${(q.data||[]).map(x=>`<tr><td>${date(x.purchased_at)}</td><td>${esc(x.product_name)}</td><td>${x.quantity}</td><td>${money(x.unit_cost)}</td><td>${esc(x.supplier||"—")}</td></tr>`).join("")||"<tr><td colspan=5>No purchases recorded.</td></tr>"}</tbody></table></div>`;
}
async function settlements(w,f){
 $("acontent").innerHTML=`<div class="section"><h3>Worker settlements</h3><p class="muted">Record money returned by a worker. This changes the worker's outstanding balance but never exposes purchasing prices to the worker.</p><form id="payForm" class="form"><div class="row"><label>Worker<select id="payWorker">${w.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><label>Amount<input id="payAmount" type="number" min="1" required></label><label>Method<select id="payMethod"><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank">Bank</option><option value="other">Other</option></select></label><label>Reference<input id="payRef"></label></div><button>Record payment</button></form></div><div class="section"><h3>Current balances</h3>${finTable(f)}</div>`;
 $("payForm").onsubmit=async e=>{e.preventDefault();let r=await db.rpc("record_worker_payment",{p_worker_id:$("payWorker").value,p_amount:+$("payAmount").value,p_method:$("payMethod").value,p_reference:$("payRef").value});if(r.error)toast(r.error.message,true);else{toast("Payment recorded");admin()}};
}

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
if(wsection==="home")$("wcontent").innerHTML=`<div class="section"><h3>My dashboard</h3><p class="muted">Only your own stock, sales, payments, outstanding balance and commission are shown here.</p>${saleTable(h.slice(0,8))}</div>`;
if(wsection==="stock")$("wcontent").innerHTML=`<div class="section"><h3>My stock</h3><div class="table"><table><thead><tr><th>Product</th><th>Packets remaining</th><th>Pack</th></tr></thead><tbody>${s.map(x=>`<tr><td>${esc(x.product_name)}</td><td>${x.quantity_remaining}</td><td>${x.pack_size}</td></tr>`).join("")||"<tr><td colspan=3>No stock issued yet.</td></tr>"}</tbody></table></div></div>`;
if(wsection==="history")$("wcontent").innerHTML=`<div class="section"><h3>My sales history</h3>${saleTable(h)}</div>`;
if(wsection==="sell"){let pending=await queuedSales();$("wcontent").innerHTML=`<div class="section"><h3>Record sale</h3><p class="muted">If the phone loses internet, the sale is saved securely on the phone and automatically synced when connection returns.</p><form id="sf" class="form"><label>Product<select id="spx">${c.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)} — ${money(x.selling_price)}</option>`).join("")}</select></label><div class="row"><label>Packets sold<input id="sq" type="number" min="1" required></label><label>Receipt number<input id="sr"></label></div><button>Save sale</button></form><p class="muted">Pending offline sales: ${pending.length}</p></div>`;$("sf").onsubmit=async e=>{e.preventDefault();let item={client_ref:"OFF-"+crypto.randomUUID(),product_id:$("spx").value,quantity:+$("sq").value,receipt_no:$("sr").value,sold_at:new Date().toISOString()};if(!navigator.onLine){await queueSale(item);toast("Saved offline; it will sync automatically.");return workerApp()}let r=await db.rpc("record_worker_sale",{p_product_id:item.product_id,p_quantity:item.quantity,p_receipt_no:item.receipt_no,p_sold_at:item.sold_at,p_client_ref:item.client_ref});if(r.error){if(/Failed to fetch|NetworkError|Load failed/i.test(r.error.message)){await queueSale(item);toast("Saved offline; it will sync automatically.");}else toast(r.error.message,true)}else toast("Sale recorded");workerApp()};syncOfflineSales()}}
function saleTable(h){return `<div class="table"><table><thead><tr><th>Date</th><th>Receipt</th><th>Expected</th><th>Commission</th></tr></thead><tbody>${h.map(x=>`<tr><td>${date(x.sold_at)}</td><td>${esc(x.receipt_no||"—")}</td><td>${money(x.expected_amount)}</td><td>${money(x.commission_amount)}</td></tr>`).join("")||"<tr><td colspan=4>No sales yet.</td></tr>"}</tbody></table></div>`}
db.auth.onAuthStateChange(()=>setTimeout(load,0));if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});window.addEventListener("load",()=>setTimeout(syncOfflineSales,1000));load();
