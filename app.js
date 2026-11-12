"use strict";
/* ==================== storage ==================== */
var LS_KEY = "focuslist_offline_v1";
var DEFAULT_SETTINGS = {
  focusMin:25, shortMin:5, longMin:15, longEvery:4,
  autoNext:false, autoBreak:true, noBreak:false,
  sound:"bell", noise:"off", noiseVol:50, goal:8
};
var DB;
function defaultDB(){ return { tasks:[], records:[], settings:Object.assign({}, DEFAULT_SETTINGS) }; }
function loadDB(){
  try{
    var raw = localStorage.getItem(LS_KEY);
    if(!raw) return defaultDB();
    var d = JSON.parse(raw);
    if(!d || !Array.isArray(d.tasks) || !Array.isArray(d.records)) return defaultDB();
    d.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings||{});
    return d;
  }catch(e){ return defaultDB(); }
}
function save(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(DB)); }catch(e){} }
DB = loadDB();
var S = DB.settings;

/* ==================== date helpers ==================== */
function pad2(n){ return (n<10?"0":"")+n; }
function dstr(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
function todayStr(){ return dstr(new Date()); }
function addDaysStr(base, n){ var d=new Date(base+"T12:00:00"); d.setDate(d.getDate()+n); return dstr(d); }
function tomorrowStr(){ return addDaysStr(todayStr(),1); }
var WEEK_CN=["日","一","二","三","四","五","六"];
function prettyDate(s){ var d=new Date(s+"T12:00:00"); return (d.getMonth()+1)+"月"+d.getDate()+"日 · 周"+WEEK_CN[d.getDay()]; }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }

/* ==================== task helpers ==================== */
var CAT_CN={work:"工作",study:"学习",other:"其他"};
function getTask(id){ for(var i=0;i<DB.tasks.length;i++) if(DB.tasks[i].id===id) return DB.tasks[i]; return null; }
function taskDoneOn(t, date){
  if(t.repeat==="daily") return (t.doneDates||[]).indexOf(date)>=0;
  return !!t.done;
}
function taskPomosOn(t, date){ return (t.pomos&&t.pomos[date])||0; }
function pomosOn(date){ var n=0; DB.records.forEach(function(r){ if(r.date===date) n++; }); return n; }
function minutesOn(date){ var m=0; DB.records.forEach(function(r){ if(r.date===date) m+=r.minutes; }); return m; }
function completedTasksOn(date){
  var n=0;
  DB.tasks.forEach(function(t){
    if(t.repeat==="daily"){ if((t.doneDates||[]).indexOf(date)>=0) n++; }
    else if(t.done && t.doneDate===date) n++;
  });
  return n;
}
function completedTasksBetween(a,b){
  var n=0, d=a;
  while(d<=b){ n+=completedTasksOn(d); d=addDaysStr(d,1); }
  return n;
}
function weekRange(){
  var t=new Date(); var dow=(t.getDay()+6)%7; // Monday start
  var mon=new Date(t); mon.setDate(t.getDate()-dow);
  var sun=new Date(mon); sun.setDate(mon.getDate()+6);
  return [dstr(mon), dstr(sun)];
}
function streakDays(){
  var n=0, d=todayStr();
  if(pomosOn(d)===0) d=addDaysStr(d,-1);
  while(pomosOn(d)>0){ n++; d=addDaysStr(d,-1); }
  return n;
}

/* ==================== toast & modal ==================== */
var toastTimer=null;
function toast(msg){
  var el=document.getElementById("toast"); el.textContent=msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer=setTimeout(function(){ el.classList.remove("show"); },2400);
}
var modalCb=null;
function confirmModal(title, text, okLabel, cb){
  document.getElementById("modalTitle").textContent=title;
  document.getElementById("modalText").textContent=text;
  document.getElementById("modalOk").textContent=okLabel||"确定";
  document.getElementById("modalMask").classList.add("show");
  modalCb=cb;
}
document.getElementById("modalCancel").addEventListener("click",function(){ document.getElementById("modalMask").classList.remove("show"); modalCb=null; });
document.getElementById("modalOk").addEventListener("click",function(){ document.getElementById("modalMask").classList.remove("show"); if(modalCb){ var cb=modalCb; modalCb=null; cb(); } });
;
"use strict";
/* ==================== task list UI ==================== */
var currentView = "today";
var expandedSubs = {};   // taskId -> true
var editingId = null;

document.getElementById("viewTabs").addEventListener("click",function(e){
  var b=e.target.closest("button"); if(!b) return;
  currentView=b.dataset.view;
  this.querySelectorAll("button").forEach(function(x){ x.classList.toggle("on", x===b); });
  renderTasks();
});

function taskMatchesView(t, view){
  var today=todayStr(), tom=tomorrowStr();
  if(view==="open") return !taskDoneOn(t, today);
  if(view==="week"){
    var wr=weekRange();
    if(t.repeat==="daily") return true;
    return (t.date>=wr[0] && t.date<=wr[1]) || (!!t.done && t.doneDate && t.doneDate>=wr[0] && t.doneDate<=wr[1]);
  }
  if(view==="high") return t.priority==="high" && !taskDoneOn(t, today);
  if(view==="done"){
    if(t.repeat==="daily") return (t.doneDates||[]).indexOf(today)>=0;
    return !!t.done;
  }
  var day = view==="today" ? today : tom;
  if(t.repeat==="daily") return view==="today"; // daily habits live on today's list
  return t.date===day || (view==="today" && t.done && t.doneDate===today);
}
function visibleTasks(){
  var today=todayStr();
  var list=DB.tasks.filter(function(t){ return taskMatchesView(t, currentView); });
  list.sort(function(a,b){
    var da=taskDoneOn(a,today)?1:0, db=taskDoneOn(b,today)?1:0;
    if(da!==db) return da-db;
    var pr={high:0,med:1,low:2};
    if(pr[a.priority]!==pr[b.priority]) return pr[a.priority]-pr[b.priority];
    return (a.created||0)-(b.created||0);
  });
  return list;
}

var SVG_PLAY='<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
var SVG_EDIT='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';
var SVG_TRASH='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6"/></svg>';
var SVG_SUB='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';

function renderTasks(){
  var box=document.getElementById("taskList");
  var list=visibleTasks();
  var today=todayStr();
  updateNavCounts();
  if(list.length===0){
    var emptyMsgs={
      open:'<div class="empty"><div class="big">没有未完成的任务</div>全部做完了，给自己泡杯茶吧。</div>',
      week:'<div class="empty"><div class="big">本周还没有安排</div>点「添加任务」，给这一周种下第一件事。</div>',
      high:'<div class="empty"><div class="big">没有高优先级任务</div>把优先级设为「高」的任务会出现在这里。</div>',
      done:'<div class="empty"><div class="big">还没有已完成的任务</div>勾掉第一个任务，它就会出现在这里。</div>'
    };
    box.innerHTML=emptyMsgs[currentView]||'<div class="empty"><div class="big">这一天还没有安排</div>点「添加任务」，写下第一件要专注的事。</div>';
    return;
  }
  box.innerHTML=["work","study","other"].map(function(cat){
    var group=list.filter(function(t){ return t.category===cat; });
    if(group.length===0) return "";
    var remainMin=0;
    group.forEach(function(t){
      var refD = t.repeat==="daily" ? today : t.date;
      remainMin += Math.max(0,(t.est||1)-taskPomosOn(t, refD))*S.focusMin;
    });
    var head='<div class="task-group"><span class="g-dot '+cat+'"></span>'+CAT_CN[cat]+
      '<span class="g-meta">'+group.length+' 项 · 还需约 '+remainMin+' 分钟</span></div>';
    return head+group.map(function(t){
    var done=taskDoneOn(t,today);
    var refDate = t.repeat==="daily" ? today : t.date;
    var got=taskPomosOn(t, refDate), est=t.est||1;
    var subs=t.subtasks||[];
    var subDone=subs.filter(function(s){return s.done;}).length;
    var meta=[];
    meta.push('<span class="tag '+t.category+'">'+CAT_CN[t.category]+'</span>');
    meta.push('<span class="pomo-badge'+(got>=est?' full':'')+'">🍅 '+got+'/'+est+'</span>');
    if(subs.length) meta.push('<span>子任务 '+subDone+'/'+subs.length+'</span>');
    if(t.repeat==="daily") meta.push('<span class="repeat-badge">↻ 每天重复</span>');
    if((currentView==="open"||currentView==="week"||currentView==="high"||currentView==="done") && t.repeat!=="daily") meta.push('<span class="meta-date">'+prettyDate(t.date)+'</span>');
    if(t.reminder) meta.push('<span>⏰ '+esc(t.reminder)+'</span>');
    var subHtml="";
    if(expandedSubs[t.id]){
      subHtml='<div class="subs open">'+
        subs.map(function(s){
          return '<div class="sub-row'+(s.done?" done":"")+'"><input type="checkbox" data-sub-toggle="'+t.id+'" data-sub-id="'+s.id+'" '+(s.done?"checked":"")+' aria-label="子任务完成"><span class="sub-title">'+esc(s.title)+'</span><button class="icon-btn" data-sub-del="'+t.id+'" data-sub-id="'+s.id+'" aria-label="删除子任务">✕</button></div>';
        }).join("")+
        '<div class="sub-add"><input type="text" placeholder="添加子任务，回车确认" aria-label="子任务内容" data-sub-input="'+t.id+'" maxlength="80"><button class="btn small" data-sub-add="'+t.id+'">添加</button></div>'+
      '</div>';
    }
    return '<div class="task'+(done?" done-task":"")+'" data-task="'+t.id+'">'+
      '<div class="task-main">'+
        '<label class="task-check"><input type="checkbox" data-toggle="'+t.id+'" '+(done?"checked":"")+' aria-label="标记完成"></label>'+
        '<span class="pri-dot pri-'+t.priority+'" title="优先级"></span>'+
        '<div class="task-body"><div class="task-title">'+esc(t.title)+'</div>'+
          '<div class="task-meta">'+meta.join("")+'</div>'+
          (subs.length?'<div class="sub-progress"><i style="width:'+Math.round(subDone/subs.length*100)+'%"></i></div>':"")+
          (t.note?'<div class="task-note">'+esc(t.note)+'</div>':"")+
        '</div>'+
        '<div class="task-actions">'+
          (done?"":'<button class="icon-btn start" data-start="'+t.id+'" title="开始专注" aria-label="开始专注">'+SVG_PLAY+'</button>')+
          '<button class="icon-btn" data-subs="'+t.id+'" title="子任务" aria-label="子任务">'+SVG_SUB+'</button>'+
          '<button class="icon-btn" data-edit="'+t.id+'" title="编辑" aria-label="编辑">'+SVG_EDIT+'</button>'+
          '<button class="icon-btn" data-del="'+t.id+'" title="删除" aria-label="删除">'+SVG_TRASH+'</button>'+
        '</div>'+
      '</div>'+ subHtml +
    '</div>';
    }).join("");
  }).join("");
}
function navTimeFmt(m){
  if(m<=0) return "0m";
  if(m<60) return m+"m";
  var h=Math.floor(m/60), r=m%60;
  return r? h+"h"+r+"m" : h+"h";
}
function updateNavCounts(){
  ["today","tomorrow","week","high","open","done"].forEach(function(v){
    var el=document.getElementById("navCount-"+v);
    if(el) el.textContent=DB.tasks.filter(function(t){ return taskMatchesView(t, v); }).length;
  });
  ["work","study","other"].forEach(function(cat){
    var el=document.getElementById("navCat-"+cat);
    if(!el) return;
    var mins=0;
    DB.tasks.forEach(function(t){
      if(t.category===cat && taskMatchesView(t,"today")) mins+=(t.est||1)*S.focusMin;
    });
    el.textContent=navTimeFmt(mins);
  });
}

document.getElementById("taskList").addEventListener("click",function(e){
  var start=e.target.closest("[data-start]");
  if(start){ bindTask(start.dataset.start, true); return; }
  var ed=e.target.closest("[data-edit]");
  if(ed){ openForm(ed.dataset.edit); return; }
  var del=e.target.closest("[data-del]");
  if(del){
    var t=getTask(del.dataset.del);
    confirmModal("删除任务","确定删除「"+(t?t.title:"")+"」吗？它已记录的番茄数会一并从任务上移除（专注历史记录会保留）。","删除",function(){
      DB.tasks=DB.tasks.filter(function(x){return x.id!==del.dataset.del;});
      if(timer.taskId===del.dataset.del){ timer.taskId=null; }
      save(); renderTasks(); renderTimer(); toast("任务已删除");
    });
    return;
  }
  var subsBtn=e.target.closest("[data-subs]");
  if(subsBtn){ var id=subsBtn.dataset.subs; expandedSubs[id]=!expandedSubs[id]; renderTasks(); return; }
  var subAdd=e.target.closest("[data-sub-add]");
  if(subAdd){ addSubtask(subAdd.dataset.subAdd); return; }
  var subDel=e.target.closest("[data-sub-del]");
  if(subDel){
    var tk=getTask(subDel.dataset.subDel);
    if(tk){ tk.subtasks=tk.subtasks.filter(function(s){return s.id!==subDel.dataset.subId;}); save(); renderTasks(); }
    return;
  }
});
document.getElementById("taskList").addEventListener("change",function(e){
  var tg=e.target.closest("[data-toggle]");
  if(tg){ toggleTaskDone(tg.dataset.toggle, tg.checked); return; }
  var st=e.target.closest("[data-sub-toggle]");
  if(st){
    var tk=getTask(st.dataset.subToggle);
    if(tk){ tk.subtasks.forEach(function(s){ if(s.id===st.dataset.subId) s.done=st.checked; }); save(); renderTasks(); }
  }
});
document.getElementById("taskList").addEventListener("keydown",function(e){
  if(e.key==="Enter" && e.target.matches("[data-sub-input]")){ e.preventDefault(); addSubtask(e.target.dataset.subInput); }
});
function addSubtask(taskId){
  var input=document.querySelector('[data-sub-input="'+taskId+'"]');
  var v=input?input.value.trim():"";
  if(!v) return;
  var t=getTask(taskId); if(!t) return;
  t.subtasks=t.subtasks||[]; t.subtasks.push({id:uid(), title:v, done:false});
  save(); renderTasks();
  var again=document.querySelector('[data-sub-input="'+taskId+'"]'); if(again) again.focus();
}
function toggleTaskDone(id, checked){
  var t=getTask(id); if(!t) return;
  var today=todayStr();
  if(t.repeat==="daily"){
    t.doneDates=t.doneDates||[];
    if(checked && t.doneDates.indexOf(today)<0) t.doneDates.push(today);
    if(!checked) t.doneDates=t.doneDates.filter(function(d){return d!==today;});
  }else{
    t.done=checked; t.doneDate=checked?today:null;
  }
  save(); renderTasks(); renderReports(); renderOverview();
  if(checked) toast("「"+t.title+"」已完成，做得好");
}

/* ==================== task form ==================== */
var form=document.getElementById("taskForm");
function openForm(id){
  editingId=id||null;
  var t=id?getTask(id):null;
  document.getElementById("fTitle").value=t?t.title:"";
  document.getElementById("fCat").value=t?t.category:"work";
  document.getElementById("fPri").value=t?t.priority:"med";
  document.getElementById("fEst").value=t?(t.est||1):1;
  document.getElementById("fDate").value=t?t.date:todayStr();
  document.getElementById("fRepeat").value=t?t.repeat:"none";
  document.getElementById("fRemind").value=t?(t.reminder||""):"";
  document.getElementById("fNote").value=t?(t.note||""):"";
  document.getElementById("formSave").textContent=t?"保存修改":"保存任务";
  form.classList.add("open");
  document.getElementById("fTitle").focus();
}
function closeForm(){ form.classList.remove("open"); editingId=null; }
document.getElementById("addTaskBtn").addEventListener("click",function(){ form.classList.contains("open")&&!editingId?closeForm():openForm(null); });
document.getElementById("formCancel").addEventListener("click",closeForm);
form.addEventListener("submit",function(e){
  e.preventDefault();
  var title=document.getElementById("fTitle").value.trim();
  if(!title){ toast("请先填写任务标题"); document.getElementById("fTitle").focus(); return; }
  var est=parseInt(document.getElementById("fEst").value,10); if(!(est>=1)) est=1; if(est>99) est=99;
  var data={
    title:title,
    category:document.getElementById("fCat").value,
    priority:document.getElementById("fPri").value,
    est:est,
    date:document.getElementById("fDate").value||todayStr(),
    repeat:document.getElementById("fRepeat").value,
    reminder:document.getElementById("fRemind").value||"",
    note:document.getElementById("fNote").value.trim()
  };
  if(editingId){
    var t=getTask(editingId); if(t) Object.assign(t,data);
    toast("任务已更新");
  }else{
    DB.tasks.push(Object.assign({id:uid(), created:Date.now(), done:false, doneDate:null, doneDates:[], pomos:{}, subtasks:[]}, data));
    toast("任务已添加");
  }
  save(); closeForm(); renderTasks();
});
;
"use strict";
/* ==================== audio: Web Audio synthesis ==================== */
var AC=null;
function audioCtx(){
  if(!AC){ try{ AC=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; } }
  if(AC && AC.state==="suspended") AC.resume();
  return AC;
}
function tone(ctx, freq, t0, dur, type, vol, slideTo){
  var o=ctx.createOscillator(), g=ctx.createGain();
  o.type=type||"sine"; o.frequency.setValueAtTime(freq, t0);
  if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0+dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0+0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(t0); o.stop(t0+dur+0.05);
}
function playSound(kind){
  if(kind==="none") return;
  var ctx=audioCtx(); if(!ctx) return;
  var t=ctx.currentTime+0.02;
  if(kind==="bell"){
    [1567.98, 2093, 2637].forEach(function(f,i){ tone(ctx, f, t, 1.4-i*0.25, "sine", 0.16/(i+1)); });
    tone(ctx, 1567.98, t+0.45, 1.2, "sine", 0.07);
  }else if(kind==="wood"){
    tone(ctx, 840, t, 0.14, "sine", 0.5, 190);
    tone(ctx, 840, t+0.32, 0.14, "sine", 0.4, 190);
    tone(ctx, 840, t+0.64, 0.2, "sine", 0.32, 170);
  }else if(kind==="bird"){
    tone(ctx, 2400, t, 0.16, "sine", 0.12, 3300);
    tone(ctx, 2800, t+0.2, 0.14, "sine", 0.12, 2100);
    tone(ctx, 2500, t+0.42, 0.2, "sine", 0.13, 3500);
    tone(ctx, 3100, t+0.68, 0.16, "sine", 0.1, 2600);
  }else{ /* chime 风铃 */
    [1318.5, 1568, 1760, 2093, 2349].forEach(function(f,i){ tone(ctx, f, t+i*0.13, 0.9, "sine", 0.09); });
  }
}

/* ---- white noise ---- */
var noise={ src:null, gain:null, lfo:null, lfoGain:null };
function makeNoiseBuffer(ctx, brown){
  var len=ctx.sampleRate*3, buf=ctx.createBuffer(1,len,ctx.sampleRate), d=buf.getChannelData(0), last=0;
  for(var i=0;i<len;i++){
    var w=Math.random()*2-1;
    if(brown){ last=(last+0.02*w)/1.02; d[i]=last*3.2; } else d[i]=w;
  }
  return buf;
}
function stopNoise(){
  try{ if(noise.src) noise.src.stop(); }catch(e){}
  try{ if(noise.lfo) noise.lfo.stop(); }catch(e){}
  if(noise.gain){ try{ noise.gain.disconnect(); }catch(e){} }
  noise={src:null,gain:null,lfo:null,lfoGain:null};
}
function startNoise(kind){
  stopNoise();
  if(kind==="off") return;
  var ctx=audioCtx(); if(!ctx) return;
  var brown = (kind==="ocean"||kind==="cafe");
  var src=ctx.createBufferSource(); src.buffer=makeNoiseBuffer(ctx,brown); src.loop=true;
  var filter=ctx.createBiquadFilter();
  var g=ctx.createGain(); g.gain.value=(S.noiseVol/100)*0.5;
  if(kind==="rain"){ filter.type="lowpass"; filter.frequency.value=1100; }
  else if(kind==="ocean"){ filter.type="lowpass"; filter.frequency.value=420; }
  else if(kind==="forest"){ filter.type="bandpass"; filter.frequency.value=620; filter.Q.value=0.55; g.gain.value=(S.noiseVol/100)*0.34; }
  else { filter.type="lowpass"; filter.frequency.value=320; }
  src.connect(filter); filter.connect(g); g.connect(ctx.destination);
  src.start();
  noise.src=src; noise.gain=g;
  if(kind==="ocean"){ // slow swell
    var lfo=ctx.createOscillator(), lg=ctx.createGain();
    lfo.frequency.value=0.09; lg.gain.value=(S.noiseVol/100)*0.22;
    lfo.connect(lg); lg.connect(g.gain); lfo.start(); noise.lfo=lfo; noise.lfoGain=lg;
  }
  if(kind==="forest"){ // gentle rustle
    var lfo2=ctx.createOscillator(), lg2=ctx.createGain();
    lfo2.frequency.value=0.23; lg2.gain.value=(S.noiseVol/100)*0.1;
    lfo2.connect(lg2); lg2.connect(g.gain); lfo2.start(); noise.lfo=lfo2;
  }
}
function setNoiseVol(){
  if(noise.gain && AC) noise.gain.gain.setTargetAtTime((S.noiseVol/100)*(S.noise==="forest"?0.34:0.5), AC.currentTime, 0.1);
  if(noise.lfoGain && AC) noise.lfoGain.gain.setTargetAtTime((S.noiseVol/100)*0.22, AC.currentTime, 0.1);
}
document.getElementById("noiseRow").addEventListener("click",function(e){
  var b=e.target.closest("[data-noise]"); if(!b) return;
  S.noise=b.dataset.noise; save();
  this.querySelectorAll(".chip").forEach(function(c){ c.classList.toggle("on", c===b); });
  startNoise(S.noise);
  if(S.noise!=="off") toast("白噪音已开启（"+b.textContent+"）");
});
document.getElementById("noiseVol").addEventListener("input",function(){ S.noiseVol=parseInt(this.value,10); save(); setNoiseVol(); });

/* ==================== timer ==================== */
var PHASE_CN={focus:"专注", short:"短休息", long:"长休息"};
var timer={ phase:"focus", running:false, endAt:0, remainMs:phaseDur("focus"), taskId:null, cycle:0, lastDay:todayStr() };
function phaseDur(p){ return (p==="focus"?S.focusMin : p==="short"?S.shortMin : S.longMin)*60000; }
function bindTask(id, autostart){
  timer.taskId=id;
  if(timer.phase!=="focus"){ setPhase("focus", false); }
  renderTimer();
  var t=getTask(id);
  if(t) toast("已绑定任务："+t.title);
  if(autostart && !timer.running) startTimer();
}
function setPhase(p, autostart){
  timer.phase=p; timer.running=false; timer.endAt=0; timer.remainMs=phaseDur(p);
  if(autostart) startTimer(); else renderTimer();
}
function startTimer(){
  audioCtx();
  timer.endAt=Date.now()+timer.remainMs; timer.running=true; renderTimer();
}
function pauseTimer(){
  timer.remainMs=Math.max(0, timer.endAt-Date.now()); timer.running=false; renderTimer();
}
function resetTimer(){ timer.running=false; timer.endAt=0; timer.remainMs=phaseDur(timer.phase); renderTimer(); }
function abandonTimer(){
  if(timer.phase!=="focus" || (!timer.running && timer.remainMs>=phaseDur("focus"))){ resetTimer(); return; }
  confirmModal("放弃这次专注？","放弃后这次专注不会记录番茄，计时将重置。","放弃专注",function(){
    resetTimer(); toast("已放弃，本次不记录");
  });
}
function completePhase(){
  timer.running=false; timer.endAt=0;
  var finished=timer.phase;
  if(finished==="focus"){
    var today=todayStr();
    var t=timer.taskId?getTask(timer.taskId):null;
    if(t){ t.pomos=t.pomos||{}; t.pomos[today]=(t.pomos[today]||0)+1; }
    DB.records.push({ id:uid(), ts:Date.now(), date:today, taskId:timer.taskId||null, taskTitle:t?t.title:"自由专注", minutes:S.focusMin });
    timer.cycle++;
    save();
    playSound(S.sound);
    renderTasks(); renderOverview(); renderReports();
    toast("🍅 完成一个番茄"+(t?"：「"+t.title+"」":""));
    if(S.noBreak){ setPhase("focus", S.autoNext); return; }
    var isLong = (timer.cycle % S.longEvery===0);
    if(isLong) timer.cycle=0;
    setPhase(isLong?"long":"short", S.autoBreak);
    toast(isLong?"进入长休息，放松一下":"进入短休息，起来活动一下");
  }else{
    playSound(S.sound);
    toast("休息结束，开始下一个番茄");
    setPhase("focus", S.autoNext);
  }
}
var RING_C = 2*Math.PI*112;
function renderTimer(){
  var total=phaseDur(timer.phase);
  var remain = timer.running ? Math.max(0, timer.endAt-Date.now()) : timer.remainMs;
  var frac = total>0 ? remain/total : 0;
  var sec=Math.ceil(remain/1000);
  var fg=document.getElementById("ringFg");
  fg.style.strokeDasharray=RING_C;
  fg.style.strokeDashoffset=RING_C*(1-frac);
  fg.classList.toggle("break", timer.phase!=="focus");
  document.getElementById("ringTime").textContent=pad2(Math.floor(sec/60))+":"+pad2(sec%60);
  document.getElementById("ringPhase").textContent =
    timer.running ? (timer.phase==="focus"?"专注中":PHASE_CN[timer.phase]+"中") :
    (remain<total ? "已暂停" : "准备"+PHASE_CN[timer.phase]);
  document.title = (timer.running? "("+pad2(Math.floor(sec/60))+":"+pad2(sec%60)+") ":"") + "专注清单（离线版）";
  document.querySelectorAll("#phaseTabs button").forEach(function(b){
    b.classList.toggle("on", b.dataset.phase===timer.phase);
    b.classList.toggle("break", b.dataset.phase!==timer.phase && b.dataset.phase!=="focus" ? false : (timer.phase!=="focus"&&b.dataset.phase===timer.phase));
  });
  var dots=""; var inCycle = timer.cycle % S.longEvery;
  for(var i=0;i<S.longEvery;i++) dots+='<span class="'+(i<inCycle?"full":"")+'"></span>';
  document.getElementById("cycleDots").innerHTML=dots;
  var bt=document.getElementById("boundTask");
  var t=timer.taskId?getTask(timer.taskId):null;
  bt.innerHTML = t ? '当前任务：<b>'+esc(t.title)+'</b>' : "未绑定任务 — 可从任务卡上点「开始专注」";
  document.getElementById("unbindBtn").style.display = t ? "" : "none";
  document.getElementById("startPauseBtn").textContent = timer.running ? "暂停" : (remain<total ? "继续" : (timer.phase==="focus"?"开始专注":"开始休息"));
}
setInterval(tickTimer, 250);
function tickTimer(){
  // day rollover: refresh date-sensitive renders
  if(timer.lastDay!==todayStr()){ timer.lastDay=todayStr(); timer.cycle=0; renderTasks(); renderOverview(); renderReports(); document.getElementById("todayLine").textContent=prettyDate(todayStr()); }
  if(timer.running){
    if(Date.now()>=timer.endAt){ completePhase(); }
    else renderTimer();
  }
  checkReminders();
}
// Returning to the tab (or unlocking the screen) recomputes from the end
// timestamp immediately, so the display never drifts after backgrounding.
document.addEventListener("visibilitychange",function(){ if(!document.hidden) tickTimer(); });
window.addEventListener("focus",tickTimer);

document.getElementById("startPauseBtn").addEventListener("click",function(){ timer.running?pauseTimer():startTimer(); });
document.getElementById("resetBtn").addEventListener("click",resetTimer);
document.getElementById("abandonBtn").addEventListener("click",abandonTimer);
document.getElementById("unbindBtn").addEventListener("click",function(){ timer.taskId=null; renderTimer(); });
var fsBtnEl=document.getElementById("fsBtn");
if(fsBtnEl) fsBtnEl.addEventListener("click",function(){
  try{
    if(document.fullscreenElement) document.exitFullscreen();
    else if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  }catch(e){}
});
document.getElementById("phaseTabs").addEventListener("click",function(e){
  var b=e.target.closest("[data-phase]"); if(!b||b.dataset.phase===timer.phase) return;
  if(timer.running || timer.remainMs<phaseDur(timer.phase)){
    confirmModal("切换阶段？","当前计时进度将被重置。","切换",function(){ setPhase(b.dataset.phase,false); });
  } else setPhase(b.dataset.phase,false);
});

/* ---- settings ---- */
var settingsPanel=document.getElementById("settingsPanel");
document.getElementById("settingsToggle").addEventListener("click",function(){ settingsPanel.classList.toggle("open"); });
function fillSettings(){
  document.getElementById("sFocus").value=S.focusMin;
  document.getElementById("sShort").value=S.shortMin;
  document.getElementById("sLong").value=S.longMin;
  document.getElementById("sEvery").value=S.longEvery;
  document.getElementById("sAutoNext").checked=!!S.autoNext;
  document.getElementById("sAutoBreak").checked=!!S.autoBreak;
  document.getElementById("sNoBreak").checked=!!S.noBreak;
  document.getElementById("sSound").value=S.sound;
  document.getElementById("noiseVol").value=S.noiseVol;
  document.getElementById("goalInput").value=S.goal;
  document.querySelectorAll("#noiseRow .chip").forEach(function(c){ c.classList.toggle("on", c.dataset.noise===S.noise); });
}
function numSetting(id, key, min, max){
  var el=document.getElementById(id);
  el.addEventListener("input",function(){
    var v=parseInt(this.value,10);
    if(v>=min && v<=max){ S[key]=v; save(); if(!timer.running) timer.remainMs=phaseDur(timer.phase); renderTimer(); }
  });
  el.addEventListener("change",function(){
    var v=parseInt(this.value,10); if(!(v>=min)) v=min; if(v>max) v=max;
    S[key]=v; this.value=v; save();
    if(!timer.running) timer.remainMs=phaseDur(timer.phase);
    renderTimer();
  });
}
numSetting("sFocus","focusMin",1,180); numSetting("sShort","shortMin",1,60);
numSetting("sLong","longMin",1,90); numSetting("sEvery","longEvery",2,12);
[["sAutoNext","autoNext"],["sAutoBreak","autoBreak"],["sNoBreak","noBreak"]].forEach(function(pair){
  document.getElementById(pair[0]).addEventListener("change",function(){ S[pair[1]]=this.checked; save(); });
});
document.getElementById("sSound").addEventListener("change",function(){ S.sound=this.value; save(); });
document.getElementById("testSoundBtn").addEventListener("click",function(){ playSound(S.sound); if(S.sound==="none") toast("当前设置为静音"); });
document.getElementById("goalInput").addEventListener("input",function(){
  var v=parseInt(this.value,10);
  if(v>=1 && v<=40){ S.goal=v; save(); renderOverview(); }
});
document.getElementById("goalInput").addEventListener("change",function(){
  var v=parseInt(this.value,10); if(!(v>=1)) v=1; if(v>40) v=40;
  S.goal=v; this.value=v; save(); renderOverview();
});
;
"use strict";
/* ==================== overview ==================== */
var GOAL_C=2*Math.PI*44;
function renderOverview(){
  var today=todayStr();
  var p=pomosOn(today);
  var g=document.getElementById("goalFg");
  g.style.strokeDasharray=GOAL_C;
  g.style.strokeDashoffset=GOAL_C*(1-Math.min(1, S.goal>0?p/S.goal:0));
  document.getElementById("goalText").textContent=p+"/"+S.goal;
  document.getElementById("ovMinutes").textContent=minutesOn(today)+" 分钟";
  document.getElementById("ovStreak").textContent=streakDays()+" 天";
  document.getElementById("ovDoneTasks").textContent=completedTasksOn(today);
  document.getElementById("ovTotal").textContent=DB.records.length;
  // 任务流顶部统计头（与今日概览共用同一批口径）
  var headEst=0, headPending=0;
  DB.tasks.forEach(function(t){
    if(!taskMatchesView(t,"today")) return;
    headEst+=(t.est||1)*S.focusMin;
    if(!taskDoneOn(t,today)) headPending++;
  });
  var he=document.getElementById("headEst"); if(he) he.textContent=fmtMinutes(headEst);
  var hp=document.getElementById("headPending"); if(hp) hp.textContent=headPending;
  var hf=document.getElementById("headFocus"); if(hf) hf.textContent=fmtMinutes(minutesOn(today));
  var hd=document.getElementById("headDone"); if(hd) hd.textContent=completedTasksOn(today);
}

/* ==================== reports ==================== */
var chartDim="day";
document.getElementById("chartTabs").addEventListener("click",function(e){
  var b=e.target.closest("button"); if(!b) return;
  chartDim=b.dataset.dim;
  this.querySelectorAll("button").forEach(function(x){ x.classList.toggle("on", x===b); });
  renderChart();
});
function fmtMinutes(m){ return m>=60 ? (Math.round(m/6)/10)+" 小时" : m+" 分钟"; }
function renderReports(){
  var today=todayStr(), wr=weekRange();
  var now=new Date(); var monthStart=dstr(new Date(now.getFullYear(), now.getMonth(), 1));
  document.getElementById("stTodayDone").textContent=completedTasksOn(today);
  document.getElementById("stWeekDone").textContent=completedTasksBetween(wr[0], wr[1]);
  document.getElementById("stMonthDone").textContent=completedTasksBetween(monthStart, today);
  var wp=0, wm=0; DB.records.forEach(function(r){ if(r.date>=wr[0]&&r.date<=wr[1]){ wp++; wm+=r.minutes; } });
  document.getElementById("stWeekPomo").textContent=wp+" 个 / "+fmtMinutes(wm);
  var tp=document.getElementById("stTodayPomo");
  if(tp) tp.textContent=pomosOn(today)+" 个 / "+fmtMinutes(minutesOn(today));
  var totalMin=0; DB.records.forEach(function(r){ totalMin+=r.minutes; });
  var tt=document.getElementById("stTotalTime");
  if(tt) tt.textContent=fmtMinutes(totalMin);
  renderChart(); renderHeatmap(); renderHistory(); renderTimeline(); renderCatBars();
}
function renderTimeline(){
  var box=document.getElementById("todayTimeline");
  if(!box) return;
  var today=todayStr();
  var recs=DB.records.filter(function(r){ return r.date===today; }).slice().sort(function(a,b){ return a.ts-b.ts; });
  if(recs.length===0){ box.innerHTML='<div class="none-text">今天还没有专注记录 — 种下第一颗番茄后，这里会出现你的时间轴。</div>'; return; }
  var html='<div class="tl-track">';
  for(var h=6; h<24; h+=6){ html+='<div class="tl-gridline" style="left:'+(h/24*100)+'%"></div>'; }
  recs.forEach(function(r, i){
    var end=new Date(r.ts), start=new Date(r.ts - r.minutes*60000);
    var sMin=start.getHours()*60+start.getMinutes(), eMin=Math.min(1440, sMin+r.minutes);
    var tk=r.taskId?getTask(r.taskId):null;
    var cat=tk?tk.category:"other";
    var tip=pad2(start.getHours())+":"+pad2(start.getMinutes())+"–"+pad2(end.getHours())+":"+pad2(end.getMinutes())+" · "+(r.taskTitle||"自由专注")+" · "+r.minutes+" 分钟";
    html+='<div class="tl-block '+cat+'" title="'+esc(tip)+'" style="left:'+(sMin/1440*100)+'%;width:'+Math.max(0.7,(eMin-sMin)/1440*100)+'%;top:'+(7+(i%3)*17)+'px"></div>';
  });
  html+='</div><div class="tl-hours"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>';
  box.innerHTML=html;
}
function renderCatBars(){
  var box=document.getElementById("catBars");
  if(!box) return;
  var totals={work:{m:0,n:0}, study:{m:0,n:0}, other:{m:0,n:0}};
  DB.records.forEach(function(r){
    var tk=r.taskId?getTask(r.taskId):null;
    var cat=tk?tk.category:"other";
    totals[cat].m+=r.minutes; totals[cat].n++;
  });
  var max=0; ["work","study","other"].forEach(function(c){ max=Math.max(max, totals[c].m); });
  if(max===0){ box.innerHTML='<div class="none-text">还没有数据。完成番茄后，这里会按分类统计你的专注时长。</div>'; return; }
  box.innerHTML=["work","study","other"].map(function(cat){
    var t=totals[cat];
    return '<div class="cat-bar-row"><div class="cat-bar-head"><span class="n"><span class="cat-dot '+cat+'"></span>'+CAT_CN[cat]+'</span>'+
      '<span class="val">'+fmtMinutes(t.m)+' · '+t.n+' 个番茄</span></div>'+
      '<div class="cat-bar"><i class="'+cat+'" style="width:'+(t.m>0?Math.max(3, t.m/max*100):0)+'%"></i></div></div>';
  }).join("");
}
function periodData(){
  var items=[], i, a, b, label;
  var today=todayStr();
  if(chartDim==="day"){
    for(i=6;i>=0;i--){ var d=addDaysStr(today,-i); var dt=new Date(d+"T12:00:00");
      items.push({label:(dt.getMonth()+1)+"/"+dt.getDate(), sub:"周"+WEEK_CN[dt.getDay()], pomo:pomosOn(d), done:completedTasksOn(d)}); }
  }else if(chartDim==="week"){
    var wr=weekRange();
    for(i=5;i>=0;i--){ a=addDaysStr(wr[0],-7*i); b=addDaysStr(a,6);
      var p=0; DB.records.forEach(function(r){ if(r.date>=a&&r.date<=b) p++; });
      var da=new Date(a+"T12:00:00");
      items.push({label:(da.getMonth()+1)+"/"+da.getDate()+"周", sub:"", pomo:p, done:completedTasksBetween(a, b>today?today:b)}); }
  }else{
    var now=new Date();
    for(i=5;i>=0;i--){ var m=new Date(now.getFullYear(), now.getMonth()-i, 1);
      a=dstr(m); var end=new Date(m.getFullYear(), m.getMonth()+1, 0); b=dstr(end); if(b>today) b=today;
      var p2=0; DB.records.forEach(function(r){ if(r.date>=a&&r.date<=b) p2++; });
      items.push({label:(m.getMonth()+1)+"月", sub:String(m.getFullYear()), pomo:p2, done:completedTasksBetween(a,b)}); }
  }
  return items;
}
function renderChart(){
  var data=periodData();
  var max=1; data.forEach(function(d){ max=Math.max(max, d.pomo, d.done); });
  var W=720, H=230, padL=34, padB=34, padT=14, chartH=H-padB-padT, chartW=W-padL-8;
  var groupW=chartW/data.length, barW=Math.min(22, groupW/3.4);
  var y=function(v){ return padT+chartH-(v/max)*chartH; };
  var out='<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="番茄数与完成任务数图表" style="display:block">';
  for(var g=0; g<=4; g++){
    var gv=Math.round(max*g/4), gy=y(gv);
    out+='<line x1="'+padL+'" y1="'+gy+'" x2="'+(W-8)+'" y2="'+gy+'" stroke="var(--line2)" stroke-width="1"/>';
    out+='<text x="'+(padL-6)+'" y="'+(gy+4)+'" text-anchor="end" font-size="11" fill="var(--muted)">'+gv+'</text>';
  }
  data.forEach(function(d,i){
    var cx=padL+groupW*i+groupW/2;
    var h1=chartH*(d.pomo/max), h2=chartH*(d.done/max);
    out+='<rect x="'+(cx-barW-2)+'" y="'+(padT+chartH-h1)+'" width="'+barW+'" height="'+Math.max(h1, d.pomo?2:0)+'" rx="3" fill="var(--accent)"><title>番茄 '+d.pomo+'</title></rect>';
    out+='<rect x="'+(cx+2)+'" y="'+(padT+chartH-h2)+'" width="'+barW+'" height="'+Math.max(h2, d.done?2:0)+'" rx="3" fill="var(--teal)"><title>完成任务 '+d.done+'</title></rect>';
    if(d.pomo>0) out+='<text x="'+(cx-barW/2-2)+'" y="'+(padT+chartH-h1-5)+'" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--accent)">'+d.pomo+'</text>';
    if(d.done>0) out+='<text x="'+(cx+barW/2+2)+'" y="'+(padT+chartH-h2-5)+'" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--teal)">'+d.done+'</text>';
    out+='<text x="'+cx+'" y="'+(padT+chartH+18)+'" text-anchor="middle" font-size="12" fill="var(--ink2)">'+esc(d.label)+'</text>';
    if(d.sub) out+='<text x="'+cx+'" y="'+(padT+chartH+32)+'" text-anchor="middle" font-size="10.5" fill="var(--muted)">'+esc(d.sub)+'</text>';
  });
  out+='</svg>';
  if(data.every(function(d){ return d.pomo===0 && d.done===0; }))
    out+='<div class="none-text" style="text-align:center">暂无数据 — 完成第一个番茄后，这里会出现你的专注曲线。</div>';
  document.getElementById("chartBox").innerHTML=out;
}
function heatLevel(n){ return n<=0?0 : n<=2?1 : n<=4?2 : n<=7?3 : 4; }
function renderHeatmap(){
  var today=new Date(); var dow=(today.getDay()+6)%7;
  var lastMonday=new Date(today); lastMonday.setDate(today.getDate()-dow);
  var start=new Date(lastMonday); start.setDate(lastMonday.getDate()-7*14);
  var grid=document.getElementById("heatGrid"), months=document.getElementById("heatMonths");
  var ghtml="", mhtml=""; var lastMonth=-1;
  for(var w=0; w<15; w++){
    var colStart=new Date(start); colStart.setDate(start.getDate()+w*7);
    if(colStart.getMonth()!==lastMonth){ lastMonth=colStart.getMonth(); mhtml+='<span style="width:16px;flex:none">'+(lastMonth+1)+'月</span>'; }
    else mhtml+='<span style="width:16px;flex:none"></span>';
    ghtml+='<div class="heat-col">';
    for(var d=0; d<7; d++){
      var day=new Date(colStart); day.setDate(colStart.getDate()+d);
      var ds=dstr(day), n=pomosOn(ds), future=ds>todayStr();
      ghtml+='<div class="heat-cell l'+heatLevel(n)+(future?" future":"")+'" title="'+ds+" · "+n+' 个番茄"></div>';
    }
    ghtml+='</div>';
  }
  grid.innerHTML=ghtml; months.innerHTML=mhtml;
}
function renderHistory(){
  var box=document.getElementById("historyList");
  if(DB.records.length===0){ box.innerHTML='<div class="none-text">还没有专注记录。完成第一个番茄后会记在这里。</div>'; return; }
  var recs=DB.records.slice().reverse().slice(0,30);
  box.innerHTML=recs.map(function(r){
    var d=new Date(r.ts);
    var when=(r.date===todayStr()?"今天":prettyDate(r.date))+" "+pad2(d.getHours())+":"+pad2(d.getMinutes());
    return '<div class="hist-row"><span class="when">'+when+'</span><span class="what">🍅 '+esc(r.taskTitle||"自由专注")+'</span><span class="mins">'+r.minutes+' 分钟</span></div>';
  }).join("");
}

/* ==================== reminders ==================== */
var remindedToday={}; // taskId+date -> true
var reminderTaskId=null;
function checkReminders(){
  var now=new Date(), hm=pad2(now.getHours())+":"+pad2(now.getMinutes()), today=todayStr();
  DB.tasks.forEach(function(t){
    if(!t.reminder || t.reminder!==hm) return;
    if(t.repeat!=="daily" && t.date!==today) return;
    if(taskDoneOn(t,today)) return;
    var key=t.id+"@"+today+"@"+hm;
    if(remindedToday[key]) return;
    remindedToday[key]=true; reminderTaskId=t.id;
    document.getElementById("reminderText").textContent="提醒时间到：「"+t.title+"」该开始了。";
    document.getElementById("reminderBar").classList.add("show");
    playSound(S.sound==="none"?"bell":S.sound);
  });
}
document.getElementById("reminderDismiss").addEventListener("click",function(){ document.getElementById("reminderBar").classList.remove("show"); });
document.getElementById("reminderGo").addEventListener("click",function(){
  document.getElementById("reminderBar").classList.remove("show");
  if(reminderTaskId){ bindTask(reminderTaskId, true); window.scrollTo({top:0, behavior:"smooth"}); }
});

/* ==================== data export / import / clear ==================== */
document.getElementById("exportBtn").addEventListener("click",function(){
  var payload=JSON.stringify({ app:"focuslist-offline", version:1, exportedAt:new Date().toISOString(), data:DB }, null, 2);
  var blob=new Blob([payload], {type:"application/json"});
  var a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="专注清单备份-"+todayStr()+".json";
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 400);
  toast("备份文件已下载，请妥善保管");
});
document.getElementById("importBtn").addEventListener("click",function(){ document.getElementById("importFile").click(); });
document.getElementById("importFile").addEventListener("change",function(){
  var f=this.files&&this.files[0]; this.value="";
  if(!f) return;
  var reader=new FileReader();
  reader.onload=function(){
    try{
      var parsed=JSON.parse(reader.result);
      var d=parsed.data||parsed;
      if(!d || !Array.isArray(d.tasks) || !Array.isArray(d.records)) throw new Error("bad");
      d.settings=Object.assign({}, DEFAULT_SETTINGS, d.settings||{});
      confirmModal("导入数据？","导入会覆盖当前全部任务、记录和设置，确定继续吗？","导入并覆盖",function(){
        DB=d; S=DB.settings; save();
        fillSettings(); resetTimer(); renderTasks(); renderOverview(); renderReports(); renderTimer();
        toast("导入成功，数据已恢复");
      });
    }catch(e){ confirmModal("导入失败","这个文件不是有效的专注清单备份 JSON。","知道了",function(){}); }
  };
  reader.readAsText(f);
});
document.getElementById("clearBtn").addEventListener("click",function(){
  confirmModal("清空全部数据？","所有任务、专注记录和设置都会被删除且无法恢复。建议先导出一份备份。","清空全部",function(){
    DB=defaultDB(); S=DB.settings;
    try{ localStorage.removeItem(LS_KEY); }catch(e){}
    save();
    timer.taskId=null; timer.cycle=0; fillSettings(); resetTimer();
    renderTasks(); renderOverview(); renderReports(); renderTimer();
    toast("全部数据已清空");
  });
});

/* ==================== init ==================== */
document.getElementById("todayLine").textContent=prettyDate(todayStr())+" · 用番茄工作法，一件一件专注完成";
fillSettings();
renderTasks();
renderTimer();
renderOverview();
renderReports();