const $=(q,root=document)=>root.querySelector(q);
const $$=(q,root=document)=>[...root.querySelectorAll(q)];
async function aFetch(url,opts={}){
  try{
    const isForm=opts.body instanceof FormData;
    const headers=isForm?(opts.headers||{}):{'Content-Type':'application/json',...(opts.headers||{})};
    const res=await fetch(url,{credentials:'same-origin',headers,...opts});
    if(res.status===401||res.status===403){location.href='/admin/login';return {ok:false};}
    return await res.json();
  }catch(e){alert('Koneksi gagal: '+e.message);return {ok:false};}
}
async function adminLogout(){await fetch('/api/logout',{method:'POST',credentials:'same-origin'});location.href='/admin/login';}
async function loadAdminStats(){
  const r=await aFetch('/api/admin/stats');
  if(!r.ok)return null;
  const s=r.stats;
  const map={s1:s.totalUsers,s2:s.totalDevices,s3:s.onlineDevices,s4:s.totalBlasts,s5:s.totalSent,s6:s.totalFailed,s7:s.pendingWd};
  for(const [id,val] of Object.entries(map)){const el=document.getElementById(id);if(el)el.textContent=val;}
  return s;
}
async function loadAdminDevices(containerId='devTable'){
  const el=document.getElementById(containerId);if(!el)return;
  el.innerHTML='<div style="color:var(--muted);text-align:center;padding:20px;">Memuat…</div>';
  const r=await aFetch('/api/admin/devices');if(!r.ok)return;
  if(!r.devices.length){el.innerHTML='<div style="color:var(--muted);text-align:center;padding:20px;">Belum ada device</div>';return;}
  el.innerHTML=r.devices.map(d=>`<div class="list-item"><div><b>${d.phone||'—'}</b><div style="color:var(--muted);font-size:11px;">User: ${d.username||'?'} • ID: ${d.device_id.slice(0,16)}…</div></div><span class="badge ${d.live?'green':'red'}">${d.live?'ONLINE':'OFFLINE'}</span></div>`).join('');
}
async function loadAdminWD(containerId='wdList'){
  const el=document.getElementById(containerId);if(!el)return;
  el.innerHTML='<div style="color:var(--muted);text-align:center;padding:20px;">Memuat…</div>';
  const r=await aFetch('/api/admin/wd');if(!r.ok)return;
  if(!r.withdrawals.length){el.innerHTML='<div style="color:var(--muted);text-align:center;padding:20px;">Belum ada permintaan</div>';return;}
  el.innerHTML=r.withdrawals.map(w=>`<div style="padding:14px;background:var(--card2);border-radius:12px;margin-bottom:10px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;"><div><div style="font-size:18px;font-weight:700;">Rp ${w.amount.toLocaleString('id-ID')}</div><div style="color:var(--muted);font-size:12px;">${w.method} • ${w.account} • ${w.holder}</div><div style="color:var(--muted);font-size:11px;">User: ${w.username}</div></div><span class="badge ${w.status==='done'?'green':w.status==='rejected'?'red':'yellow'}">${w.status.toUpperCase()}</span></div>${w.status==='pending'?`<div style="display:flex;gap:8px;margin-top:10px;"><button class="btn green" style="padding:8px;font-size:12px;" onclick="setWDStatus(${w.id},'done')">✓ Sudah TF</button><button class="btn danger" style="padding:8px;font-size:12px;" onclick="setWDStatus(${w.id},'rejected')">✕ Tolak</button></div>`:''}</div>`).join('');
}
async function setWDStatus(id,status){const r=await aFetch('/api/admin/wd/'+id,{method:'POST',body:JSON.stringify({status})});if(r.ok)loadAdminWD();}
const uploadState={currentImageUrl:'',pendingFile:null,removeImage:false};
async function initAdminSetting(){
  const dropZone=document.getElementById('dropZone');
  const fileInput=document.getElementById('promo_image');
  if(!dropZone||!fileInput)return;
  await loadAdminSettings();
  bindDropZoneEvents(dropZone,fileInput);
  document.getElementById('btnSave').onclick=saveAdminSettings;
  document.getElementById('btnReset').onclick=()=>{if(confirm('Reset form?'))loadAdminSettings();};
}
async function loadAdminSettings(){
  const r=await aFetch('/api/admin/settings');if(!r.ok)return;
  document.getElementById('promo_text').value=r.settings.promo_text||'';
  document.getElementById('cs_link').value=r.settings.cs_link||'';
  document.getElementById('ch_link').value=r.settings.ch_link||'';
  uploadState.currentImageUrl=r.settings.promo_image||'';
  uploadState.pendingFile=null;
  uploadState.removeImage=false;
  renderDropZone();
}
function renderDropZone(){
  const dropZone=document.getElementById('dropZone');
  const dzInner=document.getElementById('dzInner');
  const imgUrlHint=document.getElementById('imgUrlHint');
  const imgUrlText=document.getElementById('imgUrlText');
  if(!dropZone||!dzInner)return;
  const {pendingFile,currentImageUrl,removeImage}=uploadState;
  if(pendingFile){
    const url=URL.createObjectURL(pendingFile);
    dropZone.classList.add('has-image');
    dzInner.innerHTML=`<div class="dz-preview"><img src="${url}" alt="preview"/><div class="dz-actions"><button type="button" class="change" data-act="change">Ganti</button><button type="button" class="remove" data-act="remove">Hapus</button></div></div>`;
    imgUrlHint.style.display='none';
    bindPreviewActions();
  }else if(currentImageUrl&&!removeImage){
    dropZone.classList.add('has-image');
    dzInner.innerHTML=`<div class="dz-preview"><img src="${currentImageUrl}" alt="promo"/><div class="dz-actions"><button type="button" class="change" data-act="change">Ganti</button><button type="button" class="remove" data-act="remove">Hapus</button></div></div>`;
    imgUrlText.textContent=location.origin+currentImageUrl;
    imgUrlHint.style.display='flex';
    bindPreviewActions();
  }else{
    dropZone.classList.remove('has-image');
    dzInner.innerHTML=`<div class="dz-icon"><svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></div><div class="dz-title">Klik atau drop gambar di sini</div><div class="dz-hint">JPG, PNG, WEBP, atau GIF • Maks 5 MB</div>`;
    imgUrlHint.style.display='none';
  }
}
function bindPreviewActions(){
  const dzInner=document.getElementById('dzInner');
  const fileInput=document.getElementById('promo_image');
  dzInner.querySelectorAll('[data-act]').forEach(btn=>{
    btn.onclick=(e)=>{
      e.stopPropagation();
      const act=btn.dataset.act;
      if(act==='change')fileInput.click();
      if(act==='remove'){uploadState.pendingFile=null;uploadState.removeImage=true;uploadState.currentImageUrl='';renderDropZone();}
    };
  });
}
function bindDropZoneEvents(dropZone,fileInput){
  dropZone.onclick=(e)=>{if(e.target.closest('button'))return;fileInput.click();};
  ['dragenter','dragover'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.add('dragover');}));
  ['dragleave','drop'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.remove('dragover');}));
  dropZone.addEventListener('drop',e=>{const f=e.dataTransfer.files?.[0];if(f)handleFile(f);});
  fileInput.onchange=()=>{const f=fileInput.files?.[0];if(f)handleFile(f);};
}
function handleFile(file){
  if(!/^image\/(jpeg|png|jpg|webp|gif)$/i.test(file.type))return alert('Format harus JPG / PNG / WEBP / GIF');
  if(file.size>5*1024*1024)return alert('Ukuran maksimal 5 MB');
  uploadState.pendingFile=file;
  uploadState.removeImage=false;
  renderDropZone();
}
async function saveAdminSettings(){
  const btn=document.getElementById('btnSave');
  const original=btn.textContent;
  btn.disabled=true;btn.textContent='Menyimpan…';
  try{
    if(uploadState.removeImage&&!uploadState.pendingFile){
      await fetch('/api/admin/settings/promo_image',{method:'DELETE',credentials:'same-origin'});
    }
    const fd=new FormData();
    fd.append('promo_text',document.getElementById('promo_text').value);
    fd.append('cs_link',document.getElementById('cs_link').value.trim());
    fd.append('ch_link',document.getElementById('ch_link').value.trim());
    if(uploadState.pendingFile)fd.append('promo_image',uploadState.pendingFile);
    const r=await aFetch('/api/admin/settings',{method:'POST',body:fd});
    if(r.ok){alert('✓ Tersimpan');await loadAdminSettings();}
    else alert(r.msg||'Gagal menyimpan');
  }finally{btn.disabled=false;btn.textContent=original;}
}
document.addEventListener('DOMContentLoaded',()=>{
  const path=location.pathname;
  if(path==='/admin/dashboard')loadAdminStats();
  if(path==='/admin/perangkat')loadAdminDevices();
  if(path==='/admin/wd')loadAdminWD();
  if(path==='/admin/setting')initAdminSetting();
});
window.Admin={aFetch,adminLogout,loadAdminStats,loadAdminDevices,loadAdminWD,setWDStatus,initAdminSetting,loadAdminSettings,saveAdminSettings};
window.adminLogout=adminLogout;
window.setWDStatus=setWDStatus;
