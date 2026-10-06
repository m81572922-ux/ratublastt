const $=(q,root=document)=>root.querySelector(q);
const $$=(q,root=document)=>[...root.querySelectorAll(q)];
async function api(url,body,method='POST'){
  try{
    const res=await fetch(url,{method:body?method:'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
    if(res.status===401){if(!location.pathname.startsWith('/admin'))location.href='/';return {ok:false,msg:'Sesi habis'};}
    return await res.json();
  }catch(e){return {ok:false,msg:'Koneksi gagal: '+e.message};}
}
let toastTimer=null;
function toast(msg){let t=$('.toast');if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t);}t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2400);}
async function bootstrap(){const me=await api('/api/me');if(!me.ok)return;const u=me.user;$$('[data-uname]').forEach(el=>el.textContent=u.username);$$('[data-saldo]').forEach(el=>el.textContent='Rp '+Number(u.saldo).toLocaleString('id-ID'));$$('[data-quota]').forEach(el=>el.textContent=u.quota);await loadPublicSettings();attachSpinner();return u;}
async function loadPublicSettings(){const r=await api('/api/settings/public');if(r.ok)window.RB_SETTINGS=r.settings;}
function attachSpinner(){const sp=$('.spinner');if(!sp||sp.dataset.bound)return;sp.dataset.bound='1';sp.addEventListener('click',openSpinnerModal);}
function openSpinnerModal(){const s=window.RB_SETTINGS||{cs_link:'https://t.me/Vnmblck12',ch_link:'https://t.me/Ratublastt'};$$('.modal-back.spinner-modal').forEach(m=>m.remove());const m=document.createElement('div');m.className='modal-back spinner-modal open';m.innerHTML=`<div class="modal"><button class="close" data-close>✕</button><h2>📡 PUSAT BANTUAN</h2><p class="sub">Pilih bantuan yang kamu butuhkan</p><a href="${s.cs_link||'#'}" target="_blank" class="btn green" style="text-decoration:none;margin-bottom:10px;">💬 Hubungi CS</a><a href="${s.ch_link||'#'}" target="_blank" class="btn" style="text-decoration:none;">📢 Join Channel</a></div>`;document.body.appendChild(m);m.addEventListener('click',e=>{if(e.target===m||e.target.hasAttribute('data-close'))m.remove();});}
function modalWrap(title,subtitle,innerHTML){const m=document.createElement('div');m.className='modal-back open';m.innerHTML=`<div class="modal"><button class="close" data-close>✕</button><h2>${title}</h2><p class="sub">${subtitle}</p><div data-body>${innerHTML}</div></div>`;document.body.appendChild(m);m.addEventListener('click',e=>{if(e.target===m||e.target.hasAttribute('data-close'))m.remove();});return m;}
window.RB={$,$$,api,toast,loadPublicSettings,attachSpinner,openSpinnerModal,modalWrap};
if(document.body&&document.body.dataset.auth==='1'){if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',bootstrap);}else{bootstrap();}}
