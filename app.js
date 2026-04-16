// ============================================================================
// app.js - Cloud-native. localStorage is used ONLY for auth tokens.
// All content (tasks, boards, notes) lives exclusively in Supabase.
// ===========================================================================
const DAYS=['\u041f\u043e\u043d\u0435\u0434\u0435\u043b\u044c\u043d\u0438\u043a','\u0412\u0442\u043e\u0440\u043d\u0438\u043a','\u0421\u0440\u0435\u0434\u0430','\u0427\u0435\u0442\u0432\u0435\u0440\u0433','\u041f\u044f\u0442\u043d\u0438\u0446\u0430','\u0421\u0443\u0431\u0431\u043e\u0442\u0430','\u0412\u043e\u0441\u043a\u0440\u0435\u0441\u0435\u043d\u044c\u0435'];
const AUTH_KEYS=['tg_user_id','tg_id'];
const INBOX_COL='228d2d4f-415d-4fbc-b8a2-d1a201938bd9';
const SB_URL=window.CALENDAR_CONFIG?.SUPABASE_URL||window.SUPABASE_URL;
const SB_KEY=window.CALENDAR_CONFIG?.SUPABASE_ANON_KEY||window.SUPABASE_ANON_KEY;
const RESET_URL='https://mexvcooxruzxrntvhzmc.supabase.co/functions/v1/request-password-reset';
const LONG_MS=360,LONG_PX=14;

// AUTH
const tgApp=window.Telegram?.WebApp;
const tgUser=tgApp?.initDataUnsafe?.user;
function getStoredId(){for(const k of AUTH_KEYS){const v=localStorage.getItem(k);if(v)return v;}return null;}
function isAuth(){return Boolean(currentUserId||tgUser?.id||getStoredId());}
let currentUserId=tgUser?.id?String(tgUser.id):getStoredId();
let authRes=null;
async function checkAuth(){if(currentUserId)return currentUserId;return showLoginModal();}

function showLoginModal(){
  if(authRes?.promise)return authRes.promise;
  const overlay=document.getElementById('login-overlay');
  authRes={};authRes.promise=new Promise(r=>{authRes.resolve=r;});
  const form=document.getElementById('loginForm'),errEl=document.getElementById('loginError');
  const btn=form.querySelector('button[type="submit"]');
  form.reset();errEl.textContent='';errEl.classList.add('hidden');
  overlay.classList.add('show');document.getElementById('telegramIdInput').focus();
  const showErr=m=>{errEl.textContent=m;errEl.classList.remove('hidden');};
  form.onsubmit=async e=>{
    e.preventDefault();
    const tid=document.getElementById('telegramIdInput').value.trim();
    const pw=document.getElementById('passwordInput').value.trim();
    if(!tid||!pw){showErr('\u0417\u0430\u043f\u043e\u043b\u043d\u0438\u0442\u0435 \u0432\u0441\u0435 \u043f\u043e\u043b\u044f');return;}
    btn.disabled=true;btn.textContent='\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430...';
    try{
      const sb=getSB();
      if(!sb){showErr('Supabase error');btn.disabled=false;btn.textContent='\u0412\u043e\u0439\u0442\u0438';return;}
      const{data,error}=await sb.from('users_auth').select('telegram_id').eq('telegram_id',tid).eq('password_hash',pw).single();
      if(error||!data){showErr('\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 ID \u0438\u043b\u0438 \u043f\u0430\u0440\u043e\u043b\u044c');btn.disabled=false;btn.textContent='\u0412\u043e\u0439\u0442\u0438';return;}
      AUTH_KEYS.forEach(k=>localStorage.setItem(k,tid));
      localStorage.setItem('is_auth','true');currentUserId=tid;
      overlay.classList.remove('show');btn.textContent='\u0412\u043e\u0439\u0442\u0438';btn.disabled=false;
      if(authRes?.resolve)authRes.resolve(tid);authRes=null;
    }catch(err){console.error(err);showErr('\u041e\u0448\u0438\u0431\u043a\u0430 \u0432\u0445\u043e\u0434\u0430');btn.disabled=false;btn.textContent='\u0412\u043e\u0439\u0442\u0438';}
  };
  setupResetUI();
  return authRes.promise;
}

async function requestPwReset(tgId,newPw,btn){
  return new Promise(async(resolve,reject)=>{
    if(!tgId){reject(new Error('tgId?'));return;}
    if(!newPw){reject(new Error('pw?'));return;}
    try{
      const r=await fetch(RESET_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegram_id:tgId,new_password:newPw})});
      const d=await r.json();
      if(!r.ok){reject(new Error(r.status===404?'ID \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d':(d?.message||'\u041e\u0448\u0438\u0431\u043a\u0430')));return;}
      if(btn){btn.disabled=true;btn.textContent='\u041e\u0436\u0438\u0434\u0430\u043d\u0438\u0435 TG...';}
      let iv,to;
      const done=()=>{clearInterval(iv);clearTimeout(to);};
      const or=resolve,oj=reject;
      resolve=v=>{done();or(v);};reject=e=>{done();oj(e);};
      iv=setInterval(async()=>{
        try{
          const cr=await fetch(RESET_URL+'?check=true&tgId='+encodeURIComponent(tgId));
          const cd=await cr.json();
          if(cd?.status==='approved')resolve({success:true,message:'\u041f\u0430\u0440\u043e\u043b\u044c \u0438\u0437\u043c\u0435\u043d\u0451\u043d!'});
          else if(cd?.status==='denied')reject(new Error('\u041e\u0442\u043a\u0430\u0437\u0430\u043d\u043e'));
        }catch{}
      },3000);
      to=setTimeout(()=>reject(new Error('\u0422\u0430\u0439\u043c\u0430\u0443\u0442')),120000);
    }catch(e){reject(new Error(e.message||'\u041e\u0448\u0438\u0431\u043a\u0430'));}
  });
}

function setupResetUI(){
  const toBtn=document.getElementById('toPasswordResetBtn'),backBtn=document.getElementById('backToLoginBtn');
  const ls=document.getElementById('loginSection'),rs=document.getElementById('passwordResetSection');
  const rtg=document.getElementById('resetTelegramIdInput'),rnp=document.getElementById('resetNewPasswordInput');
  const tgi=document.getElementById('telegramIdInput'),rf=document.getElementById('passwordResetForm');
  const rb=document.getElementById('resetSubmitBtn'),re=document.getElementById('resetError'),rok=document.getElementById('resetSuccess');
  toBtn.addEventListener('click',e=>{e.preventDefault();ls.classList.add('hidden');rs.classList.remove('hidden');if(tgi.value)rtg.value=tgi.value;rtg.focus();});
  backBtn.addEventListener('click',e=>{e.preventDefault();rs.classList.add('hidden');ls.classList.remove('hidden');re.classList.add('hidden');rok.classList.add('hidden');rb.disabled=false;rb.textContent='\u0421\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c';if(rnp)rnp.value='';tgi.focus();});
  rf.addEventListener('submit',async e=>{
    e.preventDefault();
    const tid=rtg.value.trim(),np=rnp?rnp.value.trim():'';
    if(!tid){re.textContent='Telegram ID?';re.classList.remove('hidden');return;}
    if(!np||np.length<4){re.textContent='\u041c\u0438\u043d 4 \u0441\u0438\u043c\u0432\u043e\u043b\u0430';re.classList.remove('hidden');return;}
    re.classList.add('hidden');rok.classList.add('hidden');
    try{
      const res=await requestPwReset(tid,np,rb);
      if(res.success){rok.textContent=res.message;rok.classList.remove('hidden');setTimeout(()=>document.getElementById('login-overlay').classList.remove('show'),3000);}
    }catch(err){re.textContent=err.message;re.classList.remove('hidden');}
    rb.disabled=false;rb.textContent='\u0421\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c';if(rnp)rnp.value='';
  });
}

// SUPABASE CLIENT
function getSB(){
  if(!window.supabase||!SB_URL||!SB_KEY)return null;
  return window.supabase.createClient(SB_URL,SB_KEY,{
    global:{headers:{'x-user-id':String(currentUserId||''),'x-tg-id':String(currentUserId||'')}}
  });
}
const uid=()=>String(currentUserId||'');
async function sbq(fn){
  const sb=getSB();if(!sb)return{data:null,error:new Error('no sb')};
  try{return await fn(sb);}catch(e){return{data:null,error:e};}
}

// STATE - in-memory only. localStorage stores ONLY theme.
function mkSpace(){
  return{
    days:Object.fromEntries(DAYS.map(d=>[d,[]])),
    dayBackgrounds:Object.fromEntries(DAYS.map(d=>[d,null])),
    dayNotes:Object.fromEntries(DAYS.map(d=>[d,''])),
    boards:{},dockTasks:[],taskGroups:[],sideNotes:[]
  };
}
const mkState=()=>({
  theme:localStorage.getItem('app_theme')||'light',
  activeSpaceId:null,
  nextTaskId:Date.now(),nextCloudId:Date.now()+1,
  nextGroupId:1,nextTaskGroupId:1,nextSideNoteId:1,
  sideNotes:[],spaceNames:{},spaces:{}
});
let state=mkState(),avSpaces=[];
let hist=[{desc:'Start',snap:structuredClone(state),ts:new Date().toISOString()}];
let hIdx=0,prevIdx=null,curBoard=null;
let dragTask=null,dragCloud=null,dragCloudNote=null,dragBgTask=null,dragNote=null;
let selClouds=new Set(),selTasks=new Set();
let histOpen=false,instrOpen=false,spaceMenuOpen=false;
let spaceActOpen=false,spaceActKey=null,selSpaces=new Set();
let taskCtxOpen=false,dockOpen=false,notesOpen=false,taskCtx=null;

function persist(){localStorage.setItem('app_theme',state.theme);}
function eff(){return prevIdx===null?state:hist[prevIdx].snap;}
function getSpace(st=eff()){const k=(st.activeSpaceId in st.spaces)?st.activeSpaceId:Object.keys(st.spaces||{})[0]||null;return(k&&st.spaces[k])||mkSpace();}
function sideNotes(st=eff()){if(!Array.isArray(st.sideNotes))st.sideNotes=[];return st.sideNotes;}
function spaceLabel(k,st=eff()){return avSpaces.find(s=>s.key===k)?.name||st.spaceNames?.[k]||k;}
function taskById(id,s=state){const sp=getSpace(s);for(const d of DAYS){const t=sp.days[d].find(x=>x.id===id);if(t)return{task:t,day:d};}const dt=sp.dockTasks.find(x=>x.id===id);if(dt)return{task:dt,day:null};return null;}
function selKey(day,id){return day+'|'+id;}
function parseSelKey(k){const[day,r]=k.split('|');return{day,taskId:Number(r)};}
function selRefs(){return[...selTasks].map(parseSelKey).filter(i=>i.day&&Number.isFinite(i.taskId));}
function ctxSel(){const p=selRefs();if(p.length)return p;if(!taskCtx)return[];return[{day:taskCtx.day,taskId:taskCtx.taskId}];}
function clrSel(){selTasks=new Set();}
function clrSpSel(){selSpaces=new Set();}
function spActSel(){if(selSpaces.size>0)return[...selSpaces].filter(k=>k in state.spaces);return spaceActKey&&(spaceActKey in state.spaces)?[spaceActKey]:[];}
function ensureBoard(st,id){const sp=getSpace(st);if(!sp.boards[id])sp.boards[id]={zoom:1,clouds:[]};return sp.boards[id];}

// LOAD SPACE FROM CLOUD
async function loadSpace(sid){
  if(!sid||!currentUserId)return;
  const u=uid();
  const[calR,dockR,dayR,grpR,bnR,dbnR]=await Promise.all([
    sbq(sb=>sb.from('calendar_tasks').select('*').eq('space_id',sid).eq('user_id',u).order('position')),
    sbq(sb=>sb.from('dock_tasks').select('*').eq('space_id',sid).eq('user_id',u).order('position')),
    sbq(sb=>sb.from('day_settings').select('*').eq('space_id',sid).eq('user_id',u)),
    sbq(sb=>sb.from('task_groups').select('*').eq('space_id',sid).eq('user_id',u)),
    sbq(sb=>sb.from('board_notes').select('*').eq('user_id',u)),
    sbq(sb=>sb.from('dock_board_notes').select('*').eq('user_id',u)),
  ]);
  const sp=mkSpace();
  (calR.data||[]).forEach(row=>{
    if(!DAYS.includes(row.day))return;
    sp.days[row.day].push({id:row.id,_db:row.id,title:row.title,color:row.color,pinned:row.pinned,createdAt:new Date(row.created_at).getTime(),taskGroupId:row.task_group_id_local});
    const ns=(bnR.data||[]).filter(n=>n.calendar_task_id===row.id);
    sp.boards[row.id]={zoom:row.board_zoom||1,clouds:ns.map(n=>({id:n.id,_db:n.id,text:n.text,x:n.pos_x,y:n.pos_y,groupId:n.group_id}))};
  });
  (dockR.data||[]).forEach(row=>{
    sp.dockTasks.push({id:row.id,_db:row.id,title:row.title,tags:row.tags||[],pinned:row.pinned,createdAt:new Date(row.created_at).getTime()});
    const ns=(dbnR.data||[]).filter(n=>n.dock_task_id===row.id);
    sp.boards[row.id]={zoom:row.board_zoom||1,clouds:ns.map(n=>({id:n.id,_db:n.id,text:n.text,x:n.pos_x,y:n.pos_y,groupId:n.group_id}))};
  });
  (dayR.data||[]).forEach(row=>{if(DAYS.includes(row.day)){sp.dayBackgrounds[row.day]=row.background_title||null;sp.dayNotes[row.day]=row.notes_text||'';} });
  sp.taskGroups=(grpR.data||[]).map(g=>({id:g.id,_db:g.id,name:g.name,color:g.color,taskIds:(calR.data||[]).filter(t=>t.task_group_id===g.id).map(t=>t.id)}));
  state.spaces[sid]=sp;
}

let _rfPending=false;
async function refreshSpace(sid){
  const s=sid||state.activeSpaceId;if(!s)return;
  if(_rfPending)return;_rfPending=true;
  setTimeout(()=>{_rfPending=false;},800);
  try{await loadSpace(s);}catch(e){console.warn('[rf]',e);}
  renderAll();
}

// COMMIT
function commit(desc,mutator,cloud){
  const prev=state.activeSpaceId;mutator(state);persist();
  if(prev!==state.activeSpaceId){void savePref(state.activeSpaceId);void fetchTasks();}
  if(prevIdx!==null)prevIdx=null;
  hist=hist.slice(0,hIdx+1);
  hist.push({desc,snap:structuredClone(state),ts:new Date().toISOString()});
  hIdx=hist.length-1;renderAll();
  if(cloud)cloud().catch(e=>console.warn('[cloud]',desc,e));
}

// CLOUD OPS - calendar_tasks
async function ciCal(sid,day,task,pos){
  const{data,error}=await sbq(sb=>sb.from('calendar_tasks').insert({user_id:uid(),space_id:sid,day,title:task.title,color:task.color||null,pinned:task.pinned||false,position:pos??0,task_group_id_local:task.taskGroupId||null}).select('id').single());
  if(!error&&data?.id){const sp=state.spaces[sid];if(sp){const t=sp.days[day]?.find(x=>x.id===task.id);if(t){t._db=data.id;t.id=data.id;}}}
  if(error)console.error('[c+cal]',error);
}
async function cuCal(id,u2){const{error}=await sbq(sb=>sb.from('calendar_tasks').update({...u2,updated_at:new Date().toISOString()}).eq('id',id));if(error)console.error('[u cal]',error);}
async function cdCal(id){const{error}=await sbq(sb=>sb.from('calendar_tasks').delete().eq('id',id));if(error)console.error('[d cal]',error);}
async function upsDay(sid,day,bg,notes){const{error}=await sbq(sb=>sb.from('day_settings').upsert({user_id:uid(),space_id:sid,day,background_title:bg||null,notes_text:notes||''},{onConflict:'space_id,day'}));if(error)console.error('[day]',error);}

// CLOUD OPS - dock_tasks
async function ciDock(sid,task,pos){
  const{data,error}=await sbq(sb=>sb.from('dock_tasks').insert({user_id:uid(),space_id:sid,title:task.title,tags:task.tags||[],pinned:task.pinned||false,position:pos??0}).select('id').single());
  if(!error&&data?.id){const sp=state.spaces[sid];if(sp){const t=sp.dockTasks.find(x=>x.id===task.id);if(t){t._db=data.id;t.id=data.id;}}}
  if(error)console.error('[c+dock]',error);
}
async function cuDock(id,u2){const{error}=await sbq(sb=>sb.from('dock_tasks').update({...u2,updated_at:new Date().toISOString()}).eq('id',id));if(error)console.error('[u dock]',error);}
async function cdDock(id){const{error}=await sbq(sb=>sb.from('dock_tasks').delete().eq('id',id));if(error)console.error('[d dock]',error);}

// CLOUD OPS - board_notes
async function ciBN(calId,cloud){
  const{data,error}=await sbq(sb=>sb.from('board_notes').insert({user_id:uid(),calendar_task_id:calId,text:cloud.text||'',pos_x:cloud.x,pos_y:cloud.y,group_id:cloud.groupId||null}).select('id').single());
  if(!error&&data?.id){for(const sp of Object.values(state.spaces)){const b=sp.boards[calId];if(b){const c=b.clouds.find(x=>x.id===cloud.id);if(c){c._db=data.id;c.id=data.id;}}}}
  if(error)console.error('[c+bn]',error);
}
async function cuBN(id,u2){const{error}=await sbq(sb=>sb.from('board_notes').update({...u2,updated_at:new Date().toISOString()}).eq('id',id));if(error)console.error('[u bn]',error);}
async function cdBN(id){const{error}=await sbq(sb=>sb.from('board_notes').delete().eq('id',id));if(error)console.error('[d bn]',error);}
async function ciDBN(dockId,cloud){
  const{data,error}=await sbq(sb=>sb.from('dock_board_notes').insert({user_id:uid(),dock_task_id:dockId,text:cloud.text||'',pos_x:cloud.x,pos_y:cloud.y,group_id:cloud.groupId||null}).select('id').single());
  if(!error&&data?.id){for(const sp of Object.values(state.spaces)){const b=sp.boards[dockId];if(b){const c=b.clouds.find(x=>x.id===cloud.id);if(c){c._db=data.id;c.id=data.id;}}}}
  if(error)console.error('[c+dbn]',error);
}

// REALTIME
let rtChs=[];
function unsubAll(){const sb=getSB();if(sb)rtChs.forEach(ch=>sb.removeChannel(ch));rtChs=[];}
function subSpace(sid){
  unsubAll();const sb=getSB();if(!sb||!sid){console.warn('[rt] no sb/sid');return;}
  const onChange=()=>refreshSpace(sid);
  ['calendar_tasks','dock_tasks','day_settings','task_groups'].forEach(tbl=>{
    const ch=sb.channel(tbl+'-'+sid).on('postgres_changes',{event:'*',schema:'public',table:tbl,filter:'space_id=eq.'+sid},onChange).subscribe();
    rtChs.push(ch);
  });
  const u=uid();
  ['board_notes','dock_board_notes'].forEach(tbl=>{
    const ch=sb.channel(tbl+'-'+u).on('postgres_changes',{event:'*',schema:'public',table:tbl,filter:'user_id=eq.'+u},onChange).subscribe();
    rtChs.push(ch);
  });
  const tch=sb.channel('tasks-'+u).on('postgres_changes',{event:'*',schema:'public',table:'tasks',filter:'user_id=eq.'+u},()=>fetchTasks()).subscribe();
  rtChs.push(tch);
}

// SPACES
function normSp(r){if(!r?.id)return null;return{key:String(r.id),name:r.name||String(r.id)};}
function fromState(st=state){return Object.keys(st.spaces||{}).map(k=>({key:k,name:st.spaceNames?.[k]||k}));}
function syncSpaces(spaces,st=state){
  const next=Array.isArray(spaces)?spaces.filter(s=>s?.key):fromState(st);
  const keys=new Set(next.map(({key})=>key));if(!st.spaceNames)st.spaceNames={};
  Object.keys(st.spaces||{}).forEach(k=>{if(!keys.has(k))delete st.spaces[k];});
  Object.keys(st.spaceNames).forEach(k=>{if(!keys.has(k))delete st.spaceNames[k];});
  next.forEach(({key,name})=>{if(!st.spaces[key])st.spaces[key]=mkSpace();st.spaceNames[key]=name||key;});
  if(!(st.activeSpaceId in st.spaces))st.activeSpaceId=next[0]?.key||null;
  return next;
}
function toUUID(k){const r=typeof k==='string'?k.trim():'';return/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r)?r:crypto.randomUUID();}
async function loadSpaces(){
  if(!currentUserId){console.warn('[sp] no uid');return[];}
  const{data,error}=await sbq(sb=>sb.from('user_spaces').select('*').eq('user_id',uid()));
  if(error){console.warn('[sp]',error);AUTH_KEYS.forEach(k=>localStorage.removeItem(k));localStorage.removeItem('is_auth');currentUserId=null;state=mkState();avSpaces=[];syncLogout();await showLoginModal();return[];}
  return(data||[]).map(normSp).filter(Boolean);
}
async function addSpace(key,name){
  if(!isAuth())return null;
  const id=toUUID(key);
  const{error}=await sbq(sb=>sb.from('user_spaces').insert({id,user_id:uid(),name:String(name||key)}));
  if(error){console.warn('[sp+]',error);alert('Error: '+error.message);return null;}
  return id;
}
async function delSpaces(keys=[]){
  const ks=keys.filter(Boolean);if(!ks.length||!currentUserId)return true;
  const{error}=await sbq(sb=>sb.from('user_spaces').delete().eq('user_id',uid()).in('id',ks.map(String)));
  if(error){console.warn('[sp-]',error);return false;}return true;
}
async function loadPref(){
  const{data,error}=await sbq(sb=>sb.from('user_settings').select('current_space_id').eq('tg_id',uid()).maybeSingle());
  if(error)return null;const v=data?.current_space_id;return typeof v==='string'&&v.trim()?v.trim():null;
}
async function savePref(sid){
  if(!currentUserId||!sid)return;
  await sbq(sb=>sb.from('user_settings').upsert({tg_id:uid(),current_space_id:String(sid)},{onConflict:'tg_id'}));
}

// TELEGRAM TASKS
function stripMark(t=''){return t.replace(/^\[(?:NOTES|DAY|BOARD)\]\s*/i,'').trim();}
function detectTarget(t=''){if(/^\[DAY\]/i.test(t))return'day';if(/^\[BOARD\]/i.test(t))return'board';return'notes';}
function withMark(t='',target='notes'){return(target==='day'?'[DAY]':target==='board'?'[BOARD]':'[NOTES]')+' '+stripMark(t);}
function esc(v=''){return v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
async function updTg(id,u){return sbq(sb=>sb.from('tasks').update(u).eq('id',id));}
async function delTg(id){return sbq(sb=>sb.from('tasks').delete().eq('id',id));}

async function fetchTasks(){
  const list=document.getElementById('telegramTasksList');if(!list)return;
  if(!currentUserId||!isAuth()){list.innerHTML='<li>\u0412\u043e\u0439\u0434\u0438\u0442\u0435 \u0434\u043b\u044f \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440\u0430.</li>';return;}
  list.innerHTML='<li>\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...</li>';
  const{data,error}=await sbq(sb=>sb.from('tasks').select('*').eq('column_id',INBOX_COL).eq('user_id',Number(currentUserId)).order('created_at',{ascending:false}));
  if(error){list.innerHTML='<li>Error: '+error.message+'</li>';return;}
  if(!data?.length){list.innerHTML='<li>\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0437\u0430\u043c\u0435\u0442\u043e\u043a.</li>';return;}
  list.innerHTML='';
  data.forEach(task=>{
    const li=document.createElement('li');li.className='telegram-task-item';li.dataset.taskId=String(task.id);
    const txt=stripMark(task.text||''),tgt=detectTarget(task.text||'');
    const tgtLbl=tgt==='day'?'\u0434\u0435\u043d\u044c':tgt==='board'?'\u0434\u043e\u0441\u043a\u0430':'\u0437\u0430\u043c\u0435\u0442\u043a\u0438';
    li.innerHTML='<div class="telegram-task-row"><span class="telegram-task-title">'+(task.is_completed?'\u2705':'\u2b1c\ufe0f')+' '+esc(txt)+'</span><small class="telegram-task-target">'+tgtLbl+'</small></div><div class="telegram-task-actions"><button type="button" data-action="edit" class="telegram-task-edit">&#9999;&#65039;</button><button type="button" data-action="to-day">\u0412 \u0434\u0435\u043d\u044c</button><button type="button" data-action="delete">\u0423\u0434\u0430\u043b\u0438\u0442\u044c</button></div><div class="telegram-transfer-menu hidden" data-menu="day"></div>';
    const dm=li.querySelector('[data-menu="day"]');dm.innerHTML=DAYS.map(d=>'<button type="button" data-day="'+d+'">'+d+'</button>').join('');
    const closeM=()=>dm.classList.add('hidden');
    li.addEventListener('click',async ev=>{
      const action=ev.target?.dataset?.action,day=ev.target?.dataset?.day;
      if(action==='edit'){
        const span=li.querySelector('.telegram-task-title');
        const inp=document.createElement('input');inp.type='text';inp.className='telegram-task-input';inp.value=txt;span.replaceWith(inp);inp.focus();inp.select();
        let saved=false;
        const save=async()=>{if(saved)return;saved=true;const nt=inp.value.trim();if(!nt){inp.replaceWith(span);return;}const{error}=await updTg(task.id,{text:withMark(nt,tgt)});if(error){alert('Error: '+error.message);inp.replaceWith(span);return;}await fetchTasks();};
        inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save();}else if(e.key==='Escape'){saved=true;inp.replaceWith(span);}});
        inp.addEventListener('blur',()=>save());return;
      }
      if(action==='delete'){if(!confirm('\u0423\u0434\u0430\u043b\u0438\u0442\u044c?'))return;await delTg(task.id);await fetchTasks();return;}
      if(action==='to-day'){const o=dm.classList.contains('hidden');closeM();if(o)dm.classList.remove('hidden');return;}
      if(day){
        closeM();const sid=state.activeSpaceId;
        const nt={id:Date.now(),title:txt,color:null,pinned:false,createdAt:Date.now(),taskGroupId:null};
        commit('TG->'+day,st=>{getSpace(st).days[day].push(nt);},()=>ciCal(sid,day,nt,getSpace(state).days[day].length-1));
        await updTg(task.id,{text:withMark(txt,'day')});await fetchTasks();
      }
    });list.append(li);
  });
}

// UI HELPERS
function applyTheme(t){document.documentElement.dataset.theme=t;const el=document.getElementById('themeToggle');if(el)el.textContent=t==='dark'?'\u0421\u0432\u0435\u0442\u043b\u0430\u044f \u0442\u0435\u043c\u0430':'\u0422\u0451\u043c\u043d\u0430\u044f \u0442\u0435\u043c\u0430';}
function setHist(o){histOpen=o;const p=document.getElementById('historyPanel'),t=document.getElementById('toggleHistory');p.classList.toggle('open',o);t.setAttribute('aria-expanded',String(o));t.textContent=o?'\u0421\u043a\u0440\u044b\u0442\u044c \u0438\u0441\u0442\u043e\u0440\u0438\u044e':'\u0418\u0441\u0442\u043e\u0440\u0438\u044f';}
function setInstr(o){instrOpen=o;const p=document.getElementById('instructionsPanel'),t=document.getElementById('toggleInstructions');if(!p||!t)return;p.classList.toggle('open',o);p.setAttribute('aria-hidden',String(!o));t.setAttribute('aria-expanded',String(o));t.textContent=o?'\u0421\u043a\u0440\u044b\u0442\u044c':'\u0418\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0438\u044f';}
function setDock(o){dockOpen=o;const d=document.getElementById('taskDock'),t=document.getElementById('toggleDockMenu');if(d)d.classList.toggle('hidden',!o);if(t)t.setAttribute('aria-expanded',String(o));}
function setNotes(o){notesOpen=o;const p=document.getElementById('notesPanel'),t=document.getElementById('toggleNotesPanel');if(!p||!t)return;p.classList.toggle('open',o);t.setAttribute('aria-expanded',String(o));}
function setSpMenu(o){spaceMenuOpen=o;const m=document.getElementById('spaceMenu'),t=document.getElementById('spaceMenuToggle');m.classList.toggle('hidden',!o);t.setAttribute('aria-expanded',String(o));}
function syncLogout(){const b=document.getElementById('logout-btn');if(b)b.classList.toggle('hidden',!isAuth());}
function doLogout(){if(!confirm('\u0412\u044b\u0439\u0442\u0438?'))return;AUTH_KEYS.forEach(k=>localStorage.removeItem(k));localStorage.removeItem('is_auth');unsubAll();location.reload();}
function updSpBtn(k,st=eff()){const l=spaceLabel(k,st);document.getElementById('spaceMenuToggle').textContent='\u041f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u0441\u0442\u0432\u043e: '+l;const c=document.getElementById('spaceMenuCurrentLabel');if(c)c.textContent=l;document.title=l?l+' \u2014 \u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c':'\u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c';}
function renderSpOpts(st=eff()){const list=document.querySelector('#spaceMenu .space-list');if(!list)return;list.innerHTML='';const items=avSpaces.length>0?avSpaces:fromState(st);items.forEach(({key,name})=>{const b=document.createElement('button');b.type='button';b.className='space-option';b.dataset.space=key;b.setAttribute('role','menuitem');b.textContent=name||spaceLabel(key,st);if(selSpaces.has(key))b.classList.add('selected');list.append(b);});}
function setSpActMenu(o,x=0,y=0){spaceActOpen=o;const m=document.getElementById('spaceActionMenu');if(!m)return;if(!o){m.classList.add('hidden');m.setAttribute('aria-hidden','true');spaceActKey=null;return;}const mx=window.innerWidth-m.offsetWidth-10,my=window.innerHeight-m.offsetHeight-10;m.style.left=Math.max(10,Math.min(x,mx))+'px';m.style.top=Math.max(10,Math.min(y,my))+'px';m.classList.remove('hidden');m.setAttribute('aria-hidden','false');}
function setTaskCtx(o,x=0,y=0){taskCtxOpen=o;const m=document.getElementById('taskContextMenu');if(!m)return;if(!o){m.classList.add('hidden');m.setAttribute('aria-hidden','true');taskCtx=null;return;}const mx=window.innerWidth-m.offsetWidth-10,my=window.innerHeight-m.offsetHeight-10;m.style.left=Math.max(10,Math.min(x,mx))+'px';m.style.top=Math.max(10,Math.min(y,my))+'px';m.classList.remove('hidden');m.setAttribute('aria-hidden','false');}
function openCtx(x,y,day,task){const k=selKey(day,task.id);if(!selTasks.has(k))selTasks=new Set([k]);taskCtx={day,taskId:task.id};const pin=document.getElementById('ctxPin'),col=document.getElementById('ctxColor'),grp=document.getElementById('ctxCreateGroup');if(pin)pin.textContent=task.pinned?'\u041e\u0442\u043a\u0440\u0435\u043f\u0438\u0442\u044c':'\u0417\u0430\u043a\u0440\u0435\u043f\u0438\u0442\u044c';if(col)col.value=task.color||'#5a6cff';if(grp)grp.classList.toggle('hidden',ctxSel().length<2);setTaskCtx(true,x,y);renderCal();}

// DRAG HELPERS
function moveTask(st,fd,td,id,targetId=null,after=false){const sp=getSpace(st),src=sp.days[fd],dst=sp.days[td];const fi=src.findIndex(t=>t.id===id);if(fi<0)return;const[task]=src.splice(fi,1);if(targetId===null){dst.push(task);return;}const ti=dst.findIndex(t=>t.id===targetId);if(ti<0){dst.push(task);return;}dst.splice(after?ti+1:ti,0,task);}
function cloudTitle(t){return(t||'').split('\n').map(l=>l.trim()).find(Boolean)||'Task';}
function moveCloud2Day(st,btid,cid,today,targetId=null,after=false){const a=getSpace(st),b=ensureBoard(st,btid);const ci=b.clouds.findIndex(c=>c.id===cid);if(ci<0)return;const[cloud]=b.clouds.splice(ci,1);const task={id:st.nextTaskId++,title:cloudTitle(cloud.text),color:null,pinned:false,createdAt:Date.now(),taskGroupId:null};const dst=a.days[today];if(targetId===null){dst.push(task);return;}const ti=dst.findIndex(t=>t.id===targetId);if(ti<0){dst.push(task);return;}dst.splice(after?ti+1:ti,0,task);}
function moveNote2Day(st,nid,today,targetId=null,after=false){const a=getSpace(st),ns=sideNotes(st);const ni=ns.findIndex(n=>n.id===nid);if(ni<0)return;const[note]=ns.splice(ni,1);const task={id:st.nextTaskId++,title:cloudTitle(note.text),color:null,pinned:false,createdAt:Date.now(),taskGroupId:null};const dst=a.days[today];if(targetId===null){dst.push(task);return;}const ti=dst.findIndex(t=>t.id===targetId);if(ti<0){dst.push(task);return;}dst.splice(after?ti+1:ti,0,task);}
function moveDock(st,id,targetId=null,after=false){const sp=getSpace(st);const fi=sp.dockTasks.findIndex(t=>t.id===id);if(fi<0)return;const[task]=sp.dockTasks.splice(fi,1);if(targetId===null){sp.dockTasks.push(task);return;}const ti=sp.dockTasks.findIndex(t=>t.id===targetId);if(ti<0){sp.dockTasks.push(task);return;}sp.dockTasks.splice(after?ti+1:ti,0,task);}

// LONG PRESS
function touchCtx(node,fn,ok=()=>true){let pt=null,pr=null,fired=false;const clr=()=>{if(pr)clearTimeout(pr);pr=null;pt=null;};node.addEventListener('touchstart',e=>{if(e.touches.length!==1||!ok(e))return;const t=e.touches[0];fired=false;pt={x:t.clientX,y:t.clientY};pr=setTimeout(()=>{if(!pt)return;fired=true;fn(pt.x,pt.y,e);clr();},LONG_MS);},{passive:true});node.addEventListener('touchmove',e=>{if(!pr||!pt||e.touches.length!==1)return;const t=e.touches[0];if(Math.hypot(t.clientX-pt.x,t.clientY-pt.y)>LONG_PX)clr();},{passive:true});node.addEventListener('touchend',clr);node.addEventListener('touchcancel',clr);node.addEventListener('click',e=>{if(!fired)return;fired=false;e.preventDefault();e.stopPropagation();},true);}

// INLINE EDIT
function inlineEdit(node,task,day){
  const tb=node.querySelector('.open-board');if(!tb)return;
  const inp=document.createElement('input');inp.className='task-title-input hidden';inp.type='text';inp.value=task.title;inp.maxLength=200;tb.insertAdjacentElement('afterend',inp);
  let ed=false;
  const start=()=>{ed=true;inp.value=task.title;tb.classList.add('hidden');inp.classList.remove('hidden');inp.focus();inp.select();};
  const finish=(save)=>{if(!ed)return;ed=false;inp.classList.add('hidden');tb.classList.remove('hidden');if(!save)return;const c=inp.value.trim();if(!c||c===task.title)return;const sid=state.activeSpaceId,db=task._db||task.id;commit('edit:'+task.title,st=>{const t=getSpace(st).days[day]?.find(x=>x.id===task.id);if(t)t.title=c;},()=>cuCal(db,{title:c}));};
  node.querySelector('.edit').addEventListener('click',()=>start());
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();finish(true);}if(e.key==='Escape'){e.preventDefault();finish(false);}});
  inp.addEventListener('blur',()=>finish(true));
}
function bgPat(title){const c=(title||'').trim();if(!c)return'';const row=(c+'   * ').repeat(14).trim();return Array.from({length:28},()=>row).join('\n');}

// BUILD TASK NODE
function buildNode(task,day,dropFn){
  const tpl=document.getElementById('taskTemplate'),node=tpl.content.firstElementChild.cloneNode(true);
  if(task.pinned)node.classList.add('pinned');
  if(selTasks.has(selKey(day,task.id)))node.classList.add('selected');
  node.querySelector('.open-board').textContent=task.title;
  node.querySelector('.open-board').addEventListener('click',e=>{if(!e.ctrlKey)openBoard(task.id);});
  inlineEdit(node,task,day);
  if(task.color)node.style.setProperty('--task-color',task.color);
  node.addEventListener('mousedown',e=>{if(e.button!==0||!e.ctrlKey||e.target.closest('input,textarea'))return;e.preventDefault();const k=selKey(day,task.id);if(selTasks.has(k))selTasks.delete(k);else selTasks.add(k);renderCal();});
  node.addEventListener('contextmenu',e=>{e.preventDefault();const k=selKey(day,task.id);if(!selTasks.has(k))selTasks=new Set([k]);openCtx(e.clientX,e.clientY,day,task);});
  touchCtx(node,(x,y)=>{const k=selKey(day,task.id);if(!selTasks.has(k))selTasks=new Set([k]);openCtx(x,y,day,task);},e=>!e.target.closest('input,textarea,.task-color,.to-background,.edit'));
  node.addEventListener('dragstart',e=>{if(!e.target.closest('.to-background'))dragTask={fromDay:day,taskId:task.id};});
  node.addEventListener('dragover',e=>e.preventDefault());
  node.addEventListener('drop',e=>{e.preventDefault();const r=node.getBoundingClientRect();dropFn(task.id,e.clientY>r.top+r.height/2);});
  return node;
}

// RENDER CALENDAR
function renderCal(){
  const s=eff(),grid=document.getElementById('calendarGrid'),sp=getSpace(s);
  const tgs=Array.isArray(sp.taskGroups)?sp.taskGroups:[];grid.innerHTML='';
  DAYS.forEach(day=>{
    const cell=document.createElement('div');cell.className='day-cell';cell.dataset.day=day;
    const col=document.createElement('div');col.className='day-column';col.dataset.day=day;
    const bg=sp.dayBackgrounds?.[day]||null;
    col.innerHTML='<h3 class="day-header">'+day+'</h3><button class="clear-day-bg '+(bg?'':'hidden')+'" type="button">&#10005; \u0444\u043e\u043d</button><div class="day-background-label '+(bg?'':'hidden')+'"></div><form class="add-task"><input name="title" placeholder="\u041d\u043e\u0432\u0430\u044f \u0437\u0430\u0434\u0430\u0447\u0430" required /><button type="submit">+</button></form><div class="tasks-area"><div class="task-groups"></div><ul class="tasks"></ul></div>';
    const bgl=col.querySelector('.day-background-label');if(bgl&&bg)bgl.textContent=bgPat(bg);
    const na=document.createElement('textarea');na.className='day-notes';na.placeholder='\u0422\u0435\u043a\u0441\u0442 \u043f\u043e\u0434 \u0434\u043d\u0451\u043c';na.value=sp.dayNotes?.[day]||'';
    na.addEventListener('change',e=>{const v=e.target.value,sid=state.activeSpaceId;commit('notes:'+day,st=>{getSpace(st).dayNotes[day]=v;},()=>upsDay(sid,day,getSpace(state).dayBackgrounds[day],v));});
    const dropFn=(targetId=null,after=false)=>{
      const sid=state.activeSpaceId;
      if(dragBgTask){const{fromDay,taskId,title}=dragBgTask;commit('bg:'+day,st=>{const a=getSpace(st),src=a.days[fromDay],fi=src.findIndex(t=>t.id===taskId);if(fi<0)return;const[task]=src.splice(fi,1);a.dayBackgrounds[day]=task.title;delete a.boards[task.id];if(curBoard===task.id)curBoard=null;},async()=>{await cdCal(taskId);await upsDay(sid,day,title,getSpace(state).dayNotes[day]);});dragBgTask=null;return true;}
      if(dragCloudNote){const{boardTaskId,cloudId}=dragCloudNote;let nt;commit('cloud->'+day,st=>{moveCloud2Day(st,boardTaskId,cloudId,day,targetId,after);nt=getSpace(st).days[day].at(-1);},()=>nt&&ciCal(sid,day,nt,getSpace(state).days[day].length-1));dragCloudNote=null;return true;}
      if(dragNote){const{noteId}=dragNote;let nt2;commit('note->'+day,st=>{moveNote2Day(st,noteId,day,targetId,after);nt2=getSpace(st).days[day].at(-1);},()=>nt2&&ciCal(sid,day,nt2,getSpace(state).days[day].length-1));dragNote=null;return true;}
      if(!dragTask)return false;
      const{fromDay,taskId}=dragTask;
      const task=getSpace(state).days[fromDay]?.find(t=>t.id===taskId),db=task?._db||taskId;
      commit(targetId===null?'move->'+day:'reorder',st=>{moveTask(st,fromDay,day,taskId,targetId,after);},()=>cuCal(db,{day,position:getSpace(state).days[day].findIndex(t=>(t._db||t.id)===db)}));
      dragTask=null;return true;
    };
    col.querySelector('form').addEventListener('submit',e=>{e.preventDefault();const inp=e.target.title,title=inp.value.trim();if(!title)return;const sid=state.activeSpaceId,nt={id:Date.now(),title,color:null,pinned:false,createdAt:Date.now(),taskGroupId:null};commit('add:'+title,st=>{getSpace(st).days[day].push(nt);},()=>ciCal(sid,day,nt,getSpace(state).days[day].length-1));inp.value='';});
    col.querySelector('.clear-day-bg').addEventListener('click',()=>{const sid=state.activeSpaceId;commit('clr-bg:'+day,st=>{getSpace(st).dayBackgrounds[day]=null;},()=>upsDay(sid,day,null,getSpace(state).dayNotes[day]));});
    const list=col.querySelector('.tasks'),gw=col.querySelector('.task-groups');
    col.addEventListener('dragover',e=>{if(dragTask||dragCloudNote||dragBgTask||dragNote)e.preventDefault();});
    col.addEventListener('drop',e=>{e.preventDefault();dropFn();});
    list.addEventListener('dragover',e=>e.preventDefault());list.addEventListener('drop',e=>{e.preventDefault();dropFn();});
    const dts=sp.days[day],gids=new Set(tgs.flatMap(g=>g.taskIds||[]));
    tgs.filter(g=>(g.taskIds||[]).some(id=>dts.some(t=>t.id===id))).forEach(group=>{
      const gts=dts.filter(t=>(group.taskIds||[]).includes(t.id));if(!gts.length)return;
      const gel=document.createElement('section');gel.className='task-group-column';const gc=group.color||'#8ea1ff';gel.style.setProperty('--group-color',gc);
      gel.innerHTML='<div class="task-group-header"><h4>'+(group.name||'Group')+'</h4><div class="task-group-controls"><input class="group-color-input" type="color" value="'+gc+'" /><button class="group-rename" type="button">&#10000;</button></div></div><ul class="tasks"></ul>';
      gel.querySelector('.tasks').append(...gts.map(t=>buildNode(t,day,dropFn)));
      gel.querySelector('.group-color-input').addEventListener('change',e=>{const c=e.target.value,db=group._db||group.id;commit('grp-color',st=>{const g2=getSpace(st).taskGroups?.find(x=>x.id===group.id);if(g2)g2.color=c;},()=>sbq(sb=>sb.from('task_groups').update({color:c}).eq('id',db)));});
      gel.querySelector('.group-rename').addEventListener('click',()=>{const n=prompt('Name',group.name||'');if(!n?.trim())return;const c=n.trim(),db=group._db||group.id;commit('grp-name',st=>{const g2=getSpace(st).taskGroups?.find(x=>x.id===group.id);if(g2)g2.name=c;},()=>sbq(sb=>sb.from('task_groups').update({name:c}).eq('id',db)));});
      gw.append(gel);
    });
    dts.filter(t=>!gids.has(t.id)).forEach(t=>list.append(buildNode(t,day,dropFn)));
    cell.append(col,na);grid.append(cell);
  });
  renderSpOpts(s);updSpBtn(s.activeSpaceId,s);applyTheme(s.theme);
}

// RENDER DOCK
function renderDock(s){
  const sp=getSpace(s),list=document.getElementById('taskDockList'),tog=document.getElementById('toggleDockMenu');
  if(!list||!tog)return;list.innerHTML='';tog.textContent='Dock ('+sp.dockTasks.length+')';
  if(!sp.dockTasks.length){const e=document.createElement('li');e.className='task-dock-empty';e.textContent='Empty.';list.append(e);return;}
  sp.dockTasks.forEach(task=>{
    const tpl=document.getElementById('taskTemplate'),node=tpl.content.firstElementChild.cloneNode(true);
    if(task.pinned)node.classList.add('pinned');node.querySelector('.open-board').textContent=task.title;node.querySelector('.open-board').addEventListener('click',()=>openBoard(task.id));
    const tw=node.querySelector('.task-tags');if(tw)tw.innerHTML=(task.tags||[]).map(t=>'<span class="tag">#'+t+'</span>').join('');
    node.querySelector('.edit').addEventListener('click',()=>{const n=prompt('Name',task.title);if(!n?.trim())return;const ti2=prompt('Tags',(task.tags||[]).join(', '));if(ti2===null)return;const tags=[...new Set(ti2.split(',').map(x=>x.trim()).filter(Boolean))];const db=task._db||task.id;commit('dock-edit',st=>{const t=getSpace(st).dockTasks.find(x=>x.id===task.id);if(t){t.title=n.trim();t.tags=tags;}},()=>cuDock(db,{title:n.trim(),tags}));});
    node.querySelector('.delete').addEventListener('click',()=>{const db=task._db||task.id;commit('dock-del',st=>{const a=getSpace(st);a.dockTasks=a.dockTasks.filter(t=>t.id!==task.id);delete a.boards[task.id];},()=>cdDock(db));});
    const pin=()=>{const db=task._db||task.id;commit('dock-pin',st=>{const t=getSpace(st).dockTasks.find(x=>x.id===task.id);if(t)t.pinned=!t.pinned;},()=>cuDock(db,{pinned:!task.pinned}));};
    node.addEventListener('contextmenu',e=>{e.preventDefault();pin();});
    touchCtx(node,()=>pin(),e=>!e.target.closest('textarea,input,button.edit,button.delete'));
    node.addEventListener('dragstart',()=>{dragTask={fromDay:null,taskId:task.id,fromDock:true};});
    node.addEventListener('dragover',e=>e.preventDefault());
    node.addEventListener('drop',e=>{e.preventDefault();if(!dragTask?.fromDock)return;const r=node.getBoundingClientRect();const{taskId}=dragTask;commit('dock-order',st=>moveDock(st,taskId,task.id,e.clientY>r.top+r.height/2));dragTask=null;});
    list.append(node);
  });
}

// RENDER HISTORY
function renderHist(){
  const list=document.getElementById('historyList');list.innerHTML='';
  hist.forEach((e,i)=>{
    const li=document.createElement('li');if((i===hIdx&&prevIdx===null)||i===prevIdx)li.classList.add('active');
    li.innerHTML='<strong>'+e.desc+'</strong><br/><small>'+new Date(e.ts).toLocaleString('ru-RU')+'</small>';
    const acts=document.createElement('div');
    const pb=document.createElement('button');pb.textContent='\u041f\u0440\u043e\u0441\u043c\u043e\u0442\u0440';pb.type='button';pb.onclick=()=>{prevIdx=i;renderAll();};
    const rb=document.createElement('button');rb.textContent='\u041e\u0442\u043a\u0430\u0442';rb.type='button';rb.onclick=()=>{state=structuredClone(hist[i].snap);hist=hist.slice(0,i+1);hIdx=i;prevIdx=null;persist();renderAll();};
    acts.append(pb,rb);li.append(acts);list.append(li);
  });
  const banner=document.getElementById('previewBanner'),exit=document.getElementById('exitPreview');
  if(prevIdx!==null){banner.classList.remove('hidden');banner.textContent='Preview: '+hist[prevIdx].desc;exit.classList.remove('hidden');}
  else{banner.classList.add('hidden');exit.classList.add('hidden');}
}

// BOARD
function openBoard(id){curBoard=id;selClouds=new Set();renderBoard();}
function renderBoard(){
  const bt=document.getElementById('boardTitle'),cv=document.getElementById('boardCanvas'),zv=document.getElementById('zoomValue');
  if(!bt||!cv||!zv)return;
  const ti=curBoard?taskById(curBoard,eff()):null;
  if(!ti){curBoard=null;cv.innerHTML='<div class="board-placeholder">\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0443.</div>';cv.style.transform='scale(1)';zv.textContent='100%';bt.textContent='\u041f\u043e\u043b\u0435 \u0434\u043e\u0441\u043a\u0438';return;}
  bt.textContent='\u0414\u043e\u0441\u043a\u0430: '+ti.task.title;
  const aid=ti.task.id,isCal=ti.day!==null,board=ensureBoard(state,aid);
  cv.innerHTML='';cv.style.transform='scale('+board.zoom+')';zv.textContent=Math.round(board.zoom*100)+'%';
  board.clouds.forEach(cloud=>{
    const el=document.createElement('div');el.className='cloud';if(cloud.groupId)el.classList.add('grouped');if(selClouds.has(cloud.id))el.classList.add('selected');
    el.dataset.id=cloud.id;el.style.left=cloud.x+'px';el.style.top=cloud.y+'px';
    el.innerHTML='<div class="cloud-header"><button class="cloud-transfer" type="button" draggable="true">&#10230; \u0412 \u0434\u0435\u043d\u044c</button></div><textarea>'+(cloud.text||'')+'</textarea>';
    el.querySelector('textarea').addEventListener('change',e=>{const t=e.target.value,db=cloud._db||cloud.id;commit('note-text',st=>{const b=ensureBoard(st,aid),c=b.clouds.find(x=>x.id===cloud.id);if(c)c.text=t;},()=>isCal?cuBN(db,{text:t}):sbq(sb=>sb.from('dock_board_notes').update({text:t,updated_at:new Date().toISOString()}).eq('id',db)));});
    const tr=el.querySelector('.cloud-transfer');
    tr.addEventListener('dragstart',e2=>{dragCloudNote={boardTaskId:aid,cloudId:cloud.id};if(e2.dataTransfer){e2.dataTransfer.effectAllowed='move';e2.dataTransfer.setData('text/plain',cloud.text||'');}});
    tr.addEventListener('dragend',()=>{dragCloudNote=null;});
    el.addEventListener('mousedown',e2=>{if(e2.button!==0)return;if(e2.ctrlKey&&!e2.target.matches('textarea')){if(selClouds.has(cloud.id))selClouds.delete(cloud.id);else selClouds.add(cloud.id);renderBoard();return;}if(e2.target.matches('textarea,.cloud-transfer'))return;dragCloud={id:cloud.id,startX:e2.clientX,startY:e2.clientY};});
    cv.append(el);
  });
}
document.addEventListener('mousemove',e=>{if(!dragCloud||!curBoard)return;const board=ensureBoard(state,curBoard),c=board.clouds.find(x=>x.id===dragCloud.id);if(!c)return;const dx=(e.clientX-dragCloud.startX)/board.zoom,dy=(e.clientY-dragCloud.startY)/board.zoom;dragCloud.startX=e.clientX;dragCloud.startY=e.clientY;const targets=c.groupId?board.clouds.filter(x=>x.groupId===c.groupId):[c];targets.forEach(item=>{item.x+=dx;item.y+=dy;});renderBoard();});
document.addEventListener('mouseup',()=>{if(dragCloud&&curBoard){const board=ensureBoard(state,curBoard),ti=taskById(curBoard,state),ic=ti?.day!==null;board.clouds.forEach(c=>{const db=c._db||c.id;if(ic)cuBN(db,{pos_x:c.x,pos_y:c.y});else sbq(sb=>sb.from('dock_board_notes').update({pos_x:c.x,pos_y:c.y}).eq('id',db));});hist.push({desc:'move-note',snap:structuredClone(state),ts:new Date().toISOString()});hIdx=hist.length-1;renderHist();}dragCloud=null;});

// SIDE NOTES
function renderNotes(st=eff()){const list=document.getElementById('sideNotesList');if(!list)return;const ns=sideNotes(st);list.innerHTML='';if(!ns.length){const e=document.createElement('li');e.className='side-note-empty';e.textContent='Empty.';list.append(e);return;}const sd=(note,e2)=>{dragNote={noteId:note.id};if(e2.dataTransfer){e2.dataTransfer.effectAllowed='move';e2.dataTransfer.setData('text/plain',note.text||'');}};ns.forEach(note=>{const li=document.createElement('li');li.className='side-note-item';li.draggable=true;li.innerHTML='<textarea>'+(note.text||'')+'</textarea><div class="side-note-actions"><button type="button" class="side-note-drag" draggable="true">\u0412 \u0434\u0435\u043d\u044c</button><button type="button" class="side-note-delete">\u0423\u0434\u0430\u043b\u0438\u0442\u044c</button></div>';li.querySelector('textarea').addEventListener('change',e2=>{const v=e2.target.value;commit('note-edit',st2=>{const t=sideNotes(st2).find(x=>x.id===note.id);if(t)t.text=v;});});li.addEventListener('dragstart',e2=>{if(e2.target.closest('textarea,.side-note-delete')){e2.preventDefault();return;}sd(note,e2);});li.addEventListener('dragend',()=>{dragNote=null;});li.querySelector('.side-note-drag').addEventListener('dragstart',e2=>sd(note,e2));li.querySelector('.side-note-drag').addEventListener('dragend',()=>{dragNote=null;});li.querySelector('.side-note-delete').addEventListener('click',()=>{commit('note-del',st2=>{st2.sideNotes=sideNotes(st2).filter(x=>x.id!==note.id);});});list.append(li);});}
function renderAll(){renderCal();renderHist();renderBoard();renderNotes();renderDock(eff());}

// SPACE SWITCH
function switchSpace(next){
  if(!(next in state.spaces))return;
  const prev=state.activeSpaceId;
  commit('space:'+spaceLabel(next,state),st=>{st.activeSpaceId=next;});
  void savePref(next);
  setSpMenu(false);clrSpSel();setSpActMenu(false);clrSel();curBoard=null;
  if(next!==prev){void loadSpace(next).then(()=>{subSpace(next);renderAll();});}
}

// EVENT WIRING
document.getElementById('spaceMenuToggle').addEventListener('click',()=>setSpMenu(!spaceMenuOpen));
const addSpForm=document.getElementById('addSpaceForm');
if(addSpForm){addSpForm.addEventListener('submit',async e=>{e.preventDefault();const name=addSpForm.spaceName.value.trim();if(!name)return;const key=await addSpace(crypto.randomUUID(),name);if(!key)return;commit('new-space:'+name,st=>{st.spaces[key]=mkSpace();if(!st.spaceNames)st.spaceNames={};st.spaceNames[key]=name;st.activeSpaceId=key;});avSpaces=syncSpaces([...avSpaces.filter(s=>s.key!==key),{key,name}],state);addSpForm.reset();setSpMenu(true);curBoard=null;subSpace(key);});}
const spEl=document.getElementById('spaceMenu');
if(spEl){
  spEl.addEventListener('click',e=>{const b=e.target.closest('.space-option');if(!b)return;const k=b.dataset.space;if(!(k in state.spaces))return;if(e.ctrlKey){if(selSpaces.has(k))selSpaces.delete(k);else selSpaces.add(k);renderSpOpts();return;}selSpaces=new Set([k]);switchSpace(k);});
  spEl.addEventListener('contextmenu',e=>{const b=e.target.closest('.space-option');if(!b)return;e.preventDefault();const k=b.dataset.space;if(!(k in state.spaces))return;if(!selSpaces.has(k))selSpaces=new Set([k]);spaceActKey=k;renderSpOpts();setSpActMenu(true,e.clientX,e.clientY);});
  touchCtx(spEl,(x,y,ev)=>{const b=ev.target.closest('.space-option');if(!b)return;const k=b.dataset.space;if(!(k in state.spaces))return;if(!selSpaces.has(k))selSpaces=new Set([k]);spaceActKey=k;renderSpOpts();setSpActMenu(true,x,y);},e=>Boolean(e.target.closest('.space-option')));
}
document.addEventListener('click',e=>{if(!e.target.closest('.space-menu-wrap')){setSpMenu(false);if(selSpaces.size>0){clrSpSel();renderSpOpts();}}if(notesOpen&&!e.target.closest('#notesPanel')&&!e.target.closest('#toggleNotesPanel'))setNotes(false);if(spaceActOpen&&!e.target.closest('#spaceActionMenu')&&!e.target.closest('.space-option'))setSpActMenu(false);if(taskCtxOpen&&!e.target.closest('#taskContextMenu')&&!e.target.closest('.task'))setTaskCtx(false);if(!e.target.closest('.task')&&!e.ctrlKey&&selTasks.size>0){clrSel();renderCal();}});
document.getElementById('themeToggle').addEventListener('click',()=>{commit('theme',st=>{st.theme=st.theme==='dark'?'light':'dark';});});
document.getElementById('toggleNotesPanel').addEventListener('click',()=>{setNotes(!notesOpen);if(notesOpen)setHist(false);});
document.getElementById('toggleHistory').addEventListener('click',()=>{setHist(!histOpen);if(histOpen)setInstr(false);});
document.getElementById('toggleInstructions').addEventListener('click',()=>{setInstr(!instrOpen);if(instrOpen)setHist(false);});
const lBtn=document.getElementById('logout-btn');if(lBtn)lBtn.addEventListener('click',doLogout);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(histOpen)setHist(false);if(instrOpen)setInstr(false);if(spaceMenuOpen)setSpMenu(false);if(spaceActOpen)setSpActMenu(false);if(selSpaces.size>0){clrSpSel();renderSpOpts();}if(taskCtxOpen)setTaskCtx(false);if(notesOpen)setNotes(false);}});
document.getElementById('clearUnpinned').addEventListener('click',()=>{const tc=[],td=[];commit('clear-unpinned',st=>{const a=getSpace(st);DAYS.forEach(d=>{a.days[d].filter(t=>!t.pinned).forEach(t=>tc.push(t._db||t.id));a.days[d]=a.days[d].filter(t=>t.pinned);});a.dockTasks.filter(t=>!t.pinned).forEach(t=>td.push(t._db||t.id));a.dockTasks=a.dockTasks.filter(t=>t.pinned);},()=>Promise.all([...tc.map(id=>cdCal(id)),...td.map(id=>cdDock(id))]));});
document.getElementById('exitPreview').addEventListener('click',()=>{prevIdx=null;renderAll();});
const tdBtn=document.getElementById('toggleDockMenu');if(tdBtn)tdBtn.addEventListener('click',()=>setDock(!dockOpen));
const dockForm=document.getElementById('dockTaskForm');
if(dockForm){
  dockForm.addEventListener('submit',e=>{e.preventDefault();const inp=dockForm.title,title=inp.value.trim();if(!title)return;const sid=state.activeSpaceId,nt={id:Date.now(),title,tags:[],pinned:false,createdAt:Date.now()};commit('dock+:'+title,st=>{getSpace(st).dockTasks.push(nt);},()=>ciDock(sid,nt,getSpace(state).dockTasks.length-1));dockForm.reset();});
  const dl=document.getElementById('taskDockList');
  if(dl){dl.addEventListener('dragover',e=>e.preventDefault());dl.addEventListener('drop',()=>{if(!dragTask)return;if(dragTask.fromDock){commit('dock-reorder',st=>moveDock(st,dragTask.taskId));}else{const{fromDay,taskId}=dragTask,sid=state.activeSpaceId;const task=getSpace(state).days[fromDay]?.find(t=>t.id===taskId),db=task?._db||taskId;commit('task->dock',st=>{const a=getSpace(st),src=a.days[fromDay],fi=src.findIndex(t=>t.id===taskId);if(fi<0)return;const[t]=src.splice(fi,1);a.dockTasks.push(t);},async()=>{await cdCal(db);const m=getSpace(state).dockTasks.at(-1);if(m)await ciDock(sid,m,getSpace(state).dockTasks.length-1);});}dragTask=null;});}
}
const snForm=document.getElementById('addSideNoteForm');if(snForm){snForm.addEventListener('submit',e=>{e.preventDefault();const text=snForm.text.value.trim();if(!text)return;commit('note+',st=>{sideNotes(st).push({id:st.nextSideNoteId++,text,createdAt:Date.now()});});snForm.reset();});}
document.getElementById('backToCalendar').addEventListener('click',()=>{curBoard=null;selClouds=new Set();renderBoard();});

// SPACE ACTIONS
function normImpData(raw){const src=(raw?.data&&typeof raw.data==='object')?raw.data:raw;const b=mkSpace();if(!src||typeof src!=='object')return b;return{days:{...b.days,...(src.days||{})},dayBackgrounds:{...b.dayBackgrounds,...(src.dayBackgrounds||{})},dayNotes:{...b.dayNotes,...(src.dayNotes||{})},boards:{...b.boards,...(src.boards||{})},dockTasks:Array.isArray(src.dockTasks)?src.dockTasks:[],taskGroups:Array.isArray(src.taskGroups)?src.taskGroups:[],sideNotes:Array.isArray(src.sideNotes)?src.sideNotes:[]};}
function extractSpaces(pl){if(!pl||typeof pl!=='object')return[];const norm=(e,fb=null)=>{if(!e||typeof e!=='object')return null;const k=[e.id,e.spaceId,e.spaceKey,e.data?.id,fb].find(v=>typeof v==='string'&&v.trim())?.trim();if(!k)return null;return{key:k,name:typeof e.name==='string'&&e.name.trim()?e.name.trim():k,data:normImpData(e)};};if(Array.isArray(pl.spaces))return pl.spaces.map(e=>norm(e)).filter(Boolean);if(pl.spaces&&typeof pl.spaces==='object')return Object.entries(pl.spaces).map(([id,e])=>norm(e,id)).filter(Boolean);const s=norm(pl);return s?[s]:[];}
function dlJson(fn,pl){const blob=new Blob([JSON.stringify(pl,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fn;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);}
const sac=document.getElementById('spaceActionCopy'),sae=document.getElementById('spaceActionExport'),sad=document.getElementById('spaceActionDelete'),isb=document.getElementById('importSpaceBtn'),isi=document.getElementById('importSpaceInput');
if(sac){sac.addEventListener('click',async()=>{if(!spaceActKey)return;const txt=JSON.stringify({name:spaceLabel(spaceActKey,state),spaceKey:spaceActKey,data:normImpData(getSpace({...state,activeSpaceId:spaceActKey}))},null,2);try{await navigator.clipboard.writeText(txt);alert('OK');}catch{alert('Error');}setSpActMenu(false);});}
if(sae){sae.addEventListener('click',()=>{if(!spaceActKey)return;dlJson('space-'+spaceActKey+'.json',{name:spaceLabel(spaceActKey,state),spaceKey:spaceActKey,exportedAt:new Date().toISOString(),data:normImpData(getSpace({...state,activeSpaceId:spaceActKey}))});setSpActMenu(false);});}
if(sad){sad.addEventListener('click',async()=>{const tgts=spActSel();if(!tgts.length){setSpActMenu(false);return;}if(!await delSpaces(tgts)){alert('Error');return;}commit('del-space',st=>{if(!st.spaceNames)st.spaceNames={};tgts.forEach(t=>{delete st.spaces[t];delete st.spaceNames[t];});if(!(st.activeSpaceId in st.spaces))st.activeSpaceId=Object.keys(st.spaces)[0]||null;curBoard=null;});avSpaces=syncSpaces(avSpaces.filter(s=>!tgts.includes(s.key)),state);clrSpSel();setSpActMenu(false);});}
if(isb&&isi){isb.addEventListener('click',()=>isi.click());isi.addEventListener('change',async()=>{const file=isi.files?.[0];if(!file)return;let pl;try{pl=JSON.parse(await file.text());}catch{alert('Bad JSON');isi.value='';return;}const imp=extractSpaces(pl);if(!imp.length){alert('No spaces');isi.value='';return;}const rm=imp.map(s=>({...s,key:toUUID(s.key)}));if(rm.find(({key})=>key in state.spaces)){alert('Already exists');isi.value='';return;}for(const s of rm){const k=await addSpace(s.key,s.name);if(!k){isi.value='';return;}s.key=k;}commit('import:'+rm.length,st=>{if(!st.spaceNames)st.spaceNames={};rm.forEach(({key,name,data})=>{st.spaceNames[key]=name;st.spaces[key]=data;});});avSpaces=syncSpaces([...avSpaces.filter(s=>!rm.some(r=>r.key===s.key)),...rm.map(({key,name})=>({key,name}))],state);isi.value='';});}

// CONTEXT MENU HANDLERS
const ctxPin=document.getElementById('ctxPin'),ctxBg=document.getElementById('ctxBackground'),ctxDel=document.getElementById('ctxDelete'),ctxCol=document.getElementById('ctxColor'),ctxGrp=document.getElementById('ctxCreateGroup');
if(ctxPin){ctxPin.addEventListener('click',()=>{const p=ctxSel();if(!p.length)return;commit('pin',st=>{const a=getSpace(st);p.forEach(({day,taskId})=>{const t=a.days[day]?.find(x=>x.id===taskId);if(t)t.pinned=!t.pinned;});},()=>Promise.all(p.map(({day,taskId})=>{const t=getSpace(state).days[day]?.find(x=>x.id===taskId);if(t)return cuCal(t._db||t.id,{pinned:t.pinned});})));clrSel();setTaskCtx(false);});}
if(ctxBg){ctxBg.addEventListener('click',()=>{if(!taskCtx)return;const{day,taskId}=taskCtx,task=getSpace(state).days[day]?.find(x=>x.id===taskId),db=task?._db||taskId,sid=state.activeSpaceId;commit('to-bg',st=>{const a=getSpace(st),src=a.days[day],fi=src.findIndex(t=>t.id===taskId);if(fi<0)return;const[t]=src.splice(fi,1);a.dayBackgrounds[day]=t.title;delete a.boards[t.id];if(curBoard===t.id)curBoard=null;},async()=>{await cdCal(db);await upsDay(sid,day,task?.title,getSpace(state).dayNotes[day]);});clrSel();setTaskCtx(false);});}
if(ctxDel){ctxDel.addEventListener('click',()=>{const p=ctxSel();if(!p.length)return;const dbs=p.map(({day,taskId})=>{const t=getSpace(state).days[day]?.find(x=>x.id===taskId);return t?._db||taskId;});commit('del',st=>{const a=getSpace(st);p.forEach(({day,taskId})=>{a.days[day]=a.days[day].filter(t=>t.id!==taskId);delete a.boards[taskId];if(curBoard===taskId)curBoard=null;});a.taskGroups=(a.taskGroups||[]).map(g=>({...g,taskIds:(g.taskIds||[]).filter(id=>!p.some(px=>px.taskId===id))})).filter(g=>g.taskIds.length>1);},()=>Promise.all(dbs.map(id=>cdCal(id))));clrSel();setTaskCtx(false);});}
if(ctxCol){ctxCol.addEventListener('change',e=>{const p=ctxSel();if(!p.length)return;const c=e.target.value;commit('color',st=>{const a=getSpace(st);p.forEach(({day,taskId})=>{const t=a.days[day]?.find(x=>x.id===taskId);if(t)t.color=c;});},()=>Promise.all(p.map(({day,taskId})=>{const t=getSpace(state).days[day]?.find(x=>x.id===taskId);if(t)return cuCal(t._db||t.id,{color:c});})));});}
if(ctxGrp){ctxGrp.addEventListener('click',()=>{const p=ctxSel();if(p.length<2)return;const sid=state.activeSpaceId;commit('grp+',st=>{const a=getSpace(st);if(!Array.isArray(a.taskGroups))a.taskGroups=[];const gid=st.nextTaskGroupId++;a.taskGroups.push({id:gid,name:'Group '+gid,color:'#8ea1ff',taskIds:[...new Set(p.map(px=>px.taskId))]});},async()=>{const{data}=await sbq(sb=>sb.from('task_groups').insert({user_id:uid(),space_id:sid,name:'Group',color:'#8ea1ff'}).select('id').single());if(!data?.id)return;await Promise.all(p.map(({day,taskId})=>{const t=getSpace(state).days[day]?.find(x=>x.id===taskId);if(t)return cuCal(t._db||t.id,{task_group_id:data.id,task_group_id_local:data.id});}));});clrSel();setTaskCtx(false);});}
document.getElementById('addCloud').addEventListener('click',()=>{const id=curBoard;if(!id)return;const ti=taskById(id,state),ic=ti?.day!==null;const nc={id:Date.now(),text:'',x:50,y:50,groupId:null};commit('note+',st=>{ensureBoard(st,id).clouds.push(nc);},()=>ic?ciBN(id,nc):ciDBN(id,nc));});
document.getElementById('groupClouds').addEventListener('click',()=>{const id=curBoard;if(!id||selClouds.size<2)return;const p=[...selClouds];commit('grp-notes',st=>{const b=ensureBoard(st,id);const g=st.nextGroupId++;b.clouds.forEach(c=>{if(p.includes(c.id))c.groupId=g;});});});
document.addEventListener('keydown',e=>{
  if(e.key!=='Delete')return;if(e.target.matches('input,textarea,[contenteditable="true"]'))return;
  if(curBoard&&selClouds.size>0){const p=[...selClouds],ti=taskById(curBoard,state),ic=ti?.day!==null;commit('del-notes',st=>{const b=ensureBoard(st,curBoard);const td=b.clouds.filter(c=>p.includes(c.id));b.clouds=b.clouds.filter(c=>!p.includes(c.id));td.forEach(c=>{const db=c._db||c.id;if(ic)cdBN(db);else sbq(sb=>sb.from('dock_board_notes').delete().eq('id',db));});});selClouds=new Set();return;}
  if(selTasks.size>0){const p=selRefs();const dbs=p.map(({day,taskId})=>{const t=getSpace(state).days[day]?.find(x=>x.id===taskId);return t?._db||taskId;});commit('del-tasks',st=>{const a=getSpace(st);p.forEach(({day,taskId})=>{a.days[day]=a.days[day].filter(t=>t.id!==taskId);delete a.boards[taskId];if(curBoard===taskId)curBoard=null;});a.taskGroups=(a.taskGroups||[]).map(g=>({...g,taskIds:(g.taskIds||[]).filter(id=>!p.some(px=>px.taskId===id))})).filter(g=>g.taskIds.length>1);},()=>Promise.all(dbs.map(id=>cdCal(id))));clrSel();}
});
document.getElementById('ungroupClouds').addEventListener('click',()=>{const id=curBoard;if(!id||!selClouds.size)return;const p=[...selClouds];commit('ungrp',st=>{ensureBoard(st,id).clouds.forEach(c=>{if(p.includes(c.id))c.groupId=null;});});});
document.getElementById('zoomIn').addEventListener('click',()=>{const id=curBoard;if(!id)return;commit('zoom+',st=>{const b=ensureBoard(st,id);b.zoom=Math.min(2.5,b.zoom+0.1);});});
document.getElementById('zoomOut').addEventListener('click',()=>{const id=curBoard;if(!id)return;commit('zoom-',st=>{const b=ensureBoard(st,id);b.zoom=Math.max(0.4,b.zoom-0.1);});});
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();if(hIdx>0){hIdx--;state=structuredClone(hist[hIdx].snap);prevIdx=null;persist();renderAll();}}});

// INIT
setHist(false);setInstr(false);setSpMenu(false);setDock(false);setNotes(false);syncLogout();
async function ensureUid(){currentUserId=tgUser?.id?String(tgUser.id):getStoredId();if(currentUserId){AUTH_KEYS.forEach(k=>localStorage.setItem(k,String(currentUserId)));return currentUserId;}return checkAuth();}
async function initApp(){
  const uid2=await ensureUid();if(!uid2)return;
  const spaces=await loadSpaces();
  console.log('[app] spaces:',spaces?.length,'uid:',currentUserId);
  avSpaces=syncSpaces(spaces,state);
  const pref=await loadPref();
  const init=(pref&&pref in state.spaces)?pref:(avSpaces[0]?.key||null);
  state.activeSpaceId=init;persist();
  if(init)await loadSpace(init);
  hist=[{desc:'Start',snap:structuredClone(state),ts:new Date().toISOString()}];hIdx=0;prevIdx=null;
  renderAll();
  if(init)subSpace(init);
  fetchTasks();syncLogout();
  console.log('[app] ready uid:',currentUserId,'space:',init);
}
initApp();