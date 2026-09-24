$("purchaseForm").onsubmit=async e=>{
  e.preventDefault();

  const r=await db.rpc("record_purchase",{
    p_product_id:$("pp").value,
    p_quantity:Number($("pq").value),
    p_unit_cost:Number($("pc").value),
    p_supplier:$("psup").value.trim() || null,
    p_reference:$("pref").value.trim() || null,
    p_notes:""
  });

  if(r.error){
    toast(r.error.message,true);
  }else{
    toast("Purchase recorded");
    purchases(p);
  }
};
