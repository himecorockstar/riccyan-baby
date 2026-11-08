// === storage ===
'use strict';
// storage: stable function declarations, with explicit dependencies.

function validateBackupFromAdministration(s) {
  validateBackupFromUsability(s);
  const photoIds=s.records.filter(r=>r.type==='photo').map(r=>r.id);
  if(photoIds.some(id=>!/^[-A-Za-z0-9_]{1,80}$/.test(id)))throw Error('旧写真の識別子が不正です')
}

function validateBackupFromAlarms(s) {
  validateBackupFromFolders(s);
  if(s.alarms!==undefined){
    if(!Array.isArray(s.alarms)||s.alarms.length>10)throw Error('アラームは10件までです');
    const ids=new Set();
    for(const a of s.alarms){
      if(!a||typeof a.id!=='string'||ids.has(a.id)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)||typeof a.text!=='string'||!a.text.trim()||a.text.length>200||typeof a.enabled!=='boolean'||typeof a.repeat!=='boolean'||!Number.isFinite(a.nextAt)||a.nextAt<0||!a.voice||!Number.isFinite(a.voice.seconds)||a.voice.seconds<0||a.voice.seconds>10||typeof a.voice.data!=='string'||a.voice.data.length>2000000||!/^data:audio\/[a-zA-Z0-9.+;= -]+;base64,[A-Za-z0-9+/=]+$/.test(a.voice.data))throw Error('音声アラームの形式が不正です');
      ids.add(a.id)
    }
  }
}

function persistFromApp() {
  const snapshot=structuredClone(state);
  saveQueue=saveQueue.catch(()=>{
  }).then(()=>new Promise((resolve,reject)=>{
    const t=db.transaction('data','readwrite');
    t.objectStore('data').put(snapshot,'state');
    t.oncomplete=resolve;
    t.onerror=()=>reject(t.error);
    t.onabort=()=>reject(t.error||Error('保存中断'))
  }));
  saveQueue.catch(()=>notify('保存できません。空き容量を確認し、バックアップしてください。'));
  return saveQueue
}

function validateBackupFromApp(s) {
  if(!s||s.app!=='ritchan-baby-v1'||s.version!==1||!Array.isArray(s.records)||!s.notes||typeof s.notes!=='object'||!Array.isArray(s.words)||!s.profile||!Array.isArray(s.tasks)||typeof s.contacts!=='string')throw Error('このアプリのバックアップではありません');
  const types=['milk','breast','food','diaper','sleep','growth','mama','photo'],ids=new Set();
  for(const r of s.records){
    if(!r||!types.includes(r.type)||typeof r.id!=='string'||ids.has(r.id)||!Number.isFinite(Date.parse(r.at)))throw Error('記録の形式が不正です');
    ids.add(r.id);
    if(r.type==='sleep'&&(!['baby','mama'].includes(r.who)||!Number.isFinite(Date.parse(r.end))||Date.parse(r.end)<=Date.parse(r.at)))throw Error('睡眠記録が不正です');
    if(r.type==='milk'&&(!Number.isFinite(r.amount)||r.amount<=0))throw Error('量が不正です');
    if(r.type==='growth'&&[r.height,r.weight].some(v=>v!==null&&(!Number.isFinite(v)||v<=0)))throw Error('測定値が不正です');
    if(r.type==='photo'&&(typeof r.image!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.image)))throw Error('写真形式が不正です')
  }
  if(s.words.some(x=>typeof x!=='string')||Object.values(s.notes).some(x=>typeof x!=='string')||s.tasks.some(x=>!x||typeof x.id!=='string'||typeof x.text!=='string'||typeof x.due!=='string')||typeof s.profile.birth!=='string'||typeof s.profile.due!=='string'||typeof s.profile.stage!=='string')throw Error('設定の形式が不正です')
}

function cancelErase() {
  clearInterval(eraseTicker);
  eraseTicker=null;
  eraseGate?.cancel();
  eraseGate=null;
  $('#erase-button')?.classList.remove('armed');
  if($('#erase-button'))$('#erase-button').textContent='全データ削除：10秒間押し続ける';
  if($('#erase-status'))$('#erase-status').textContent=''
}

function prepareForErase() {
  dataWiping=true;
  dataEpoch++;
  const safely=fn=>{
    try{
      fn()
    }catch(e){
    }
  };
  safely(stopGallery);
  safely(stopPreview);
  for(const c of weatherControllers)safely(()=>c.abort());
  weatherControllers.clear();
  safely(cancelErase);
  safely(leaveAlarm);
  safely(releaseCamera);
  safely(clearShot);
  safely(stopReceiptCamera);
  safely(haltPlayer);
  safely(()=>{
    if(stream){
      stream.getTracks().forEach(t=>t.stop());
      stream=null
    }
  });
  safely(()=>{
    clearInterval(voiceTimer);
    if(voiceRecorder){
      voiceRecorder.onstop=null;
      voiceRecorder.ondataavailable=null;
      if(voiceRecorder.state==='recording')voiceRecorder.stop()
    }
    voiceMedia?.getTracks().forEach(t=>t.stop());
    voiceMedia=null;
    voiceRecorder=null;
    voiceBusy=false
  });
  safely(()=>{
    if(window.speechSynthesis)speechSynthesis.cancel()
  })
}

function handleOtherReset() {
  prepareForErase();
  db?.close();
  state=null;
  $('#dialog').close();
  const main=document.querySelector('main');
  main.inert=true;
  main.style.visibility='hidden';
  if(!$('#reset-elsewhere')){
    const notice=document.createElement('p');
    notice.id='reset-elsewhere';
    notice.className='reset-notice';
    notice.textContent='別の画面で全データ削除が開始されました。このタブを閉じてください。';
    document.body.append(notice)
  }
}

function addErasePanel() {
  const box=document.createElement('section');
  box.className='erase-panel';
  box.innerHTML='<h3>端末を手放すときの初期化</h3><p>このアプリの記録・写真館・録音・電話帳・設定をすべて削除します。10秒間押し続けると赤く点滅し、さらに10秒後に削除します。点滅中は取り消せます。復元には別に保存したバックアップが必要です。</p><p>スマホ内の元写真、ダウンロードしたバックアップ、別ブラウザのデータは削除しません。端末全体の完全消去を保証する機能ではありません。</p><button type="button" id="erase-button">全データ削除：10秒間押し続ける</button><button type="button" id="erase-cancel">削除を取り消す</button><p id="erase-status" role="status"></p>';
  $('#dialog').append(box);
  const button=$('#erase-button');
  const start=()=>{
    if(dataWiping||eraseGate?.phase==='countdown')return;
    cancelErase();
    eraseGate=new EraseGate();
    eraseGate.start(performance.now());
    eraseTicker=setInterval(()=>{
      if(!eraseGate)return;
      if(!button.isConnected||!$('#dialog').open||document.hidden){
        cancelErase();
        return
      }
      const now=performance.now(),done=eraseGate.tick(now,true);
      button.classList.toggle('armed',eraseGate.phase==='countdown');
      button.textContent=eraseGate.phase==='holding'?'押したまま…あと '+eraseGate.remaining(now)+'秒':'削除まで あと '+eraseGate.remaining(now)+'秒';
      $('#erase-status').textContent=eraseGate.phase==='countdown'?'指を離して構いません。中止する場合は「削除を取り消す」。':'';
      if(done)eraseAllData()
    },100)
  };
  const release=()=>{
    if(eraseGate?.phase==='holding')cancelErase()
  };
  button.onpointerdown=e=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    e.preventDefault();
    button.setPointerCapture?.(e.pointerId);
    start()
  };
  button.onpointerup=release;
  button.onpointercancel=()=>cancelErase();
  button.onlostpointercapture=release;
  button.oncontextmenu=e=>e.preventDefault();
  button.onkeydown=e=>{
    if((e.key===' '||e.key==='Enter')&&!e.repeat){
      e.preventDefault();
      start()
    }
  };
  button.onkeyup=e=>{
    if(e.key===' '||e.key==='Enter'){
      e.preventDefault();
      release()
    }
  };
  button.onblur=release;
  $('#erase-cancel').onclick=cancelErase
}

function persist() {
  let changed=false;
  try{
    changed=(localStorage.getItem(RESET_KEY)||'')!==resetMark
  }catch(e){
  }
  if(dataWiping||changed)return Promise.reject(Error('初期化中です。画面を開き直してください'));
  return persistFromUsability()
}

function validateBackupFromClinic(s) {
  if(!s||!Array.isArray(s.records))throw Error('記録が不正です');
  validateBackupFromFamily({...s,records:s.records.filter(r=>r?.type!=='morning')});
  const ids=new Set();
  for(const r of s.records){
    if(!r||typeof r.id!=='string'||!/^[-A-Za-z0-9_]{1,80}$/.test(r.id)||ids.has(r.id))throw Error('記録IDが不正です');
    ids.add(r.id);
    if(r.type==='morning'&&(!Number.isFinite(Date.parse(r.at))||r.temperature!==null&&(!Number.isFinite(r.temperature)||r.temperature<20||r.temperature>50)||!['',...FACES].includes(r.face)||!['',...MOODS].includes(r.mood)||typeof r.memo!=='string'))throw Error('朝の観察記録が不正です')
  }
  if(s.gallery!==undefined&&(!Array.isArray(s.gallery)||s.gallery.length>10||s.gallery.some(r=>!r||typeof r.id!=='string'||typeof r.name!=='string'||typeof r.data!=='string'||r.data.length>15000000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.data))))throw Error('写真館の形式が不正です');
  const p=s.profile.weatherPlace;
  if(p!==undefined&&(!p||typeof p.label!=='string'||typeof p.prefecture!=='string'||!Number.isFinite(p.latitude)||Math.abs(p.latitude)>90||!Number.isFinite(p.longitude)||Math.abs(p.longitude)>180))throw Error('地域設定が不正です');
  if(s.weather!==undefined){
    if(!s.weather||typeof s.weather!=='object'||Array.isArray(s.weather))throw Error('天気の形式が不正です');
    for(const [d,w]of Object.entries(s.weather))if(!compareDate(d)||!w||w.date!==d||!Number.isFinite(w.temperature)||!Number.isFinite(w.humidity)||w.humidity<0||w.humidity>100||!Number.isInteger(w.code)||typeof w.text!=='string'||typeof w.provisional!=='boolean'||!Number.isFinite(Date.parse(w.fetchedAt))||!w.place||typeof w.place.label!=='string'||!Number.isFinite(w.place.latitude)||!Number.isFinite(w.place.longitude)||typeof w.method!=='string')throw Error('天気記録が不正です')
  }
}

function validateBackupFromDailyRecords(s) {
  validateBackupFromClinic(s);
  for(const r of s.records)if(r.type==='breast'){
    if(r.estimateMl!==undefined&&r.estimateMl!==null&&(!Number.isFinite(r.estimateMl)||r.estimateMl<=0)||r.feltAmount!==undefined&&!['',...FELT_AMOUNTS].includes(r.feltAmount))throw Error('母乳の目安記録が不正です')
  }
}

function validateBackupFromExtra(s) {
  const types=['mamagrowth'];
  const filtered={...s,records:Array.isArray(s?.records)?s.records.filter(r=>!types.includes(r?.type)):s?.records};
  validateBackupFromApp(filtered);
  for(const r of (s.records||[]).filter(x=>types.includes(x.type))){
    if(typeof r.id!=='string'||!Number.isFinite(Date.parse(r.at))||[r.height,r.weight].some(n=>n!==null&&(!Number.isFinite(n)||n<=0)))throw Error('ママの測定記録が不正です')
  }
  if(s.vaccines!==undefined&&(!Array.isArray(s.vaccines)||s.vaccines.some(x=>!x||typeof x.id!=='string'||typeof x.name!=='string'||!['未定','予定','打たない','接種済み'].includes(x.status)||typeof x.date!=='string'||typeof x.time!=='string'||typeof x.hospital!=='string'||typeof x.memo!=='string'||x.cost!==null&&(!Number.isFinite(x.cost)||x.cost<0))))throw Error('予防接種の形式が不正です');
  if(s.receipts!==undefined&&(!Array.isArray(s.receipts)||s.receipts.some(x=>!x||(typeof x.id!=='string'||!/^[-A-Za-z0-9_]{1,80}$/.test(x.id))||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(x.image)||typeof x.date!=='string'||['shop','items','category','memo'].some(k=>typeof x[k]!=='string')||x.amount!==null&&(!Number.isFinite(x.amount)||x.amount<0))))throw Error('レシートの形式が不正です');
  if(s.voice!==undefined&&s.voice!==null&&(!/^data:audio\/[a-zA-Z0-9.+;= -]+;base64,[A-Za-z0-9+/=]+$/.test(s.voice.data)||!Number.isFinite(s.voice.seconds)||s.voice.seconds<0||s.voice.seconds>300))throw Error('音声の形式が不正です')
}

function validateBackupFromFamily(s) {
  validateBackupFromAlarms(s);
  if(s.phoneBook!==undefined&&(!Array.isArray(s.phoneBook)||s.phoneBook.length>10||s.phoneBook.some(p=>p!==null&&(!p||typeof p.name!=='string'||typeof p.phone!=='string'||typeof p.memo!=='string'||p.name.length>60||p.phone.length>40||!/^\+?[0-9()\-\s*#]{3,40}$/.test(p.phone)))))throw Error('電話帳の形式が不正です');
  if(s.profile.coverPhoto&&(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s.profile.coverPhoto)||s.profile.coverPhoto.length>15000000))throw Error('TOP写真の形式が不正です');
  for(const r of s.records)if(r.colorHex!==undefined&&r.colorHex!==''&&!/^#[0-9a-f]{6}$/i.test(r.colorHex))throw Error('観察色の形式が不正です')
}

function validateBackupFromFolders(s) {
  validateBackupFromAdministration(s);
  for(const r of s.records.filter(r=>r.type==='diaper'))for(const k of ['amount','color','texture'])if(r[k]!==undefined&&typeof r[k]!=='string')throw Error('排泄記録の形式が不正です');
  if(s.chartSettings!==undefined){
    if(!s.chartSettings||typeof s.chartSettings!=='object'||Array.isArray(s.chartSettings))throw Error('グラフ設定が不正です');
    for(const [k,v]of Object.entries(s.chartSettings))if(!leaves[k]||!v||!['7','30','90'].includes(v.range)||!['線','棒','点'].includes(v.type)||!Object.hasOwn(CHART_COLORS,v.color))throw Error('グラフ設定が不正です')
  }
}

function resetDraftBaseline(f) {
  const c=draftContexts.get(f);
  if(c)c.baseline=formFingerprint(f)
}

function validateBackup(s) {
  validateBackupFromDailyRecords(s);
  if(s.galleryLastId!==undefined&&s.galleryLastId!==null&&typeof s.galleryLastId!=='string')throw Error('最後の写真の指定が不正です');
  if(s.alarmSettings!==undefined){
    const p=s.alarmSettings;
    if(!p||!Number.isInteger(p.snoozeMinutes)||p.snoozeMinutes<1||p.snoozeMinutes>60||!Number.isInteger(p.ringSeconds)||p.ringSeconds<1||p.ringSeconds>10)throw Error('アラーム共通設定が不正です')
  }
}

function resetEmptyState() {
  return {...initial(),gallery:[],galleryLastId:null,meta:{revision:0,lastExportAt:'',lastExportRevision:0,lastExportItems:[],gallerySeeded:true}}
}

function readResetState() {
  return new Promise((resolve,reject)=>{
    let tx;
    try{
      tx=db.transaction('data','readonly');
      const req=tx.objectStore('data').get('state');
      req.onsuccess=()=>resolve(req.result||initial());
      req.onerror=()=>reject(req.error);
      tx.onabort=()=>reject(tx.error||Error('読み込み中断'))
    }catch(e){
      reject(e)
    }
  })
}

function writeResetState(clean) {
  return new Promise((resolve,reject)=>{
    let tx,timer;
    try{
      tx=db.transaction('data','readwrite');
      const store=tx.objectStore('data');
      store.clear();
      store.put(clean,'state');
      timer=setTimeout(()=>{
        try{
          tx.abort()
        }catch(e){
        }
      },12000);
      tx.oncomplete=()=>{
        clearTimeout(timer);
        resolve()
      };
      tx.onabort=()=>{
        clearTimeout(timer);
        reject(tx.error||Error('削除を中断しました'))
      };
      tx.onerror=()=>{
      };
    }catch(e){
      clearTimeout(timer);
      reject(e)
    }
  })
}

function resetWait(p, ms=12000) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('保存の終了を確認できませんでした')),ms);
    p.then(v=>{
      clearTimeout(timer);
      resolve(v)
    },e=>{
      clearTimeout(timer);
      reject(e)
    })
  })
}

function releaseResetMarker() {
  resetMark='';
  try{
    localStorage.removeItem(RESET_KEY)
  }catch(e){
  }
}

function resetRecovery(message) {
  modalLayers=[];
  const d=$('#dialog');
  if(d.open)d.close();
  d.innerHTML='';
  modal('<h2>画面を開き直してください</h2><p>'+esc(message)+'</p><p>ほかのタブでこのアプリを開いている場合は閉じてください。ブラウザの保存データは消さないでください。</p><button type="button" id="reset-reload" class="primary">アプリを再読み込み</button>');
  $('#reset-reload').onclick=()=>location.reload()
}

function backupOverview() {
  ensureUX();
  ensureClinic();
  const has=!!state.meta.lastExportAt,items=backupItems(),old=new Set(state.meta.lastExportItems||[]),added=items.filter(k=>!old.has(k)).length;
  const registered=(state.phoneBook||[]).filter(r=>r?.name||r?.phone||r?.number).length;

  return '<section class="backup-overview"><h3>現在、アプリ内に保存しているデータ</h3><p><strong>健康記録：'+state.records.length+'件 ／ 写真館：'+state.gallery.length+'枚</strong><br>声だけメモ：'+(state.voice?1:0)+'件 ／ 音声アラーム：'+(state.alarms||[]).length+'件<br>電話帳：'+registered+'件 ／ 日別メモ：'+Object.values(state.notes||{}).filter(n=>String(n).trim()).length+'日<br>予防接種：'+(state.vaccines||[]).length+'件 ／ 予定：'+(state.tasks||[]).length+'件</p><h3>バックアップの出力履歴</h3><p>最後の出力操作：'+(has?esc(new Date(state.meta.lastExportAt).toLocaleString('ja-JP')):'未実施')+'</p><p>'+(has?'前回の出力後に追加した記録：':'まだ出力していない記録：')+added+'件<br>編集などを含む更新：'+Math.max(0,state.meta.revision-state.meta.lastExportRevision)+'回<br>写真・音声を含むデータ：約'+(new Blob([JSON.stringify(state)]).size/1024/1024).toFixed(2)+' MB</p><p class="hint">追加件数は健康記録・予防接種・アラーム等です。写真やメモなどの変更は更新回数に含みます。「未実施」は出力履歴がない意味で、データ削除済みの意味ではありません。端末へのファイル保存完了は確認できません。</p></section>'
}

async function seedGiftGallery() {
  if(!state||dataWiping||defaultGalleryBusy||state.meta?.gallerySeeded)return;
  ensureUX();
  ensureClinic();
  if(state.gallery.length){
    state.meta.gallerySeeded=true;
    try{
      await persist()
    }catch(e){
      delete state.meta.gallerySeeded
    }
    return
  }
  defaultGalleryBusy=true;
  const epoch=dataEpoch,owner=state;
  try{
    const photos=[];
    for(let i=0;i<DEFAULT_GALLERY.length;i++){
      const [file,name]=DEFAULT_GALLERY[i];
      const response=await fetch('gallery-defaults/'+file);
      if(!response.ok)throw Error('写真の取得に失敗');
      const blob=await response.blob(),data=await imageFile(new File([blob],file,{type:blob.type}),1600);
      if(dataWiping||epoch!==dataEpoch||state!==owner)return;
      photos.push({id:'gift-photo-'+(i+1),name,data})
    }
    if(state.gallery.length||state.meta.gallerySeeded)return;
    const old=state.gallery,oldId=state.galleryLastId;
    state.gallery=photos;
    state.galleryLastId=photos[0].id;
    state.meta.gallerySeeded=true;
    try{
      await persist()
    }catch(e){
      if(epoch===dataEpoch&&state===owner){
        state.gallery=old;
        state.galleryLastId=oldId;
        delete state.meta.gallerySeeded
      }
      throw e
    }
    if(epoch===dataEpoch&&!dataWiping&&state===owner&&page==='gallery')render()
  }catch(e){
    if(!dataWiping&&epoch===dataEpoch)notify('初期写真を準備できませんでした。通信を確認し、写真館を開き直してください。')
  }finally{
    defaultGalleryBusy=false
  }
}

async function eraseAllData() {
  if(resetInProgress)return;
  resetInProgress=true;
  let drained=false,committed=false;
  try{
    prepareForErase();
    $('#dialog').querySelectorAll('button,input').forEach(b=>b.disabled=true);
    const message=$('#erase-status');
    if(message)message.textContent='削除しています。完了までお待ちください。';
    await resetWait(saveQueue.catch(()=>{
    }));
    drained=true;
    resetMark=Date.now()+'-'+Math.random();
    try{
      localStorage.setItem(RESET_KEY,resetMark)
    }catch(e){
    }
    try{
      resetChannel?.postMessage('reset')
    }catch(e){
    }
    const clean=resetEmptyState();
    await writeResetState(clean);
    committed=true;
    const stored=await resetWait(readResetState());
    if(JSON.stringify(stored)!==JSON.stringify(clean))throw Error('削除後の確認が一致しませんでした');
    state=stored;
    observedState=null;
    undoAction=null;
    quickBusy=false;
    leaveBusy=false;
    leaveBypass=false;
    modalLayers=[];
    galleryIndex=0;
    galleryAuto=false;
    weatherBusy.clear();
    weatherTried.clear();
    date=day(new Date());
    page='home';
    reportViewing=false;
    doctorDay=false;
    saveQueue=Promise.resolve();
    releaseResetMarker();
    dataWiping=false;
    const d=$('#dialog');
    if(d.open)d.close();
    d.innerHTML='';
    render();
    modal('<h2>全データを削除しました</h2><p>健康記録・写真・録音・電話帳・バックアップ履歴を初期化しました。</p><p><strong>保存中の健康記録：0件 ／ 写真館：0枚</strong></p><button type="button" id="reset-done" class="primary">TOPへ戻る</button><p class="hint">元の写真や、保存済みのバックアップファイルは消しません。</p>');
    $('#reset-done').onclick=()=>goHome();
  }catch(e){
    if(drained&&!committed){
      try{
        state=await resetWait(readResetState());
        observedState=null;
        saveQueue=Promise.resolve();
        releaseResetMarker();
        dataWiping=false;
        modalLayers=[];
        const d=$('#dialog');
        if(d.open)d.close();
        d.innerHTML='';
        page='home';
        render();
        modal('<h2>削除できませんでした</h2><p>削除は完了していません。保存領域を読み直しました。現在の記録はバックアップ画面で確認できます。</p><button type="button" id="reset-failed-home">TOPへ戻る</button><button type="button" id="reset-reload">アプリを再読み込み</button>');
        $('#reset-failed-home').onclick=()=>goHome();
        $('#reset-reload').onclick=()=>location.reload();
      }catch(readError){
        resetRecovery('削除結果を確認できませんでした。再読み込みして記録をご確認ください。')
      }
    }else resetRecovery('処理の終了を確認できませんでした。再読み込みして記録をご確認ください。')
  }finally{
    resetInProgress=false
  }
}

function contentSignature() {
  return JSON.stringify({records:state.records,notes:state.notes,words:state.words,profile:state.profile,tasks:state.tasks,contacts:state.contacts,vaccines:state.vaccines,receipts:state.receipts,voice:state.voice,activeSleep:state.activeSleep,alarms:state.alarms,chartSettings:state.chartSettings,phoneBook:state.phoneBook,gallery:state.gallery,galleryLastId:state.galleryLastId,alarmSettings:state.alarmSettings,weather:state.weather})
}

function backupItems() {
  return [...(state.alarms||[]).map(r=>'alarm:'+r.id),...state.records.map(r=>'record:'+r.id),...state.receipts.map(r=>'receipt:'+r.id),...state.vaccines.map(r=>'vaccine:'+r.id),...Object.entries(state.activeSleep).filter(([,r])=>r).map(([k,r])=>'sleep:'+k+':'+r.id)]
}

async function backupExport() {
  await persist();
  const items=backupItems(),at=new Date().toISOString();
  const copy=structuredClone(state);
  copy.meta.lastExportAt=at;
  copy.meta.lastExportRevision=state.meta.revision;
  copy.meta.lastExportItems=items;
  download('ritchan-baby-backup-'+day(new Date())+'.json',JSON.stringify(copy));
  state.meta.lastExportAt=at;
  state.meta.lastExportRevision=state.meta.revision;
  state.meta.lastExportItems=items;
  await persist();
  notify('出力操作を行いました。ファイルが保存されたか確認してください');
}

function persistFromUsability() {
  ensureUX();
  const next=contentSignature();
  if(next!==observedState){
    state.meta.revision++;
    observedState=next
  }
  return persistFromApp()
}

function validateBackupFromUsability(s) {
  validateBackupFromExtra(s);
  if(s.profile.birthTime!==undefined&&s.profile.birthTime!==''&&!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s.profile.birthTime))throw Error('出生時刻が不正です');
  for(const d of [s.profile.birth,s.profile.due])if(d!==''&&!compareDate(d))throw Error('設定の日付が不正です');
  for(const t of s.tasks)if(!/^[-A-Za-z0-9_]{1,80}$/.test(t.id)||t.due!==''&&!compareDate(t.due))throw Error('予定の形式が不正です');
  for(const v of s.vaccines||[])if(!/^[-A-Za-z0-9_]{1,80}$/.test(v.id)||v.date!==''&&!compareDate(v.date)||v.time!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))throw Error('予防接種の日付・時刻が不正です');
  for(const r of s.receipts||[])if(r.date!==''&&!compareDate(r.date))throw Error('レシートの日付が不正です');
  const ids=new Set();
  for(const r of s.records){
    if(typeof r.id!=='string'||!/^[-A-Za-z0-9_]{1,80}$/.test(r.id))throw Error('記録IDの形式が不正です');
    if(ids.has(r.id))throw Error('記録IDが重複しています');
    ids.add(r.id)
  }
  if(s.activeSleep!==undefined){
    if(!s.activeSleep||typeof s.activeSleep!=='object'||Array.isArray(s.activeSleep))throw Error('睡眠開始の形式が不正です');
    for(const [who,r]of Object.entries(s.activeSleep)){
      if(!['baby','mama'].includes(who)||!r||typeof r.id!=='string'||!Number.isFinite(Date.parse(r.at)))throw Error('睡眠開始の形式が不正です')
    }
  }
  if(s.prefs!==undefined){
    if(!s.prefs||typeof s.prefs!=='object'||Array.isArray(s.prefs)||!Array.isArray(s.prefs.milkAmounts)||s.prefs.milkAmounts.length>8||s.prefs.milkAmounts.some(n=>!Number.isFinite(n)||n<=0||n>1000))throw Error('表示設定の形式が不正です')
  }
  for(const r of s.receipts||[]){
    if(r.mixed!==undefined&&typeof r.mixed!=='boolean'||r.childAmount!==undefined&&r.childAmount!==null&&(!Number.isFinite(r.childAmount)||r.childAmount<0)||r.mixed&&r.childAmount!==null&&r.childAmount!==undefined&&r.amount!==null&&r.childAmount>r.amount)throw Error('レシートの子供分金額が不正です')
  }
  if(s.meta!==undefined&&(!s.meta||!Number.isSafeInteger(s.meta.revision)||s.meta.revision<0||!Number.isSafeInteger(s.meta.lastExportRevision)||s.meta.lastExportRevision<0||typeof s.meta.lastExportAt!=='string'||s.meta.lastExportItems!==undefined&&(!Array.isArray(s.meta.lastExportItems)||s.meta.lastExportItems.some(x=>typeof x!=='string'))))throw Error('バックアップ履歴の形式が不正です')
}

// === navigation ===
'use strict';
// navigation: stable function declarations, with explicit dependencies.

function wireNavigation(root=document) {
  root.querySelectorAll('[data-back]').forEach(b=>b.onclick=backPage);
  root.querySelectorAll('[data-home]').forEach(b=>b.onclick=()=>goHome());
  root.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go))
}

function closeFromApp() {
  if(stream){
    stream.getTracks().forEach(t=>t.stop());
    stream=null
  }
  $('#dialog').close()
}

function modalFromClarity(html) {
  modalFromFolders(html);
  const d=$('#dialog');
  d.querySelectorAll('button').forEach(b=>{
    if(b.matches('[data-home]'))b.textContent='TOP';else if(b.id!=='modal-back'&&/^(戻る|前のページへ|TOPへ?)$/.test(b.textContent.trim()))b.hidden=true
  });
}

function modalFromClinic(html) {
  cancelErase();
  stopPreview();
  modalFromFamily(html);
  if($('#backup-export'))addErasePanel()
}

function closeFromClinic() {
  if(dataWiping)return;
  cancelErase();
  stopPreview();
  closeFromFolders()
}

function goFromClinic(target) {
  if(dataWiping)return;
  leaveClinic();
  goFromPractical(target);
  if(page==='gallery')document.documentElement.requestFullscreen?.().catch(()=>{
  })
}

function goHomeFromClinic() {
  if(dataWiping)return;
  leaveClinic();
  goHomeFromPractical()
}

function parentFolderFromClinic(p) {
  return ['health','gallery'].includes(p)?'home':parentFolderFromFamily(p)
}

function modalFromDailyRecords(html) {
  modalFromClinic(html);
  addNowButtons($('#dialog'))
}

function parentFolderFromFamily(p) {
  return p==='poop-colours'?'leaf:poop':p==='pee-colours'?'leaf:pee':p==='phonebook'?'home':parentFolderFromPractical(p)
}

function modalFromFamily(html) {
  modalFromClarity(html);
  enhanceInputs($('#dialog'))
}

function parentFolderFromFolders(p) {
  if(p.startsWith('leaf:'))return leaves[p.slice(5)]?.[1]||'review';
  if(p.startsWith('vax:'))return 'care';
  return ({daily:'home',review:'home',tools:'home',baby:'review',mama:'review',expense:'review',care:'review',day:'review',search:'review',prep:'review',voice:'daily','receipt-view':'expense','legacy-photos':'review','pending-view':'baby','vaccine-view':'care',graphs:'review'})[p]||'home'
}

function goFromFolders(target) {
  page=target;
  doctorDay=false;
  reportViewing=false;
  render();
  window.scrollTo(0,0)
}

function backPage() {
  go(parentFolder(page))
}

function goHomeFromFolders() {
  modalLayers=[];
  stopReceiptCamera();
  closeFromApp();
  page='home';
  doctorDay=false;
  reportViewing=false;
  setSignHidden(false);
  render();
  window.scrollTo(0,0)
}

function topButtons() {
  return '<div class="page-navigation"><button type="button" data-back>戻る</button><button type="button" data-home>TOP</button></div>'
}

function modalFromFolders(html) {
  stopReceiptCamera();
  const d=$('#dialog');
  if(d.open){
    const fragment=document.createDocumentFragment();
    while(d.firstChild)fragment.append(d.firstChild);
    modalLayers.push(fragment)
  }else modalLayers=[];
  d.innerHTML='<div class="dialog-navigation"><button type="button" id="modal-back">戻る</button><button type="button" data-home>TOP</button></div>'+html;
  if(!d.open)d.showModal();
  $('#modal-back').onclick=close;
  d.querySelector('[data-home]').onclick=goHome
}

function closeFromFolders() {
  stopReceiptCamera();
  const d=$('#dialog');
  if(modalLayers.length){
    d.replaceChildren(modalLayers.pop());
    return
  }
  closeFromApp()
}

function setSignHidden(hidden) {
  signHidden=hidden;
  document.body.classList.toggle('sign-hidden',hidden);
  const sign=$('#sign');
  sign.inert=hidden;
  sign.setAttribute('aria-hidden',hidden?'true':'false');
  $('#clock-strip').setAttribute('aria-label',hidden?'現在日時と出生からの経過時間・下へスワイプで看板を表示':'現在日時と出生からの経過時間')
}

function cancelSignPress() {
  clearTimeout(signPressTimer);
  signPressTimer=null
}

function bindSignGestures() {
  const sign=$('#sign'),clock=$('#clock-strip');
  sign.onclick=e=>{
    e.preventDefault()
  };
  sign.oncontextmenu=e=>{
    e.preventDefault()
  };
  sign.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    signPointer={id:e.pointerId,x:e.clientX,y:e.clientY};
    signLongPressed=false;
    cancelSignPress();
    sign.setPointerCapture?.(e.pointerId);
    signPressTimer=setTimeout(()=>{
      if(signPointer){
        signLongPressed=true;
        signPointer=null;
        mirrorOpen()
      }
    },1000)
  });
  sign.addEventListener('pointermove',e=>{
    if(!signPointer||e.pointerId!==signPointer.id)return;
    const dx=e.clientX-signPointer.x,dy=e.clientY-signPointer.y;
    if(Math.hypot(dx,dy)>12)cancelSignPress();
    if(dy<-48&&Math.abs(dy)>Math.abs(dx)*1.2){
      setSignHidden(true);
      signPointer=null
    }
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])sign.addEventListener(name,()=>{
    cancelSignPress();
    signPointer=null
  });
  sign.addEventListener('keydown',e=>{
    if(e.repeat)return;
    if(e.key==='Enter'||e.key===' '){
      e.preventDefault();
      signPointer={id:'keyboard'};
      cancelSignPress();
      signPressTimer=setTimeout(()=>{
        if(signPointer){
          signPointer=null;
          signLongPressed=true;
          mirrorOpen()
        }
      },1000)
    }
  });
  sign.addEventListener('keyup',()=>{
    cancelSignPress();
    signPointer=null
  });
  sign.addEventListener('blur',()=>{
    cancelSignPress();
    signPointer=null
  });

  let clockPointer=null;
  clock.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    clockPointer={id:e.pointerId,x:e.clientX,y:e.clientY};
    clock.setPointerCapture?.(e.pointerId)
  });
  clock.addEventListener('pointermove',e=>{
    if(!clockPointer||e.pointerId!==clockPointer.id)return;
    const dx=e.clientX-clockPointer.x,dy=e.clientY-clockPointer.y;
    if(dy>40&&Math.abs(dy)>Math.abs(dx)*1.2){
      setSignHidden(false);
      clockPointer=null
    }
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])clock.addEventListener(name,()=>{
    clockPointer=null
  });

 // 同じ操作をキーボードや支援機能からも実行できます。

  clock.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){
      e.preventDefault();
      setSignHidden(false)
    }else if(e.key==='ArrowUp'){
      e.preventDefault();
      setSignHidden(true)
    }
  });
  clock.tabIndex=0;

}

function formFingerprint(f) {
  return JSON.stringify([...f.elements].filter(e=>e.name&&!['button','submit'].includes(e.type)).map(e=>[e.name,e.type==='checkbox'||e.type==='radio'?e.checked:e.value]))
}

function formIsDirty(f) {
  const c=draftContexts.get(f);
  return !!c&&!c.saved&&(c.extraDirty?.()||formFingerprint(f)!==c.baseline)
}

function setDraftCheck(check) {
  const f=$('#dialog #form'),c=draftContexts.get(f);
  if(c)c.extraDirty=check
}

function saveQuestion() {
  return new Promise(resolve=>{
    const d=document.createElement('dialog');
    d.id='save-question';
    d.innerHTML='<h2>保存しますか？</h2><p>入力した内容が変更されています。</p><div class="actions"><button type="button" id="leave-save" class="primary">する</button><button type="button" id="leave-discard">しない</button></div><button type="button" id="leave-stay">入力に戻る</button>';
    document.body.append(d);
    const finish=v=>{
      d.close();
      d.remove();
      resolve(v)
    };
    d.querySelector('#leave-save').onclick=()=>finish('save');
    d.querySelector('#leave-discard').onclick=()=>finish('discard');
    d.querySelector('#leave-stay').onclick=()=>finish('stay');
    d.oncancel=e=>{
      e.preventDefault();
      finish('stay')
    };
    d.showModal()
  })
}

async function checkDrafts(forms) {
  if(leaveBypass)return true;
  if(leaveBusy)return false;
  leaveBusy=true;
  try{
    for(const f of forms){
      const c=draftContexts.get(f);
      if(c?.saving)return false;
      if(!formIsDirty(f))continue;
      const answer=await saveQuestion();
      if(answer==='stay')return false;
      if(answer==='save'){
        while(!f.isConnected&&modalLayers.length)closeFromClinic();
        if(!await c.save())return false;
        notify(c.message||'保存しました')
      }else{
        c.saved=true;
        c.discard?.()
      }
    }
    return true
  }finally{
    leaveBusy=false
  }
}

function closeCommitted() {
  const f=$('#dialog #form'),c=draftContexts.get(f);
  if(c)c.saved=true;
  closeFromClinic()
}

function refreshSavedView() {
  render();
  const total=$('#dialog .milk-total');
  if(total&&$('#dialog h2')?.textContent==='授乳')total.outerHTML=feedingSummary()
}

function openDraftForms() {
  return [$('#view #leaf-chart-settings'),$('#dialog #form'),...modalLayers.slice().reverse().map(layer=>layer.querySelector('#form'))].filter(Boolean)
}

function closestRecordDate(d, dates) {
  return dates.includes(d)?d:dates.filter(x=>x<=d).at(-1)||dates[0]
}

function watchChartDraft() {
  const f=$('#leaf-chart-settings');
  if(!f)return;
  const c={baseline:formFingerprint(f),saved:false,saving:false};
  draftContexts.set(f,c);
  c.save=async()=>{
    if(c.saving)return false;
    c.saving=true;
    const data=new FormData(f),key=page.slice(5),old=state.chartSettings;
    state.chartSettings={...old,[key]:{range:data.get('range'),type:data.get('type'),color:data.get('color')}};
    try{
      await persist();
      c.saved=true;
      return true
    }catch(e){
      state.chartSettings=old;
      notify('設定を保存できませんでした');
      return false
    }finally{
      c.saving=false
    }
  };
  f.onsubmit=async e=>{
    e.preventDefault();
    if(await c.save()){
      render();
      notify('設定を保存しました')
    }
  }
}

function close() {
  const f=$('#dialog #form'),c=draftContexts.get(f),finish=()=>{
    closeFromClinic();
    if(c?.saved)refreshSavedView();
    return true
  };
  if(!f||!formIsDirty(f)&&!c?.saving)return Promise.resolve(finish());
  return checkDrafts([f]).then(ok=>ok?finish():false)
}

function goFromInteraction(target) {
  const forms=openDraftForms();
  if(canLeaveImmediately(forms)){
    goFromClinic(target);
    return Promise.resolve(true)
  }
  return checkDrafts(forms).then(ok=>{
    if(ok)goFromClinic(target);
    return ok
  })
}

function goHome() {
  const forms=openDraftForms();
  if(canLeaveImmediately(forms)){
    goHomeFromClinic();
    return Promise.resolve(true)
  }
  return checkDrafts(forms).then(ok=>{
    if(ok)goHomeFromClinic();
    return ok
  })
}

function form(title, body, submit) {
  modal('<form id="form"><h2>'+title+'</h2>'+body+'<div class="actions"><button type="button" id="cancel" hidden>戻る</button><button class="primary" type="submit">保存</button></div><p id="error" class="hint" role="alert"></p></form>');
  const f=$('#dialog #form'),saveButton=f.querySelector('[type=submit]'),c={baseline:formFingerprint(f),saved:false,saving:false};
  draftContexts.set(f,c);
  c.save=async()=>{
    if(c.saving)return false;
    if(!f.reportValidity())return false;
    c.saving=true;
    saveButton.disabled=true;
    try{
      const before=new Map(state.records.map(r=>[r.id,JSON.stringify(r)]));
      await submit(new FormData(f));
      const changed=state.records.find(r=>before.get(r.id)!==JSON.stringify(r));
      c.message=changed?'保存：'+day(changed.at)+' '+time(changed.at)+' ／ '+description(changed):title+'を保存しました';
      c.saved=true;
      return true
    }catch(e){
      f.querySelector('#error').textContent=e.message||'保存できませんでした';
      return false
    }finally{
      c.saving=false;
      saveButton.disabled=false
    }
  };
  $('#cancel').onclick=()=>close();
  f.onsubmit=async e=>{
    e.preventDefault();
    if(await c.save()){
      closeFromClinic();
      refreshSavedView();
      notify(c.message)
    }
  };
  return f
}

function parentFolder(p) {
  return p==='voice'?'home':parentFolderFromClinic(p)
}

function parentFolderFromPractical(p) {
  return ['alarms','camera'].includes(p)?'home':parentFolderFromFolders(p)
}

function goFromPractical(p) {
  if(page==='camera'&&p!=='camera'){
    if(shotBlob&&!shotSaved&&!confirm('写真が未保存です。この画面を離れますか？'))return;
    releaseCamera();
    clearShot()
  }
  if(page==='alarms'&&p!=='alarms')leaveAlarm();
  goFromFolders(p)
}

function goHomeFromPractical() {
  if(page==='camera'&&shotBlob&&!shotSaved&&!confirm('写真が未保存です。TOPへ戻りますか？'))return;
  releaseCamera();
  clearShot();
  if(page==='alarms')leaveAlarm();
  goHomeFromFolders()
}

function modal(html) {
  $('#dialog').classList.remove('mirror-dialog');
  return modalFromDailyRecords(html)
}

function go(target) {
  return goFromInteraction(target==='pending-view'?'baby':target)
}

// === records ===
'use strict';
// records: stable function declarations, with explicit dependencies.

function initialDue(profile) {
  if(!profile.due)profile.due='2026-11-24'
}

function settingsMenu(v) {
  v.innerHTML='<h2>設定・準備</h2><div class="grid"><button id="admin-settings">出生日・予定日・表示設定</button><button id="admin-backup">バックアップ・復元</button><button id="new-task">持ち物・予定を登録</button><button id="hospital-memo">病院の連絡先・指示を記入</button></div>';
  $('#admin-settings').onclick=()=>setupForm(false);
  $('#admin-backup').onclick=()=>$('#settings').click();
  $('#new-task').onclick=()=>task();
  $('#hospital-memo').onclick=()=>hospitalMemo()
}

function hospitalMemo() {
  form('病院の連絡先・指示',`<textarea name="contacts">${esc(state.contacts||'')}</textarea>`,async f=>{
    state.contacts=String(f.get('contacts'));
    await persist()
  })
}

function noteFormFromAdministration(d) {
  form('日付別メモ',`<label>日付<input type="date" name="date" required value="${d}"></label><label>白紙メモ<textarea name="note">${esc(state.notes[d]||'')}</textarea></label>`,async f=>{
    const target=String(f.get('date'));
    if(!compareDate(target))throw Error('日付を確認してください');
    if(target!==d&&state.notes[target]&&!confirm('その日にはメモがあります。置き換えますか？'))throw Error('保存先の日付を確認してください');
    state.notes[target]=String(f.get('note'));
    await persist()
  })
}

function fullDescription(r) {
  if(r.type==='mamagrowth')return `ママ測定 ${r.height===null?'':r.height+' cm'} ${r.weight===null?'':r.weight+' kg'}`;
  if(r.type==='mama')return 'ママの体調・服薬：'+(r.condition||'');
  return description(r)
}

function dayItems(d) {
  const start=+new Date(d+'T00:00:00'),finish=+new Date(new Date(d+'T00:00:00').setDate(new Date(d+'T00:00:00').getDate()+1));
  const list=state.records.filter(r=>r.type!=='photo'&&(r.type==='sleep'?+new Date(r.at)<finish&&+new Date(r.end)>start:day(r.at)===d)).map(r=>({kind:'record',id:r.id,at:r.at,text:fullDescription(r),memo:r.memo||'',source:r}));
  for(const r of state.vaccines)if(r.date===d)list.push({kind:'vaccine',id:r.id,at:d+'T'+(r.time||'00:00')+':00',text:'予防接種 '+r.status+' '+r.name+' '+(r.dose||''),memo:[r.hospital,r.cost===null?'費用未記入':r.cost+'円',r.memo].filter(Boolean).join(' ／ ')});
  for(const r of state.receipts)if(r.date===d)list.push({kind:'receipt',id:r.id,at:d+'T23:59:59',noTime:true,text:'レシート '+(r.shop||'店名未記入')+' 子供分 '+(receiptChildAmount(r)===null?'未記入':receiptChildAmount(r)+'円'),memo:[r.items,r.category,r.memo].filter(Boolean).join(' ／ ')});
  return list.sort((a,b)=>new Date(a.at)-new Date(b.at))
}

function sleepingThatDay(who, d) {
  return state.records.some(r=>r.type==='sleep'&&r.who===who&&new Date(r.at)<new Date(d+'T23:59:59')&&new Date(r.end)>new Date(d+'T00:00:00'))
}

function reportSleep(who, d) {
  const n=BabyCore.sleepMinutes(state.records,who,d);
  return n?duration(n):sleepingThatDay(who,d)?'1分未満':'未記録'
}

function openItem(kind, id) {
  if(kind==='record')edit(id);else if(kind==='vaccine')vaccineDetails(state.vaccines.find(r=>r.id===id));else if(kind==='receipt')receiptForm(state.receipts.find(r=>r.id===id));else if(kind==='active')activeSleepForm(id)
}

function birthElapsed(profile, now=new Date()) {
  if(!profile?.birth||new Date(profile.birth+'T00:00:00')>now){
    const d=profile?.due||'2026-11-24';
    return '出産予定日：'+d.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1年$2月$3日')
  }
  const b=new Date(profile.birth+'T'+(profile.birthTime||'00:00:00'));
  if(!Number.isFinite(+b)||b>now)return '出生日時を確認してください';
  if(!profile.birthTime)return '生後'+Math.round((new Date(day(now)+'T12:00:00')-new Date(profile.birth+'T12:00:00'))/86400000)+'日（出生時刻は未登録）';
  const hours=Math.floor((now-b)/3600000);
  return '生まれてから '+Math.floor(hours/24)+'日 '+hours%24+'時間'
}

function editFromAdministration(id) {
  if(state.records.find(r=>r.id===id)?.type==='photo'){
    notify('旧写真は「記録を見る」から取り出せます');
    return
  }
  editFromExtra(id)
}

function num(name, label, unit, value='') {
  return `<label>${label}（${unit}）<input name="${name}" type="number" inputmode="decimal" step="any" min="0" placeholder="0.0" value="${esc(value)}"><small>薄い0.0は未記録です</small></label>`
}

function number(f, k, required=false) {
  const s=f.get(k);
  if(s===''||s===null){
    if(required)throw Error('数値を入力してください');
    return null
  }
  const n=Number(s);
  if(!Number.isFinite(n)||n<=0)throw Error('0より大きい数値を入力してください');
  return n
}

function dateField(at) {
  return `<label>記録日時<input type="datetime-local" name="at" required value="${localTime(at)}"></label>`
}

function textField(name, label, value='', list=false) {
  return `<label>${label}<input name="${name}" value="${esc(value)}" ${list?'list="food-words" autocomplete="off"':''}></label>${list?`<datalist id="food-words">${state.words.map(w=>`<option value="${esc(w)}">`).join('')}</datalist>`:''}`
}

function addFromApp(type, old=null, who='baby') {

  const recordId=old?.id||uid();

  const r=old||{at:date===day(new Date())?new Date().toISOString():date+'T12:00:00',who};
  let body=dateField(r.at),title='';

  if(type==='milk'){
    title='ミルク・搾母乳';
    body+=`<label>種類<select name="kind"><option ${r.kind==='ミルク'?'selected':''}>ミルク</option><option ${r.kind==='搾母乳'?'selected':''}>搾母乳</option></select></label>`+num('amount','実際に飲んだ量','mL',r.amount??'')
  }

  if(type==='breast'){
    title='母乳';
    body+=`<label>左右<select name="side"><option>左</option><option ${r.side==='右'?'selected':''}>右</option><option ${r.side==='両方'?'selected':''}>両方</option></select></label>`+num('minutes','授乳時間（任意）','分',r.minutes??'')+'<p class="hint">授乳時間を母乳量に換算しません。</p>'
  }

  if(type==='food'){
    title='離乳食';
    body+=textField('food','食べたもの（例：ニンジンペースト）',r.food||'',true)+textField('quantity','量（任意・例：小さじ1／10 g）',r.quantity||'')+'<p class="hint">食品名は保存すると次回の入力候補になります。写真は使いません。</p>'
  }

  if(type==='diaper'){
    title='おむつ';
    body+=`<label>内容<select name="kind">${['おしっこ','うんち','両方'].map(k=>`<option ${r.kind===k?'selected':''}>${k}</option>`).join('')}</select></label>`
  }

  if(type==='sleep'){
    title=who==='mama'?'ママの睡眠':'赤ちゃんの睡眠';
    body=`<label>寝た日時<input type="datetime-local" name="at" required value="${localTime(r.at)}"></label><label>起きた日時<input type="datetime-local" name="end" required value="${localTime(r.end||new Date())}"></label><p class="hint">日付をまたぐ睡眠は各日に分けて合計します。重なる時間は二重に数えません。</p>`
  }

  if(type==='growth'){
    title='身長・体重';
    body+=num('height','身長','cm',r.height??'')+num('weight','体重','kg',r.weight??'')
  }

  if(type==='mama'){
    title='ママの体調';
    body+=textField('condition','体調・気分・休息・お薬など',r.condition||'')+'<p class="hint">気になる出血・痛み・発熱・乳房の様子・気分など、必要なことだけ記入できます。</p>'
  }

  body+=`<label>補足（任意）<textarea name="memo">${esc(r.memo||'')}</textarea></label>`;

  form(title,body,async f=>{
    const at=new Date(f.get('at'));
    if(!Number.isFinite(+at))throw Error('日時を確認してください');
    const n={id:recordId,type,at:at.toISOString(),who:r.who||who,memo:String(f.get('memo')||'').trim()};

    if(type==='milk'){
      n.kind=f.get('kind');
      n.amount=number(f,'amount',true);
      if(n.amount>1000&&!confirm('1回の量が1000 mLを超えています。入力どおり保存しますか？'))throw Error('量を確認してください')
    }

    if(type==='breast'){
      n.side=f.get('side');
      n.minutes=number(f,'minutes')
    }

    if(type==='food'){
      n.food=String(f.get('food')).trim();
      n.quantity=String(f.get('quantity')).trim();
      if(!n.food)throw Error('食べたものを入力してください')
    }

    if(type==='diaper')n.kind=f.get('kind');

    if(type==='sleep'){
      const end=new Date(f.get('end'));
      if(!Number.isFinite(+end)||end<=at)throw Error('起きた日時は寝た日時より後にしてください');
      if(end-at>86400000&&!confirm('24時間を超える記録です。入力どおり保存しますか？'))throw Error('日時を確認してください');
      n.end=end.toISOString()
    }

    if(type==='growth'){
      n.height=number(f,'height');
      n.weight=number(f,'weight');
      if(n.height===null&&n.weight===null)throw Error('身長か体重を入力してください');
      if((n.height!==null&&(n.height<20||n.height>150)||n.weight!==null&&(n.weight<0.5||n.weight>50))&&!confirm('単位と数値を確認してください。この値で保存しますか？'))throw Error('数値を確認してください')
    }

    if(type==='mama'){
      n.condition=String(f.get('condition')).trim();
      if(!n.condition&&!n.memo)throw Error('内容を入力してください')
    }

    const previous=state.records,previousWords=state.words;
    state.records=previous.filter(x=>x.id!==n.id).concat(n);
    if(type==='food'&&!previousWords.includes(n.food))state.words=previousWords.concat(n.food);
    try{
      await persist()
    }catch(e){
      state.records=previous;
      state.words=previousWords;
      throw e
    }
  })

}

function descriptionFromApp(r) {
  return ({milk:()=>`${r.kind} ${r.amount} mL`,breast:()=>`母乳 ${r.side}${r.minutes?' '+r.minutes+'分':''}`,food:()=>`離乳食 ${r.food} ${r.quantity||''}`,diaper:()=>r.kind,sleep:()=>`${r.who==='mama'?'ママ':'赤ちゃん'}睡眠 ${time(r.at)} → ${time(r.end)}（${day(r.at)!==day(r.end)?day(r.end)+' ':''}${duration(Math.round((new Date(r.end)-new Date(r.at))/60000))}）`,growth:()=>[r.height!==null?`身長 ${r.height} cm`:'',r.weight!==null?`体重 ${r.weight} kg`:''].filter(Boolean).join(' ／ '),mama:()=>r.condition,photo:()=>r.caption||'成長写真'}[r.type]||(()=>''))()
}

function editFromApp(id) {
  const r=state.records.find(r=>r.id===id);
  if(!r)return;
  modal(`<h2>記録の変更</h2><p>${esc(day(r.at)+' '+description(r))}</p><div class="actions"><button id="change">変更</button><button id="remove" class="danger">削除</button><button id="back">戻る</button></div>`);
  $('#back').onclick=close;
  $('#change').onclick=()=>r.type==='photo'?photo(r):add(r.type,r,r.who);
  $('#remove').onclick=async()=>{
    if(confirm('この記録を削除しますか？')){
      state.records=state.records.filter(x=>x.id!==id);
      await persist();
      closeCommitted();
      render()
    }
  }
}

function task(old) {
  form('持ち物・予定・確認事項',textField('text','内容',old?.text||'')+`<label>日付（任意）<input type="date" name="due" value="${old?.due||''}"></label>`,async f=>{
    const text=String(f.get('text')).trim();
    if(!text)throw Error('内容を入力してください');
    state.tasks=state.tasks.filter(x=>x.id!==old?.id).concat({id:old?.id||uid(),text,due:String(f.get('due')),done:old?.done||false});
    await persist()
  })
}

function download(name, content) {
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=document.createElement('a');
  a.href=url;
  a.download=name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000)
}

function feedingData(d=day(new Date())) {
  const rows=state.records.filter(r=>['milk','breast'].includes(r.type)&&day(r.at)===d).sort((a,b)=>a.at.localeCompare(b.at));
  const formula=rows.filter(r=>r.type==='milk'&&r.kind!=='搾母乳'),pumped=rows.filter(r=>r.type==='milk'&&r.kind==='搾母乳'),breast=rows.filter(r=>r.type==='breast');
  const sum=rs=>rs.reduce((n,r)=>n+r.amount,0),estimated=breast.filter(r=>Number.isFinite(r.estimateMl)&&r.estimateMl>0);
  return {rows,formula,pumped,breast,actual:sum(formula)+sum(pumped),formulaMl:sum(formula),pumpedMl:sum(pumped),estimateMl:estimated.reduce((n,r)=>n+r.estimateMl,0),estimateCount:estimated.length,unknownCount:breast.length-estimated.length}
}

function clinicalMeasurements(d) {
  const cutoff=Math.min(+new Date(d+'T23:59:59.999'),Date.now());
  const temperatures=state.records.filter(r=>r.type==='morning'&&day(r.at)===d&&Number.isFinite(r.temperature)&&+new Date(r.at)<=cutoff).sort((a,b)=>+new Date(a.at)-+new Date(b.at));
  const highest=temperatures.reduce((best,r)=>!best||r.temperature>best.temperature?r:best,null);
  const latestGrowth=field=>state.records.filter(r=>r.type==='growth'&&Number.isFinite(r[field])&&r[field]>0.1&&Number.isFinite(+new Date(r.at))&&+new Date(r.at)<=cutoff).sort((a,b)=>+new Date(b.at)-+new Date(a.at))[0]||null;
  return {latestTemperature:temperatures.at(-1)||null,highestTemperature:highest,height:latestGrowth('height'),weight:latestGrowth('weight')};
}

function latestGrowthHTML(d) {
  const data=clinicalMeasurements(d);
  const cell=(key,label,unit)=>{const r=data[key];return '<div><dt>'+label+'</dt><dd>'+(r?esc(r[key]+' '+unit)+'<small>'+esc(day(r.at).replaceAll('-','／')+' '+time(r.at))+' 測定</small>':'測定記録なし')+'</dd></div>'};
  return '<aside class="latest-measurements"><strong>直近の測定（表示日以前）</strong><dl>'+cell('height','身長','cm')+cell('weight','体重','kg')+'</dl><p class="hint">当日の値とは別に、最後に測った値と測定日時を表示します。</p></aside>';
}

function feedingSummary(d=day(new Date())) {
  const s=feedingData(d),known=s.formula.length+s.pumped.length;
  return '<aside class="milk-total"><strong>'+esc(d)+' の授乳</strong><section class="measured-feeding"><h4>量が分かる授乳</h4><dl class="feed-totals"><div><dt>ミルク</dt><dd>'+(s.formula.length?s.formulaMl+' mL ／ '+s.formula.length+'回':'未記録')+'</dd></div><div><dt>搾母乳</dt><dd>'+(s.pumped.length?s.pumpedMl+' mL ／ '+s.pumped.length+'回':'未記録')+'</dd></div><div><dt>実際に飲んだ量の合計</dt><dd>'+(known?s.actual+' mL':'未記録')+'</dd></div></dl></section><section class="estimated-feeding"><h4>直接の母乳（量は未測定）</h4><p>'+(s.breast.length?s.breast.length+'回':'未記録')+'</p><p class="hint">「少・並・多・分からない」で残せます。実測量の合計には含めません。</p>'+(s.estimateCount?'<details><summary>保存した感覚の目安量を見る（未測定）</summary><p>感覚の目安量：'+s.estimateMl+' mL ／ '+s.estimateCount+'回分</p><p>実測＋感覚の参考合算：'+(s.actual+s.estimateMl)+' mL（数値がある分だけ）</p><p class="hint">この参考合算は実測した摂取量ではありません。</p></details>':'')+(s.unknownCount?'<p class="hint">母乳'+s.unknownCount+'回分はmL未記録です。</p>':'')+'</section></aside>';
}

async function chooseFeedingKind() {
  if(!await checkDrafts(openDraftForms()))return;
  modalLayers=[];
  const dialog=$('#dialog');
  if(dialog.open)dialog.close();
  dialog.innerHTML='';
  feedMenu(true);
}

function feedingForm(type, old=null, kind='ミルク') {
  const token=dataEpoch,at=old?.at||new Date(),memo=old?.memo||'';
  const previousFeed=state.records.filter(r=>['milk','breast'].includes(r.type)&&r.id!==old?.id&&+new Date(r.at)<=+new Date(at)).sort((a,b)=>+new Date(b.at)-+new Date(a.at))[0];
  let body='<div class="feeding-kind-tabs" role="group" aria-label="授乳方法">'+[['breast','母乳'],['milk','ミルク'],['pumped','搾母乳']].map(([key,label])=>'<button type="button" data-feed-switch="'+key+'" aria-pressed="'+(key===(type==='breast'?'breast':(old?.kind||kind)==='搾母乳'?'pumped':'milk'))+'">'+label+'</button>').join('')+'</div><p class="previous-feed">前回の授乳：'+(previousFeed?esc(day(previousFeed.at)+' '+time(previousFeed.at)+' ／ '+(previousFeed.type==='breast'?'母乳':previousFeed.kind||'ミルク')):'まだ記録がありません')+'</p>'+dateField(at);
  if(type==='milk'){
    const amounts=[...new Set([...(state.prefs?.milkAmounts||[60,80,100,120]),...(old?.amount?[old.amount]:[])])].slice(0,8);
    body+='<label class="feeding-kind-legacy">種類<select name="kind"><option '+((old?.kind||kind)==='ミルク'?'selected':'')+'>ミルク</option><option '+((old?.kind||kind)==='搾母乳'?'selected':'')+'>搾母乳</option></select></label><label>実際に飲んだ量（mL）<input type="number" name="amount" min="0" step="1" placeholder="0.0" required value="'+(old?.amount??'')+'"></label><div class="amount-chips">'+amounts.map(n=>'<button type="button" data-feed-amount="'+n+'">'+n+' mL</button>').join('')+'</div>'
  }else{
    body+='<label>左右<select name="side">'+['左','右','両方'].map(s=>'<option '+(old?.side===s?'selected':'')+'>'+s+'</option>').join('')+'</select></label>'+choice('feltAmount','飲んだ量の感覚',FELT_AMOUNTS,old?.feltAmount)+'<details class="breast-estimate-details" '+(Number.isFinite(old?.estimateMl)?'open':'')+'><summary>mLの目安を書く場合のみ（未測定）</summary><label>ママの感覚による目安量（mL・任意）<input type="number" name="estimateMl" min="0" step="1" placeholder="0.0" value="'+(old?.estimateMl??'')+'"></label><p class="hint">分からなければ空欄のままで大丈夫です。実測量の合計には含めません。</p></details><label>授乳時間（分・任意）<input type="number" name="minutes" min="0" step="0.1" placeholder="0.0" value="'+(old?.minutes??'')+'"></label>'
  }
  body+='<label class="check"><input type="checkbox" name="mixedFeeding" '+(old?.mixedFeeding?'checked':'')+'><span>母乳とミルクを併用した授乳</span></label><p class="hint">併用した時の目印です。母乳とミルクは、それぞれ記録してください。母乳の感覚と実測量は分けて集計します。</p><label>補足<textarea name="memo">'+esc(memo)+'</textarea></label><p class="hint">日時を確認して保存してください。新規入力は毎回、別の記録として残します。</p>';

  form(type==='milk'?'ミルク・搾母乳を記録':'母乳を感覚で記録',body,async f=>{
    if(token!==dataEpoch||dataWiping)throw Error('画面を開き直してください');
    const at=new Date(f.get('at'));
    if(!Number.isFinite(+at)||at>new Date())throw Error('現在以前の日時を選んでください');
    const r={...old,id:old?.id||uid(),type,at:at.toISOString(),memo:String(f.get('memo')||'').trim(),mixedFeeding:f.has('mixedFeeding')};
    const optional=k=>{
      const raw=String(f.get(k)||'');
      const n=raw===''?null:Number(raw);
      if(n===0||n===0.1)return null;
      if(n!==null&&(!Number.isFinite(n)||n<0))throw Error('数値を確認してください');
      return n
    };
    if(type==='milk'){
      r.kind=String(f.get('kind'));
      if(!['ミルク','搾母乳'].includes(r.kind))throw Error('種類を選んでください');
      r.amount=optional('amount');
      if(r.amount===null)throw Error('実際に飲んだ量を入力してください');
      if(r.amount>1000&&!confirm('一回の量が1000 mLを超えています。入力どおり保存しますか？'))throw Error('量を確認してください')
    }else{
      r.side=String(f.get('side'));
      r.minutes=optional('minutes');
      r.estimateMl=optional('estimateMl');
      r.feltAmount=String(f.get('feltAmount')||'');
      if(!['左','右','両方'].includes(r.side)||!['',...FELT_AMOUNTS].includes(r.feltAmount))throw Error('項目を選び直してください');
      if(r.estimateMl!==null&&r.estimateMl>1000&&!confirm('目安量が1000 mLを超えています。入力どおり保存しますか？'))throw Error('量を確認してください')
    }
    const previous=state.records;
    state.records=previous.filter(x=>x.id!==r.id).concat(r);
    try{
      await persist()
    }catch(e){
      state.records=previous;
      throw e
    }
  });
  $('#form').querySelectorAll('[data-feed-switch]').forEach(b=>b.onclick=async()=>{
    if(b.getAttribute('aria-pressed')==='true')return;
    if(!await checkDrafts(openDraftForms()))return;
    modalLayers=[];const dialog=$('#dialog');if(dialog.open)dialog.close();dialog.innerHTML='';
    const existing=old?state.records.find(r=>r.id===old.id):null;
    const target=b.dataset.feedSwitch;
    feedingForm(target==='breast'?'breast':'milk',existing?{...existing,kind:target==='pumped'?'搾母乳':'ミルク'}:null,target==='pumped'?'搾母乳':'ミルク');
  });
  $('#dialog').querySelectorAll('[data-feed-amount]').forEach(b=>b.onclick=()=>{
    $('#dialog input[name=amount]').value=b.dataset.feedAmount
  })
}

function addNowButtons(root) {
  root.querySelectorAll('input[type="datetime-local"],input[type="time"]').forEach(input=>{
    if(input.dataset.nowReady)return;
    input.dataset.nowReady='1';
    input.step=input.type==='time'?'60':'1';
    const b=document.createElement('button');
    b.type='button';
    b.className='now-button';
    b.textContent='現在時刻を入れる';
    b.onclick=()=>{
      const now=new Date();
      input.value=(input.type==='time'?String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'):localTime(now))+(input.type==='time'?'':':'+String(now.getSeconds()).padStart(2,'0'));
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}))
    };
    input.parentElement.insertBefore(b,input.nextSibling)
  });
  const oldNow=root.querySelector('#sleep-now');
  if(oldNow)oldNow.hidden=true
}

async function addressJSON(path) {
  if(addressCache.has(path))return addressCache.get(path);
  const data=await fetchWeatherJSON(ADDRESS_BASE+path);
  addressCache.set(path,data);
  return data
}

function townPoints(rows) {
  if(!Array.isArray(rows))throw Error('町丁目の一覧を取得できません');
  return rows.filter(r=>typeof r.town==='string'&&typeof r.lat==='number'&&Number.isFinite(r.lat)&&Math.abs(r.lat)<=90&&typeof r.lng==='number'&&Number.isFinite(r.lng)&&Math.abs(r.lng)<=180)
}

function representativeTown(rows, index) {
  if(index!==''&&rows[Number(index)]){
    const t=rows[Number(index)];
    return {latitude:t.lat,longitude:t.lng,town:[t.town,t.koaza].filter(Boolean).join(' ')}
  }
  if(!rows.length)throw Error('座標のある町丁目が見つかりません');
  return {latitude:rows.reduce((n,t)=>n+t.lat,0)/rows.length,longitude:rows.reduce((n,t)=>n+t.lng,0)/rows.length,town:''}
}

function eventGroup(item) {
  if(item.kind!=='record')return 'その他';
  if(['milk','breast','food'].includes(item.source.type))return '授乳・食事';
  if(item.source.type==='diaper')return '排尿・排便';
  if(item.source.type==='sleep')return '睡眠';
  return '測定・体調・その他'
}

function eventRows(items, d) {
  return items.map(item=>{
    let stamp=item.noTime?'時刻未登録':time(item.at);
    if(item.kind==='record'&&item.source.type==='sleep')stamp=(day(item.at)!==d?day(item.at)+' ':'')+time(item.at)+'～'+(day(item.source.end)!==d?day(item.source.end)+' ':'')+time(item.source.end);
    const hex=item.source?observationHex(item.source):null;
    return '<tr><td>'+esc(stamp)+'</td><td>'+esc(item.text)+(hex?'<span class="health-colour" style="background:'+hex+'" aria-label="'+esc(item.source.color)+'"></span>':'')+(item.memo?'<p class="prewrap">'+esc(item.memo)+'</p>':'')+'<button class="health-edit" data-health-kind="'+item.kind+'" data-health-id="'+esc(item.id)+'">訂正</button></td></tr>'
  }).join('')
}

function eventsHTML(items, d, grouped=true) {
  const table=rs=>'<table class="events-table"><thead><tr><th scope="col">時刻</th><th scope="col">記録・量・補足</th></tr></thead><tbody>'+eventRows(rs,d)+'</tbody></table>';
  if(!items.length)return '<p>この日の記録はありません。</p>';
  if(!grouped)return '<div class="event-scroll" role="region" aria-label="時刻順の全記録" tabindex="0">'+table(items)+'</div>';
  return ['授乳・食事','排尿・排便','睡眠','測定・体調・その他','その他'].map(group=>{
    const rows=items.filter(i=>eventGroup(i)===group);
    return rows.length?'<section class="event-group"><h5>'+group+'　'+rows.length+'件</h5><div class="event-scroll" role="region" aria-label="'+group+'の全記録" tabindex="0">'+table(rows)+'</div></section>':''
  }).join('')
}

function breastQuick() {
  feedingForm('breast')
}

function milkQuick(kind) {
  feedingForm('milk',null,kind)
}

function addFromDailyRecords(type, old=null, who='baby') {
  if(type==='milk'||type==='breast')feedingForm(type,old,old?.kind);else addFromFolders(type,old,who)
}

function description(r) {
  if(r.mixedFeeding)return '母乳・ミルク併用 ／ '+description({...r,mixedFeeding:false});
  if(r.type==='breast')return ['母乳 '+(r.side||''),r.minutes!==null&&r.minutes!==undefined?r.minutes+'分':'時間未記録','飲んだ感覚：'+(r.feltAmount||'未記録'),Number.isFinite(r.estimateMl)?'目安量 '+r.estimateMl+' mL（感覚・未測定）':'目安量未記録'].join(' ／ ');
  return descriptionFromClinic(r)
}

function weatherSettings() {
  const epoch=dataEpoch;
  let cities=[],towns=[],seq=0,placeEdited=false;
  const p=state.profile.weatherPlace;
  form('天気の地域設定','<p class="hint">都道府県→市区町村・区→町丁目の順に選べます。町丁目は任意です。</p><label>都道府県<select name="prefecture" id="place-pref"><option value="">選んでください</option>'+PREFECTURES.map(pref=>'<option '+(p?.prefecture===pref?'selected':'')+'>'+pref+'</option>').join('')+'</select></label><label>市区町村・区の絞り込み<input id="place-city-filter" placeholder="例：新宿、中央区"></label><label>市区町村・区<select name="city" id="place-city" disabled><option value="">都道府県を選んでください</option></select></label><label>町丁目の絞り込み<input id="place-town-filter" placeholder="例：西新宿、○○町"></label><label>町丁目（任意）<select name="town" id="place-town" disabled><option value="">市区町村を選んでください</option></select></label><p id="place-status" role="status"></p><button type="button" id="place-save" class="primary" disabled>この地域で天気を記録する</button><button type="button" id="place-fallback">以前の地名検索を使う</button>'+(p?'<button type="button" id="place-disable">自動取得を止める</button>':'')+'<p class="hint">番地・家番号は不要です。住所一覧の読込みで都道府県・市区町村名をGeoloniaへ、天気取得で地域の代表座標をOpen-Meteoへ送ります。健康記録は送りません。細かい地名を選んでも天気は付近の参考値です。</p><p class="weather-credit">住所：<a href="https://geolonia.github.io/japanese-addresses/" target="_blank" rel="noopener">Geolonia 住所データ</a>（CC BY 4.0）<br>'+WEATHER_CREDIT+'</p>',saveWeatherPlaceDraft);
  const pref=$('#place-pref'),city=$('#place-city'),town=$('#place-town'),status=$('#place-status'),save=$('#place-save');
  const alive=()=>epoch===dataEpoch&&status.isConnected&&!dataWiping;

  const showCities=()=>{
    const selected=city.value,q=$('#place-city-filter').value.trim();
    city.innerHTML='<option value="">選んでください</option>'+cities.filter(c=>c.includes(q)).map(c=>'<option '+(c===selected?'selected':'')+'>'+esc(c)+'</option>').join('')
  };
  const showTowns=()=>{
    const selected=town.value,q=$('#place-town-filter').value.trim();
    town.innerHTML='<option value="">市区町村のおおよその代表地点を使う</option>'+towns.map((t,i)=>({t,i})).filter(({t})=>[t.town,t.koaza].join(' ').includes(q)).map(({t,i})=>'<option value="'+i+'" '+(String(i)===selected?'selected':'')+'>'+esc([t.town,t.koaza].filter(Boolean).join(' '))+'</option>').join('')
  };

  const loadPref=async()=>{
    const request=++seq;
    save.disabled=true;
    city.disabled=town.disabled=true;
    towns=[];
    cities=[];
    city.innerHTML='<option value="">読込み中…</option>';
    town.innerHTML='<option value="">市区町村を選んでください</option>';
    if(!pref.value){
      city.innerHTML='<option value="">都道府県を選んでください</option>';
      return
    }
    status.textContent='市区町村の一覧を読み込んでいます…';
    try{
      const data=await addressJSON('ja.json');
      if(!alive()||request!==seq)return;
      cities=Array.isArray(data[pref.value])?data[pref.value]:[];
      showCities();
      city.disabled=false;
      status.textContent='市区町村・区を選んでください';
      if(p?.city&&cities.includes(p.city)&&p.prefecture===pref.value){
        city.value=p.city;
        await loadCity()
      }
    }catch(e){
      if(alive()&&request===seq)status.textContent='一覧を取得できません。通信状態を確認するか、以前の地名検索をお使いください。'
    }
  };

  const loadCity=async()=>{
    const request=++seq;
    save.disabled=true;
    town.disabled=true;
    towns=[];
    town.innerHTML='<option value="">読込み中…</option>';
    if(!city.value)return;
    status.textContent='町丁目の一覧を読み込んでいます…';
    const selectedCity=city.value;
    try{
      const data=await addressJSON('ja/'+encodeURIComponent(pref.value)+'/'+encodeURIComponent(selectedCity)+'.json');
      if(!alive()||request!==seq||city.value!==selectedCity)return;
      towns=townPoints(data);
      showTowns();
      town.disabled=false;
      save.disabled=!towns.length;
      status.textContent=towns.length+'件の町丁目。選ばず市区町村だけでも保存できます。';
      if(p?.city===selectedCity&&p?.town){
        const index=towns.findIndex(t=>[t.town,t.koaza].filter(Boolean).join(' ')===p.town);
        if(index>=0)town.value=String(index)
      }
    }catch(e){
      if(alive()&&request===seq)status.textContent='町丁目を取得できません。以前の地名検索も使えます。'
    }
  };

  pref.onchange=()=>{
    placeEdited=true;
    loadPref()
  };
  city.onchange=()=>{
    placeEdited=true;
    loadCity()
  };
  town.onchange=()=>{
    placeEdited=true
  };
  $('#place-city-filter').oninput=()=>{
    showCities();
    save.disabled=true;
    town.disabled=true;
    if(city.value)loadCity();else{
      seq++;
      town.innerHTML='<option value="">市区町村を選んでください</option>'
    }
  };
  $('#place-town-filter').oninput=showTowns;
  async function saveWeatherPlaceDraft(){
    if(!alive()||!pref.value||!city.value||!towns.length)throw Error('市区町村・区まで選んでください');
    const point=representativeTown(towns,town.value),previous=state.profile.weatherPlace;
    state.profile.weatherPlace={prefecture:pref.value,city:city.value,town:point.town,label:pref.value+' '+city.value+(point.town?' '+point.town:''),latitude:point.latitude,longitude:point.longitude,addressSource:'Geolonia'};
    try{
      await persist()
    }catch(e){
      state.profile.weatherPlace=previous;
      throw e
    }
    ensureWeather(day(new Date()),true)
  }
  save.onclick=()=>$('#form').requestSubmit();
  $('#place-fallback').onclick=weatherSettingsFromClinic;
  if($('#place-disable'))$('#place-disable').onclick=async()=>{
    const old=state.profile.weatherPlace;
    delete state.profile.weatherPlace;
    try{
      await persist();
      closeCommitted();
      render()
    }catch(e){
      state.profile.weatherPlace=old;
      status.textContent='保存できませんでした'
    }
  };
  if(pref.value)loadPref().then(()=>{
    if(!placeEdited&&alive())resetDraftBaseline($('#form'))
  });
}

function paletteEntries(kind) {
  return kind==='おしっこ'?URINE_SWATCHES:POO_SWATCHES
}

function observationHex(r) {
  if(/^#[0-9a-f]{6}$/i.test(r.colorHex||''))return r.colorHex;
  const name=({'黒色':'黒っぽい','白色':'白っぽい','赤色':'赤っぽい'})[r.color]||r.color;
  const pair=[...POO_SWATCHES,...URINE_SWATCHES].find(x=>x[0]===name);
  return pair?.[1]||null
}

function paletteHTML(kind, old) {
  const options=paletteEntries(kind);
  return '<fieldset class="colour-picker"><legend>色をタップ</legend><p class="hint">見た色の目安です。病気の判断はしません。</p><div id="selected-colour" class="selected-colour"><span id="colour-preview"></span><strong id="colour-name">未記録</strong></div><input type="hidden" name="color" value="'+esc(old?.color||'')+'"><input type="hidden" name="colorHex" value="'+esc(old?.colorHex||'')+'"><div class="swatch-grid '+(kind==='おしっこ'?'urine-palette':'poo-palette')+'">'+options.map(([name,hex])=>'<button type="button" class="swatch" data-colour="'+hex+'" data-colour-name="'+esc(name)+'" aria-label="'+esc(name)+'" aria-pressed="false"><span style="background:'+hex+'"></span>'+(kind==='おしっこ'?'':'<small>'+esc(name)+'</small>')+'</button>').join('')+'</div><div class="grid"><button type="button" id="colour-unknown">色が分からない</button><button type="button" id="colour-clear">未記録にする</button></div></fieldset>'
}

function bindPalette() {
  const d=$('#dialog');
  const update=(name,hex)=>{
    d.querySelector('[name=color]').value=name;
    d.querySelector('[name=colorHex]').value=hex;
    $('#colour-name').textContent=name||'未記録';
    $('#colour-preview').style.background=hex||'repeating-linear-gradient(45deg,#eee 0 8px,#fff 8px 16px)';
    d.querySelectorAll('[data-colour]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.colour===hex&&b.dataset.colourName===name)))
  };
  d.querySelectorAll('[data-colour]').forEach(b=>b.onclick=()=>update(b.dataset.colourName,b.dataset.colour));
  $('#colour-unknown').onclick=()=>update('不明','');
  $('#colour-clear').onclick=()=>update('','');
  const name=d.querySelector('[name=color]').value;
  update(name,d.querySelector('[name=colorHex]').value||observationHex({color:name})||'')
}

function phoneDetails(i) {
  const p=state.phoneBook?.[i];
  if(!p){
    phoneEdit(i);
    return
  }
  const tel=p.phone.replace(/[^\d+*#]/g,'');
  modal('<h2>発信の確認</h2><h3>'+esc(p.name)+'</h3><p>'+esc(p.phone)+'</p><p class="prewrap">'+esc(p.memo||'')+'</p><a class="phone-call" href="tel:'+esc(tel.replace(/#/g,'%23'))+'">この番号に電話する</a><button id="phone-edit">登録内容を変更</button><button id="phone-clear" class="danger">この登録を外す</button>');
  $('#phone-edit').onclick=()=>{
    close();
    phoneEdit(i)
  };
  $('#phone-clear').onclick=async()=>{
    if(!confirm('この電話帳の登録を外しますか？'))return;
    const old=state.phoneBook;
    state.phoneBook=old.map((p,k)=>k===i?null:p);
    try{
      await persist();
      closeCommitted();
      render()
    }catch(e){
      state.phoneBook=old;
      notify('保存できませんでした')
    }
  }
}

function phoneEdit(i) {
  const p=state.phoneBook?.[i];
  form('電話帳 '+(i+1)+'／10','<label>名前<input name="name" maxlength="60" required value="'+esc(p?.name||'')+'"></label><label>電話番号<input name="phone" type="tel" maxlength="40" required value="'+esc(p?.phone||'')+'"></label><label>メモ<textarea name="memo">'+esc(p?.memo||'')+'</textarea></label>',async f=>{
    const name=String(f.get('name')).trim(),phone=String(f.get('phone')).trim(),memo=String(f.get('memo')).trim();
    if(!name||!/^\+?[0-9０-９()（）\-ー\s*#]{3,40}$/.test(phone))throw Error('名前と電話番号を確認してください');
    const normalized=phone.normalize('NFKC').replace(/ー/g,'-');
    const old=state.phoneBook;
    state.phoneBook=Array.from({length:10},(_,k)=>k===i?{name,phone:normalized,memo}:old?.[k]||null);
    try{
      await persist()
    }catch(e){
      state.phoneBook=old;
      throw e
    }
  })
}

function wheelParts(input) {
  const type=input.type,value=input.value,now=new Date(),pad=n=>String(n).padStart(2,'0'),range=(a,b)=>Array.from({length:b-a+1},(_,i)=>String(a+i));
  if(type==='number'){
    const step=input.step&&input.step!=='any'?input.step:(input.closest('label')?.textContent.includes('kg')?'0.001':input.closest('label')?.textContent.includes('円')?'1':'0.1'),dec=Math.min(3,Math.max((step.split('.')[1]||'').length,(value.split('.')[1]||'').length)),n=Number(value||0),ints=Math.max(3,String(Math.floor(Number(input.max)||Math.max(n,input.closest('label')?.textContent.includes('円')?999999:999))).length);
    const fixed=n.toFixed(dec).padStart(ints+(dec?dec+1:0),'0').replace('.','');
    return {parts:Array.from({length:ints+dec},(_,i)=>({name:i<ints?(['一','十','百','千','万','十万','百万'][ints-i-1]||'桁')+'の位':'小数'+(i-ints+1)+'桁',values:range(0,9),selected:fixed[i]||'0'})),join:vs=>{
      const raw=vs.join('');
      return String(Number(dec?raw.slice(0,-dec)+'.'+raw.slice(-dec):raw))
    },decimalAt:dec?ints:-1}
  }

  const d=value?new Date(type==='time'?'2000-01-01T'+value:type==='date'?value+'T12:00:00':value):now,valid=Number.isFinite(+d)?d:now,parts=[];
  if(type!=='time')parts.push({name:'年',values:range(Math.min(1900,valid.getFullYear()),Math.max(now.getFullYear()+10,valid.getFullYear())),selected:String(valid.getFullYear())},{name:'月',values:range(1,12),selected:String(valid.getMonth()+1)},{name:'日',values:range(1,31),selected:String(valid.getDate())});
  if(type!=='date')parts.push({name:'時',values:range(0,23),selected:String(valid.getHours())},{name:'分',values:range(0,59),selected:String(valid.getMinutes())});
  if((type==='time'||type==='datetime-local')&&input.step==='1')parts.push({name:'秒',values:range(0,59),selected:String(valid.getSeconds())});
  return {parts,join:vs=>{
    const a=type==='time'?[]:vs.slice(0,3);
    if(a.length&&new Date(Number(a[0]),Number(a[1])-1,Number(a[2])).getMonth()!==Number(a[1])-1)throw Error('その月にない日付です。日を選び直してください');
    const dt=a.length?a[0]+'-'+pad(a[1])+'-'+pad(a[2]):'';
    return dt+(type==='datetime-local'?'T':'')+(type!=='date'?vs.slice(type==='time'?0:3).map(pad).join(':'):'')
  }}
}

function openWheel(input) {
  const spec=wheelParts(input);
  const label=input.closest('label')?.childNodes[0]?.textContent?.trim()||'数値・日時';
  modal('<h2>'+esc(label)+'</h2><p class="hint">上下になぞって選び、「この値にする」を押します。</p><div class="wheel-group">'+spec.parts.map((p,i)=>(i===spec.decimalAt?'<strong class="decimal-dot">.</strong>':'')+'<div class="wheel-column"><small>'+esc(p.name)+'</small><div class="wheel-list" data-wheel="'+i+'" role="listbox" aria-label="'+esc(p.name)+'">'+p.values.map(v=>'<button type="button" role="option" aria-selected="'+(v===p.selected)+'" data-wheel-value="'+v+'">'+v+'</button>').join('')+'</div></div>').join('')+'</div><p id="wheel-error" role="alert"></p><button type="button" id="wheel-use" class="primary">この値にする</button><button type="button" id="wheel-empty">未記録にする</button>');
  const lists=[...$('#dialog').querySelectorAll('[data-wheel]')];
  lists.forEach((el,i)=>{
    const p=spec.parts[i];
    el.scrollTop=p.values.indexOf(p.selected)*48;
    const mark=()=>{
      const index=Math.max(0,Math.min(p.values.length-1,Math.round(el.scrollTop/48)));
      el.querySelectorAll('[role=option]').forEach((b,j)=>b.setAttribute('aria-selected',String(j===index)))
    };
    el.onscroll=mark;
    el.querySelectorAll('[data-wheel-value]').forEach(b=>b.onclick=()=>{
      el.scrollTop=p.values.indexOf(b.dataset.wheelValue)*48;
      mark()
    });
    mark()
  });
  $('#wheel-use').onclick=()=>{
    try{
      const val=spec.join(lists.map((el,i)=>spec.parts[i].values[Math.max(0,Math.min(spec.parts[i].values.length-1,Math.round(el.scrollTop/48)))]));
      if(input.type==='number'){
        const n=Number(val);
        if(input.min!==''&&n<Number(input.min)||input.max!==''&&n>Number(input.max))throw Error('入力できる範囲を確認してください')
      }else if(input.min&&val<input.min||input.max&&val>input.max)throw Error('指定できる日時の範囲を確認してください');
      input.value=val;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      close()
    }catch(e){
      $('#wheel-error').textContent=e.message
    }
  };
  $('#wheel-empty').onclick=()=>{
    input.value='';
    input.dispatchEvent(new Event('change',{bubbles:true}));
    close()
  }
}

function enhanceInputs(root=document) {
  root.querySelectorAll('input[type=number],input[type=date],input[type=time],input[type=datetime-local]').forEach(input=>{
    if(input.dataset.wheelReady||input.id==='receipt-fallback')return;
    input.dataset.wheelReady='1';
    input.readOnly=true;
    input.setAttribute('aria-description','タップでダイヤル入力。キー入力も選べます。');
    input.onclick=()=>{
      if(input.readOnly&&!input.disabled)openWheel(input)
    };
    const buttons=document.createElement('div');
    buttons.className='input-methods';
    buttons.innerHTML='<button type="button">ダイヤルで選ぶ</button><button type="button">キー入力</button>';
    buttons.children[0].onclick=()=>openWheel(input);
    buttons.children[1].onclick=()=>{
      input.readOnly=false;
      input.focus()
    };
    const options=document.createElement('details');options.className='input-method-options';
    const summary=document.createElement('summary');summary.textContent='キー入力など';options.append(summary,buttons);
    input.after(options)
  })
}

function diaperForm(kind, old) {
  if(!old)date=day(new Date());
  const legacy=old?.kind==='両方';
  form((old?'訂正：':'毎日の記録：')+(legacy?'旧版のおしっこ・うんち':kind),dateField(old?.at||new Date())+paletteHTML(kind,old)+choice('amount','量',['少','並','多'],old?.amount)+(kind==='うんち'||legacy?choice('texture','固さ',['水状','柔らかい','普通','硬い'],old?.texture):'')+'<label>補足<textarea name="memo">'+esc(old?.memo||'')+'</textarea></label>',async f=>{
    const at=new Date(f.get('at'));
    if(!Number.isFinite(+at)||!old&&day(at)!==day(new Date()))throw Error('今日の日付で記録してください。過去の訂正は「記録を見る」から行えます');
    const color=String(f.get('color')||''),colorHex=String(f.get('colorHex')||'');
    if(colorHex&&!/^#[0-9a-f]{6}$/i.test(colorHex))throw Error('色を選び直してください');
    const r={...old,id:old?.id||uid(),type:'diaper',kind:legacy?'両方':kind,at:at.toISOString(),amount:String(f.get('amount')||''),color,colorHex,texture:String(f.get('texture')||''),memo:String(f.get('memo')||'')};
    const before=state.records;
    state.records=state.records.filter(x=>x.id!==r.id).concat(r);
    try{
      await persist()
    }catch(e){
      state.records=before;
      throw e
    }
  });
  bindPalette();
  if(!old)lockToday()
}

function updateHeaderClock() {
  updateHeaderClockFromHeader();
  const line=$('#clock-profile');
  if(line){
    const p=state?.profile;
    line.textContent=(p?.birth?'誕生日 '+p.birth.replaceAll('-','／'):'出産予定日 '+(p?.due||'未登録').replaceAll('-','／'))+' ／ '+(p?.babyName||'名前未登録');
    line.setAttribute('aria-label',line.textContent+'。タップして変更')
  }
  const p=state?.profile;
  if(!p?.birth)$('#clock-age').textContent='出産前：生後の日数・経過時間は出生後に表示';
  if(p?.birth&&p.birthTime){
    const b=new Date(p.birth+'T'+p.birthTime),n=new Date();
    if(Number.isFinite(+b)&&b<=n){
      const sec=Math.floor((n-b)/1000);
      $('#clock-age').textContent='生後 '+Math.floor(sec/86400)+'日 '+Math.floor(sec%86400/3600)+'時間 '+Math.floor(sec%3600/60)+'分 '+sec%60+'秒'
    }
  }
}

function choice(name, title, values, value) {
  return '<fieldset><legend>'+title+'（任意）</legend><div class="choices">'+['未記録',...values].map(x=>'<label><input type="radio" name="'+name+'" value="'+(x==='未記録'?'':x)+'" '+((value||'未記録')===x?'checked':'')+'><span>'+x+'</span></label>').join('')+'</div></fieldset>'
}

function lockToday() {
  const input=$('#form [name="at"]');
  if(input){
    input.min=day(new Date())+'T00:00';
    input.max=day(new Date())+'T23:59';
    const text=document.createElement('p');
    text.className='hint';
    text.textContent='保存先：今日 '+day(new Date());
    input.parentElement.after(text)
  }
}

function shiftDay(n) {
  const d=new Date();
  d.setDate(d.getDate()+n);
  return day(d)
}

function dateShortcuts() {
  return '<div class="date-shortcuts"><button data-day-offset="0">今日</button><button data-day-offset="-1">昨日</button><button data-day-offset="-2">一昨日</button><label>日付<input type="date" id="leaf-date" value="'+date+'"></label></div>'
}

function bindDates(v) {
  v.querySelectorAll('[data-day-offset]').forEach(b=>b.onclick=()=>{
    date=shiftDay(Number(b.dataset.dayOffset));
    render()
  });
  if($('#leaf-date'))$('#leaf-date').onchange=e=>{
    if(e.target.value){
      date=e.target.value;
      render()
    }
  }
}

function matchLeaf(r, k) {
  if(k==='poop'||k==='pee')return r.type==='diaper'&&(r.kind===(k==='poop'?'うんち':'おしっこ')||r.kind==='両方');
  if(k==='height'||k==='weight')return r.type==='growth'&&Number.isFinite(r[k]);
  if(k==='mamaheight'||k==='mamaweight')return r.type==='mamagrowth'&&Number.isFinite(r[k.slice(4)]);
  if(k==='babysleep'||k==='mamasleep')return r.type==='sleep'&&r.who===(k==='babysleep'?'baby':'mama');
  return r.type===({condition:'mama'}[k]||k)
}

function addFromFolders(type, old=null, who='baby') {
  if(type==='diaper'){
    diaperForm(old?.kind||'うんち',old);
    return
  }
  if(!old)date=day(new Date());
  addFromUsability(type,old,who);
  if(!old&&page==='daily')lockToday()
}

function descriptionFromFolders(r) {
  if(r.type==='diaper')return [r.kind,r.amount?'量：'+r.amount:'量：未記録',r.color?'色：'+r.color:'色：未記録',r.kind!=='おしっこ'?'固さ：'+(r.texture||'未記録'):''].filter(Boolean).join(' ／ ');
  return descriptionFromApp(r)
}

function noteForm(d) {
  noteFormFromAdministration(d);
  if(page==='daily'){
    const el=$('#form [name="date"]');
    if(el){
      el.readOnly=true;
      el.value=day(new Date())
    }
  }
}

function motherGrowth(old) {
  motherGrowthFromExtra(old);
  if(!old&&page==='daily')lockToday()
}

function sleepLocal(d) {
  const x=new Date(d);
  return Number.isFinite(+x)?localTime(x)+':'+String(x.getSeconds()).padStart(2,'0'):''
}

function sleepHours(ms) {
  if(!Number.isFinite(ms)||ms<=0)return '未計算';
  const minutes=Math.round(ms/60000);
  return minutes?Math.floor(minutes/60)+'時間'+minutes%60+'分':'1分未満'
}

function sleepEntryForm(who='baby', old=null) {
  ensureUX();
  const person=who==='mama'?'ママ':'赤ちゃん',legacy=!old?state.activeSleep?.[who]:null,legacyAt=legacy?.at,epoch=dataEpoch;
  const start=old?.at||legacyAt;
  form(person+'の睡眠を記録','<p class="hint">入眠・起床の両方の日時を入力し、保存してください。昼寝なども一回ずつ記録できます。</p>'+(legacy?'<p class="legacy-sleep-notice">旧版で保存した入眠時刻を引き継いでいます。起床時刻を入力すると、一回分の睡眠記録になります。</p>':'')+'<label>入眠日時<input name="at" type="datetime-local" step="1" required value="'+(start?sleepLocal(start):'')+'"></label><label>起床日時<input name="end" type="datetime-local" step="1" required value="'+(old?.end?sleepLocal(old.end):'')+'"></label><p id="sleep-duration" class="sleep-duration" role="status">両方の日時を入力すると睡眠時間を表示します。</p><label>補足<textarea name="memo">'+esc(old?.memo||'')+'</textarea></label><p class="hint">日をまたぐ睡眠は、それぞれの日に重なる分を一日合計へ加えます。重なる睡眠は一日合計で二重に数えません。</p>',async f=>{
    if(epoch!==dataEpoch||dataWiping)throw Error('画面を開き直してください');
    const at=new Date(f.get('at')),end=new Date(f.get('end')),now=new Date();
    if(!Number.isFinite(+at)||!Number.isFinite(+end))throw Error('入眠・起床の両方の日時を入力してください');
    if(at>now||end>now)throw Error('入眠・起床は現在以前の日時を指定してください');
    if(end<=at)throw Error('起床日時は入眠日時より後にしてください');
    if(end-at>86400000&&!confirm('24時間を超える睡眠です。入力どおり保存しますか？'))throw Error('日時を確認してください');
    if(legacy&&state.activeSleep?.[who]?.at!==legacyAt)throw Error('旧版の入眠記録が変更されています。開き直してください');
    const record={...old,id:old?.id||uid(),type:'sleep',who,at:at.toISOString(),end:end.toISOString(),memo:String(f.get('memo')||'')},previous=state.records,previousActive=state.activeSleep;
    state.records=previous.filter(r=>r.id!==record.id).concat(record);
    if(legacy){
      state.activeSleep={...previousActive};
      delete state.activeSleep[who]
    }
    try{
      await persist()
    }catch(e){
      state.records=previous;
      state.activeSleep=previousActive;
      throw e
    }
  });
  const f=$('#form'),preview=$('#sleep-duration');
  const update=()=>{
    const at=new Date(f.querySelector('input[name=at]').value),end=new Date(f.querySelector('input[name=end]').value);
    if(!Number.isFinite(+at)||!Number.isFinite(+end)){
      preview.textContent='両方の日時を入力すると睡眠時間を表示します。';
      return
    }
    if(end<=at){
      preview.textContent='起床日時は入眠日時より後にしてください。';
      return
    }
    const rows=state.records.filter(r=>r.id!==old?.id).concat({type:'sleep',who,at:at.toISOString(),end:end.toISOString()}),d=day(at),minutes=BabyCore.sleepMinutes(rows,who,d);
    preview.textContent='今回の睡眠：'+sleepHours(end-at)+' ／ '+d+' の合計（入力分を含む）：'+(minutes?duration(minutes):'1分未満')
  };
  f.addEventListener('input',update);
  f.addEventListener('change',update);
  update()
}

function sleepToggle(who) {
  sleepEntryForm(who)
}

function activeSleepForm(who) {
  sleepEntryForm(who)
}

function add(type, old=null, who='baby') {
  if(type==='sleep')sleepEntryForm(old?.who||who,old);else addFromDailyRecords(type,old,who)
}

function ensureUX() {
  ensureExtra();
  state.prefs={...prefsDefault(),...(state.prefs||{})};
  state.activeSleep??={};
  state.meta??={revision:0,lastExportAt:'',lastExportRevision:0};
  state.meta.revision??=0;
  state.meta.lastExportRevision??=0;
  state.meta.lastExportAt??='';
  if(observedState===null)observedState=contentSignature()
}

function elapsed(at) {
  const m=Math.max(0,Math.floor((Date.now()-new Date(at))/60000));
  return m<60?m+'分前':m<1440?Math.floor(m/60)+'時間'+m%60+'分前':Math.floor(m/1440)+'日前'
}

function agoRecord(types) {
  return state.records.filter(r=>types.includes(r.type)&&new Date(r.at)<=new Date()).sort((a,b)=>b.at.localeCompare(a.at))[0]
}

async function quickRecord(r) {
  if(quickBusy)return;
  quickBusy=true;
  const rec={id:uid(),at:new Date().toISOString(),memo:'',...r};
  try{
    state.records.push(rec);
    await persist();
    date=day(new Date());
    render();
    setUndo(description(rec)+'を記録しました',async()=>{
      state.records=state.records.filter(x=>x.id!==rec.id);
      await persist()
    })
  }catch(e){
    state.records=state.records.filter(x=>x.id!==rec.id);
    notify('保存できませんでした')
  }finally{
    quickBusy=false
  }
}

function setupForm(first) {
  const p=state.prefs;
  form(first?'はじめに（あとで変更できます）':'表示と初期設定',`<label>呼び名（任意）<input name="babyName" value="${esc(state.profile.babyName||'')}"></label><label>実際の出生日（出産前は空欄）<input type="date" name="birth" value="${state.profile.birth}"></label><label>出生時刻（任意）<input type="time" name="birthTime" step="1" value="${esc(state.profile.birthTime||'')}"></label><label>出産予定日<input type="date" name="due" value="${state.profile.due}"></label><p>使う項目だけ表示</p>${[['breast','母乳'],['milk','ミルク'],['pumped','搾母乳'],['diaper','おむつ'],['sleep','睡眠'],['food','離乳食']].map(([k,n])=>`<label class="check"><input type="checkbox" name="${k}" ${p[k]?'checked':''}><span>${n}</span></label>`).join('')}<label>よく使う量（mL・カンマ区切り）<input name="amounts" inputmode="decimal" value="${p.milkAmounts.join(',')}"></label><p class="hint">記録はこのブラウザ内に保存。機種変更前にはバックアップを出力してください。記録は任意です。</p>`,async f=>{
    const birth=String(f.get('birth'));
    if(birth&&birth>day(new Date()))throw Error('出生日に未来の日は登録できません');
    const birthTime=String(f.get('birthTime')||'');
    if(birth&&birthTime&&new Date(birth+'T'+birthTime)>new Date())throw Error('出生日時に未来の時刻は登録できません');
    const amounts=String(f.get('amounts')).split(/[,、\s]+/).filter(Boolean).map(Number);
    if(amounts.length>8||amounts.some(n=>!Number.isFinite(n)||n<=0||n>1000))throw Error('量は1～1000 mL、候補は8個までにしてください');
    for(const k of ['milk','pumped','breast','diaper','sleep','food'])state.prefs[k]=f.has(k);
    state.prefs.milkAmounts=[...new Set(amounts)];
    state.prefs.setupDone=true;
    state.profile.birth=birth;
    state.profile.birthTime=String(f.get('birthTime')||'');
    state.profile.due=String(f.get('due'));
    state.profile.babyName=String(f.get('babyName')).trim();
    await persist()
  });
  $('#cancel').textContent=first?'あとで設定':'戻る';
  const later=document.createElement('button');later.type='button';later.id='setup-later';later.textContent='あとで設定して使う';
  later.onclick=async()=>{if(!await checkDrafts(openDraftForms()))return;modalLayers=[];const d=$('#dialog');if(d.open)d.close();d.innerHTML='';page='home';render();notify('初期設定はTOPの「初期設定・出産準備」から、いつでも変更できます')};
  $('#form h2').after(later)
}

function calendarDownload(title, d, t, location='', memo='') {
  if(!compareDate(d)){
    notify('日付を登録してからカレンダーへ保存してください');
    return
  }
  const stamp=d.replace(/-/g,'')+(t?'T'+t.replace(':','')+'00':'');
  const clean=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/[,;]/g,c=>'\\'+c).replace(/\r/g,'');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Riccyan//Baby Diary//JA','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+uid()+'@riccyan-baby','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),t?'DTSTART;TZID=Asia/Tokyo:'+stamp:'DTSTART;VALUE=DATE:'+stamp,'SUMMARY:'+clean(title),'LOCATION:'+clean(location),'DESCRIPTION:'+clean(memo),'END:VEVENT','END:VCALENDAR'];
  saveBytes('baby-appointment.ics',utf8.encode(lines.join('\r\n')+'\r\n'),'text/calendar;charset=utf-8');
  notify('カレンダー用ファイルを保存しました。開いて登録してください')
}

function taskCalendarUX(v) {
  v.querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>{
    const t=state.tasks.find(x=>x.id===b.dataset.task);
    task(t);
    const btn=document.createElement('button');
    btn.type='button';
    btn.textContent='カレンダー用ファイルを保存';
    btn.onclick=()=>{
      const f=new FormData($('#form'));
      calendarDownload(String(f.get('text')),String(f.get('due')),'')
    };
    $('#form').append(btn)
  })
}

function receiptChildAmount(r) {
  return r.mixed?r.childAmount??null:r.amount??null
}

function feedMenuFromUsability() {
  const recent=agoRecord(['milk','breast']);
  const kinds=[state.prefs.breast?['breast','母乳']:null,state.prefs.milk?['milk','ミルク']:null,state.prefs.pumped?['pumped','搾母乳']:null].filter(Boolean);
  if(recent){
    const key=recent.type==='breast'?'breast':recent.kind==='搾母乳'?'pumped':'milk';
    kinds.sort((a,b)=>(a[0]===key?-1:0)-(b[0]===key?-1:0))
  }
  modal(`<h2>授乳</h2><div class="grid">${kinds.map(([k,n])=>`<button data-feed="${k}">${n}</button>`).join('')}</div><button id="feed-cancel">戻る</button>`);
  $('#dialog').querySelectorAll('[data-feed]').forEach(b=>b.onclick=()=>{
    if(b.dataset.feed==='breast')breastQuick();else milkQuick(b.dataset.feed==='pumped'?'搾母乳':'ミルク')
  });
  $('#feed-cancel').onclick=close
}

function addFromUsability(type, old=null, who='baby') {
  addFromApp(type,old,who);
  if(type==='food'){
    const input=$('#dialog input[name="food"]'),recent=[...new Set(state.records.filter(r=>r.type==='food').sort((a,b)=>b.at.localeCompare(a.at)).map(r=>r.food))].slice(0,8);
    const box=document.createElement('div');
    box.className='food-chips';
    box.innerHTML=recent.map((t,i)=>`<button type="button" data-food-index="${i}">${esc(t)}</button>`).join('');
    input.closest('label').after(box);
    box.querySelectorAll('button').forEach(b=>b.onclick=()=>{
      input.value=recent[Number(b.dataset.foodIndex)]
    })
  }
}

function expenseXlsx(records) {
  return expenseXlsxFromExpense(records.map(r=>({...r,amount:receiptChildAmount(r),memo:[r.memo,r.amount===null?'レシート全体：未記入':'レシート全体：'+r.amount+'円',r.mixed?'子供以外の品物も含む':''].filter(Boolean).join('\n')})))
}

// === views ===
'use strict';
// views: stable function declarations, with explicit dependencies.

function entryPageFromAdministration(v) {
  date=day(new Date());
  v.innerHTML=`<h2>記録する</h2><p class="hint">入力専用。保存済みのデータは「記録を見る」で確認します。</p><div class="quick-grid">${state.prefs.milk||state.prefs.pumped||state.prefs.breast?'<button id="entry-feed">授乳</button>':''}${state.prefs.diaper?'<button data-diaper="おしっこ">おしっこ</button><button data-diaper="うんち">うんち</button><button data-diaper="両方">両方</button>':''}${state.prefs.sleep?`<button id="entry-baby-sleep">赤ちゃん：${state.activeSleep.baby?'起きた':'寝た'}</button><button id="entry-mama-sleep">ママ：${state.activeSleep.mama?'起きた':'寝た'}</button>`:''}<button id="entry-growth">赤ちゃんの身長・体重</button><button id="entry-mamagrowth">ママの身長・体重</button><button id="entry-mama">ママの体調・服薬</button>${state.prefs.food?'<button id="entry-food">離乳食</button>':''}<button id="entry-note">その日のメモ</button><button id="entry-vaccine">予防接種を登録</button><button id="entry-receipt">レシートを撮影</button><button data-go="voice">声だけメモ</button></div>`;

  if($('#entry-feed'))$('#entry-feed').onclick=feedMenu;
  v.querySelectorAll('[data-diaper]').forEach(b=>b.onclick=()=>quickRecord({type:'diaper',kind:b.dataset.diaper}));
  if($('#entry-baby-sleep'))$('#entry-baby-sleep').onclick=()=>sleepToggle('baby');
  if($('#entry-mama-sleep'))$('#entry-mama-sleep').onclick=()=>sleepToggle('mama');
  $('#entry-growth').onclick=()=>add('growth');
  $('#entry-mamagrowth').onclick=()=>motherGrowth();
  $('#entry-mama').onclick=()=>add('mama');
  if($('#entry-food'))$('#entry-food').onclick=()=>add('food');
  $('#entry-note').onclick=()=>noteForm(day(new Date()));
  $('#entry-vaccine').onclick=()=>vaccineForm();
  $('#entry-receipt').onclick=()=>receiptForm();
  wireNavigation(v);

}

function searchPage(v) {
  v.innerHTML=`<h2>記録を検索</h2><label>文字の一部で検索<input id="record-search" type="search" value="${esc(searchText)}" placeholder="食品名・薬・病院・メモなど"></label><div id="search-results"></div>`;
  const draw=()=>{
    const q=searchText.trim().toLocaleLowerCase();
    if(!q){
      $('#search-results').innerHTML='<p class="hint">検索する文字を入力してください。</p>';
      return
    }
    const results=[];
    for(const r of state.records)if(r.type!=='photo'&&(fullDescription(r)+' '+(r.memo||'')).toLocaleLowerCase().includes(q))results.push({kind:'record',id:r.id,date:day(r.at),text:fullDescription(r)});
    for(const [d,t]of Object.entries(state.notes))if(t.toLocaleLowerCase().includes(q))results.push({kind:'note',date:d,text:t});
    for(const r of state.vaccines)if([r.name,r.dose,r.hospital,r.memo].join(' ').toLocaleLowerCase().includes(q))results.push({kind:'vaccine',id:r.id,date:r.date,text:r.name});
    for(const r of state.receipts)if([r.shop,r.items,r.category,r.memo].join(' ').toLocaleLowerCase().includes(q))results.push({kind:'receipt',id:r.id,date:r.date,text:r.shop+' '+r.items});
    results.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    $('#search-results').innerHTML='<p>'+results.length+'件</p>'+results.slice(0,200).map((r,i)=>`<div class="entry"><div class="info">${esc(r.date||'日付不明')}<br>${esc(r.text)}</div><button data-result="${i}">確認</button></div>`).join('')+(results.length>200?'<p>先頭200件を表示。検索語を追加して絞れます。</p>':'');
    $('#search-results').querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>{
      const r=results[Number(b.dataset.result)];
      if(r.kind==='note'){
        date=r.date;
        go('day')
      }else openItem(r.kind,r.id)
    })
  };
  $('#record-search').oninput=e=>{
    searchText=e.target.value;
    draw()
  };
  draw()
}

function renderPrep(v) {
  v.innerHTML=`<h2>準備と予定</h2><label>今の時期<select id="stage">${['入院準備','入院中','出産後・入院中','退院後・育児'].map(s=>`<option ${state.profile.stage===s?'selected':''}>${s}</option>`).join('')}</select></label><button id="taskadd">＋ 持ち物・予定・確認事項</button>${state.tasks.sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')).map(t=>`<div class="entry"><label class="check ${t.done?'done':''}"><input type="checkbox" data-check="${t.id}" ${t.done?'checked':''}><span>${esc(t.text)}<small>${esc(t.due||'期限なし')}</small></span></label><button data-task="${t.id}">変更</button></div>`).join('')}<h3>病院・相談先・個別の指示</h3><textarea id="contacts" placeholder="病院名、電話番号、病院からの案内など">${esc(state.contacts)}</textarea><small>自動保存。電話番号は端末の電話帳にも登録してください。</small>`;
  $('#stage').onchange=async e=>{
    state.profile.stage=e.target.value;
    await persist()
  };
  $('#contacts').oninput=()=>{
    state.contacts=$('#contacts').value;
    persist()
  };
  $('#taskadd').onclick=()=>task();
  v.querySelectorAll('[data-check]').forEach(c=>c.onchange=async()=>{
    state.tasks.find(t=>t.id===c.dataset.check).done=c.checked;
    await persist();
    render()
  });
  v.querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>task(state.tasks.find(t=>t.id===b.dataset.task)))
}

function healthCardFromClinic(v) {
  ensureClinic();
  const d=date,rs=state.records.filter(r=>day(r.at)===d),s=BabyCore.summary(state.records,d),items=dayItems(d),latest=type=>rs.filter(r=>r.type===type).sort((a,b)=>b.at.localeCompare(a.at))[0],growth=latest('growth'),morning=latest('morning'),count=kind=>rs.filter(r=>r.type==='diaper'&&(r.kind===kind||r.kind==='両方')).length;

  const clinical=clinicalMeasurements(d);
  const temperatureText=r=>r?r.temperature+' ℃（'+time(r.at)+'）':'未記録';
  const measurements=(r,k,unit)=>r?.[k]===null||r?.[k]===undefined?'未記録':r[k]+' '+unit;

  v.innerHTML=topButtons()+'<h2>健康カルテ</h2><div class="health-dates"><button id="health-prev">前日</button><label>日付<input id="health-date" type="date" value="'+d+'"></label><button id="health-next">翌日</button></div><article class="health-sheet" id="health-sheet"><header><h3>'+esc(d.replaceAll('-','／'))+'　'+babyAgeOn(d)+'</h3><strong>'+esc(state.profile.babyName||'赤ちゃん')+'</strong><p id="weather-day-line" data-date="'+d+'"></p><small class="weather-credit">'+WEATHER_CREDIT+'</small></header><dl class="health-metrics">'+[['最新の体温',temperatureText(clinical.latestTemperature)],['当日の最高体温',temperatureText(clinical.highestTemperature)],['当日の身長',measurements(rs.filter(r=>r.type==='growth'&&r.height!==null).sort((a,b)=>b.at.localeCompare(a.at))[0],'height','cm')],['当日の体重',measurements(rs.filter(r=>r.type==='growth'&&r.weight!==null).sort((a,b)=>b.at.localeCompare(a.at))[0],'weight','kg')],['ミルク・搾母乳',s.milkCount?s.milk+' mL ／ '+s.milkCount+'回':'未記録'],['直接の母乳',rs.some(r=>r.type==='breast')?rs.filter(r=>r.type==='breast').length+'回（目安量は下段）':'未記録'],['排尿',count('おしっこ')?count('おしっこ')+'回':'未記録'],['排便',count('うんち')?count('うんち')+'回':'未記録'],['離乳食',s.food?s.food+'回':'未記録'],['赤ちゃんの睡眠',reportSleep('baby',d)],['ママの睡眠',reportSleep('mama',d)],['最新の顔色',rs.filter(r=>r.type==='morning'&&r.face).sort((a,b)=>b.at.localeCompare(a.at))[0]?.face||'未記録'],['最新のご機嫌',rs.filter(r=>r.type==='morning'&&r.mood).sort((a,b)=>b.at.localeCompare(a.at))[0]?.mood||'未記録']].map(([a,b])=>'<div><dt>'+a+'</dt><dd>'+esc(b)+'</dd></div>').join('')+'</dl><h4>その日の全記録</h4><div class="health-timeline">'+items.map(i=>'<section><time>'+esc(i.noTime?'時刻未登録':i.kind==='record'&&i.source.type==='sleep'?day(i.at)+' '+time(i.at)+' ～ '+day(i.source.end)+' '+time(i.source.end):day(i.at)!==d?day(i.at)+' '+time(i.at):time(i.at))+'</time><div><strong>'+esc(i.text)+'</strong>'+(i.source&&observationHex(i.source)?'<span class="health-colour" style="background:'+observationHex(i.source)+'" aria-label="'+esc(i.source.color)+'"></span>':'')+(i.memo?'<p class="prewrap">'+esc(i.memo)+'</p>':'')+'<button class="health-edit" data-health-kind="'+i.kind+'" data-health-id="'+esc(i.id)+'">詳細・訂正</button></div></section>').join('')+'</div><h4>その日のメモ</h4><p class="prewrap">'+esc(state.notes[d]||'未記録')+'</p><p class="hint">急な体調変化は記録より医療機関への相談・受診を優先してください。未記録はゼロ・異常なしを意味しません。睡眠は指定日に重なる時間を集計しています。</p></article><div class="health-footer"><button id="health-print">この日を印刷・PDF保存</button><button id="health-weather">天気を再取得</button><p>'+WEATHER_CREDIT+'</p></div><p class="hint">左右になぞると前日・翌日。上下で当日の詳細を読みます。記録が多い日は縦に続きます。</p>';

  const shift=n=>{
    const next=new Date(date+'T12:00:00');
    next.setDate(next.getDate()+n);
    date=day(next);
    render();
    window.scrollTo(0,0)
  };
  $('#health-prev').onclick=()=>shift(-1);
  $('#health-next').onclick=()=>shift(1);
  $('#health-date').onchange=e=>{
    if(compareDate(e.target.value)){
      date=e.target.value;
      render()
    }
  };
  $('#health-print').onclick=()=>window.print();
  $('#health-weather').onclick=()=>ensureWeather(date,true);
  v.querySelectorAll('[data-health-id]').forEach(b=>b.onclick=()=>openItem(b.dataset.healthKind,b.dataset.healthId));
  let touch=null;
  const sheet=$('#health-sheet');
  sheet.onpointerdown=e=>{
    if(e.target.closest('button,input,select,a'))return;
    touch={x:e.clientX,y:e.clientY,id:e.pointerId}
  };
  sheet.onpointerup=e=>{
    if(touch&&touch.id===e.pointerId){
      const dx=e.clientX-touch.x,dy=e.clientY-touch.y;
      if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.4)shift(dx<0?1:-1)
    }
    touch=null
  };
  sheet.onpointercancel=()=>touch=null;
  enhanceInputs(v);
  updateWeatherLine();
  wireNavigation(v);
  ensureWeather(d)
}

function healthCardFromDailyRecords(v) {
  healthCardFromClinic(v);
  const sheet=$('#health-sheet'),metrics=sheet.querySelector('.health-metrics');
  metrics.insertAdjacentHTML('afterend',latestGrowthHTML(date)+feedingSummary(date));
  const list=sheet.querySelector('.health-timeline');
  list.classList.add('event-timeline');
  list.innerHTML=eventsHTML(dayItems(date),date,healthLayout==='groups');
  list.insertAdjacentHTML('beforebegin','<div class="health-layout"><button id="health-groups" aria-pressed="'+(healthLayout==='groups')+'">項目ごと</button><button id="health-time" aria-pressed="'+(healthLayout==='time')+'">全記録を時刻順</button><p class="hint">各一覧の中も上下にスクロールできます。記録は省略していません。</p></div>');
  $('#health-groups').onclick=()=>{
    healthLayout='groups';
    render()
  };
  $('#health-time').onclick=()=>{
    healthLayout='time';
    render()
  };
  list.querySelectorAll('[data-health-id]').forEach(b=>b.onclick=()=>openItem(b.dataset.healthKind,b.dataset.healthId))
}

function colourCalendar(v, kind) {
  const [year,month]=colourMonth.split('-').map(Number),days=new Date(year,month,0).getDate(),pad=new Date(year,month-1,1).getDay();
  const rs=state.records.filter(r=>r.type==='diaper'&&(r.kind===kind||r.kind==='両方')&&day(r.at).startsWith(colourMonth)).sort((a,b)=>a.at.localeCompare(b.at));
  v.innerHTML=topButtons()+'<h2>'+kind+'の色・月間記録</h2><div class="month-navigation"><button id="colour-prev">前の月</button><strong>'+year+'年'+month+'月</strong><button id="colour-next">次の月</button></div><p class="hint">日にちを押すと詳細。一日に複数回あれば、すべての色を並べます。斜線は色未記録です。</p><div class="colour-calendar">'+['日','月','火','水','木','金','土'].map(x=>'<div class="weekday">'+x+'</div>').join('')+'<span></span>'.repeat(pad)+Array.from({length:days},(_,i)=>{
    const d=colourMonth+'-'+String(i+1).padStart(2,'0'),rows=rs.filter(r=>day(r.at)===d);
    return '<button class="colour-day" data-colour-day="'+d+'" aria-label="'+d+' '+rows.length+'件"><strong>'+(i+1)+'</strong><span class="day-swatches">'+rows.map(r=>'<i title="'+esc(time(r.at)+' '+(r.color||'色未記録'))+'" style="background:'+(observationHex(r)||'repeating-linear-gradient(45deg,#ddd 0 3px,#fff 3px 6px)')+'"></i>').join('')+'</span><small>'+ (rows.length?rows.length+'件':'—')+'</small></button>'
  }).join('')+'</div><p class="hint">独自の観察用色見本です。母子健康手帳の便色カードとは異なります。</p><p class="hint">医師には、記録した日時・色が変わった時期・量・便の固さ・気になる様子を伝えましょう。色だけで病気を判断する機能ではありません。</p>';

  const shift=n=>{
    const d=new Date(year,month-1+n,1);
    colourMonth=day(d).slice(0,7);
    render()
  };
  $('#colour-prev').onclick=()=>shift(-1);
  $('#colour-next').onclick=()=>shift(1);
  v.querySelectorAll('[data-colour-day]').forEach(b=>b.onclick=()=>{
    date=b.dataset.colourDay;
    go('leaf:'+(kind==='うんち'?'poop':'pee'))
  });
  wireNavigation(v)
}

function folderButtons(items) {
  return '<div class="folder-grid">'+items.map(([p,n])=>'<button data-go="'+p+'"><span class="folder-icon" aria-hidden="true">▱</span>'+esc(n)+'<span aria-hidden="true">›</span></button>').join('')+'</div>'
}

function leafRows(k, d) {
  const end=new Date(d+'T00:00:00');
  end.setDate(end.getDate()+1);
  return state.records.filter(r=>matchLeaf(r,k)&&(r.type==='sleep'?new Date(r.at)<end&&new Date(r.end)>new Date(d+'T00:00:00'):day(r.at)===d)).sort((a,b)=>a.at.localeCompare(b.at))
}

function leafPoints(k, range) {
  const end=new Date(date+'T23:59:59.999'),start=new Date(date+'T00:00:00');
  start.setDate(start.getDate()-Number(range)+1);
  if(['height','weight','mamaheight','mamaweight'].includes(k)){
    const field=k.startsWith('mama')?k.slice(4):k;
    return state.records.filter(r=>matchLeaf(r,k)&&new Date(r.at)>=start&&new Date(r.at)<=end).map(r=>({t:+new Date(r.at),v:r[field]}))
  }
  const ps=[];
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const key=day(d),rs=leafRows(k,key);
    let n=null;
    if(k==='expenses'){
      const a=state.receipts.filter(r=>r.date===key&&receiptChildAmount(r)!==null);
      if(a.length)n=a.reduce((v,r)=>v+receiptChildAmount(r),0)
    }else if(k==='babysleep'||k==='mamasleep'){
      if(rs.length)n=BabyCore.sleepMinutes(rs,k==='babysleep'?'baby':'mama',key)/60
    }else if(rs.length)n=k==='milk'?rs.reduce((a,r)=>a+r.amount,0):rs.length;
    if(n!==null)ps.push({t:+new Date(key+'T12:00:00'),v:n})
  }
  return ps
}

function leafChart(k, setting) {
  const points=leafPoints(k,setting.range).filter(p=>Number.isFinite(p.v)).sort((a,b)=>a.t-b.t);
  if(!points.length)return '<p class="empty">この期間に数値の記録がありません。</p>';
  const end=new Date(date+'T23:59:59'),start=new Date(date+'T00:00:00');
  start.setDate(start.getDate()-Number(setting.range)+1);
  const hi=Math.max(...points.map(p=>p.v),1)*1.1,x=t=>50+(t-start)/(end-start)*285,y=v=>140-v/hi*110,color=CHART_COLORS[setting.color]||CHART_COLORS['緑'];
  return '<svg class="chart" viewBox="0 0 360 185" role="img" aria-label="'+esc(leaves[k][0]+' '+points.length+'件 '+leaves[k][2])+'"><path d="M50 25V140H340" stroke="#aaa" fill="none"/><text x="2" y="30">'+Number(hi.toFixed(1))+'</text><text x="20" y="142">0</text>'+(setting.type==='線'?'<path d="'+points.map((p,i)=>(i?'L':'M')+x(p.t)+','+y(p.v)).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="2"/>':'')+points.map(p=>setting.type==='棒'?'<rect x="'+(x(p.t)-3)+'" y="'+y(p.v)+'" width="6" height="'+(140-y(p.v))+'" fill="'+color+'"><title>'+esc(day(p.t)+' '+p.v+' '+leaves[k][2])+'</title></rect>':'<circle cx="'+x(p.t)+'" cy="'+y(p.v)+'" r="4" fill="'+color+'"><title>'+esc(day(p.t)+' '+p.v+' '+leaves[k][2])+'</title></circle>').join('')+'<text x="50" y="170">'+day(start)+'</text><text x="338" y="170" text-anchor="end">'+date+'</text></svg>'
}

function leafViewFromFolders(v, k) {
  const [title,parent,unit]=leaves[k],s=state.chartSettings?.[k]||{range:'30',type:'線',color:'緑'},rs=leafRows(k,date);
  v.innerHTML='<h2>'+esc(title)+'</h2>'+dateShortcuts()+'<h3>'+date+' の記録</h3>'+(k==='notes'?'<p class="prewrap">'+esc(state.notes[date]||'未記録')+'</p><button id="leaf-note">訂正</button>':k==='expenses'?state.receipts.filter(r=>r.date===date).map(r=>'<button class="timeline" data-receipt="'+esc(r.id)+'">'+esc(r.shop||'店名未記入')+' '+(receiptChildAmount(r)??'未記入')+'円</button>').join('')||'<p>未記録です。</p>':rs.map(r=>'<article class="leaf-record"><strong>'+esc(day(r.at)+' '+time(r.at))+'</strong><p>'+esc(fullDescription(r))+'</p>'+(r.memo?'<p class="prewrap">'+esc(r.memo)+'</p>':'')+'<button data-edit="'+esc(r.id)+'">確認・訂正</button></article>').join('')||'<p>この日の記録はありません。色や固さを記録していなかった場合は、後からは復元できません。</p>')+(unit?'<h3>グラフ（'+esc(unit)+'）</h3><form id="leaf-chart-settings" class="graph-controls"><label>期間<select name="range">'+[['7','1週間'],['30','1か月'],['90','3か月']].map(([a,b])=>'<option value="'+a+'" '+(s.range===a?'selected':'')+'>'+b+'</option>').join('')+'</select></label><label>形<select name="type">'+['線','棒','点'].map(t=>'<option '+(s.type===t?'selected':'')+'>'+t+'</option>').join('')+'</select></label><label>色<select name="color">'+Object.keys(CHART_COLORS).map(t=>'<option '+(s.color===t?'selected':'')+'>'+t+'</option>').join('')+'</select></label><button>この項目の設定を保存</button></form>'+leafChart(k,s)+'<p class="hint">未記録日はゼロにしません。色・固さは上の日別一覧で確認します。数値の訂正は「確認・訂正」から行います。</p>':'');
  bindDates(v);
  v.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.edit));
  v.querySelectorAll('[data-receipt]').forEach(b=>b.onclick=()=>receiptForm(state.receipts.find(r=>r.id===b.dataset.receipt)));
  if($('#leaf-note'))$('#leaf-note').onclick=()=>noteForm(date);
  if($('#leaf-chart-settings'))$('#leaf-chart-settings').onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.target),old=state.chartSettings;
    state.chartSettings={...state.chartSettings,[k]:{range:f.get('range'),type:f.get('type'),color:f.get('color')}};
    try{
      await persist();
      render();
      notify('この項目のグラフ設定を保存しました')
    }catch(err){
      state.chartSettings=old;
      notify('設定を保存できませんでした')
    }
  }
}

function reviewPageFromFolders(v) {
  v.innerHTML='<h2>記録を見る</h2>'+folderButtons([['baby','赤ちゃん'],['mama','ママ'],['expense','支出・レシート'],['care','予防接種百科事典・記録'],['day','1日の全記録・受診用'],['search','すべての記録を検索'],['leaf:notes','日別メモ'],['prep','予定・持ち物・連絡先'],...(state.records.some(r=>r.type==='photo')?[['legacy-photos','旧写真の取り出し']]:[])]);
  wireNavigation(v)
}

function entryPage(v) {
  entryPageFromAdministration(v);
  v.querySelector('h2').textContent='毎日の記録';
  v.querySelector('.hint').textContent=day(new Date())+' の記録です。各項目を押して入力し、保存します。';
  v.querySelectorAll('[data-diaper]').forEach(b=>{
    if(b.dataset.diaper==='両方')b.remove();else b.onclick=()=>diaperForm(b.dataset.diaper)
  });
  const feed=$('#entry-feed');
  if(feed)feed.textContent='授乳（母乳・ミルク）';
  const vaccine=$('#entry-vaccine');
  vaccine.textContent='予防接種を選ぶ・登録';
  vaccine.onclick=()=>go('care')
}

function healthCard(v) {
  const dates=recordedHealthDates();
  if(!dates.length){
    v.innerHTML=topButtons()+'<h2>健康カルテ</h2><p>記録はありません。</p>';
    wireNavigation(v);
    return
  }
  const requested=date;
  date=closestRecordDate(date,dates);
  healthCardFromDailyRecords(v);
  const index=dates.indexOf(date),shift=n=>{
    const next=dates[index+n];
    if(next){
      date=next;
      render();
      window.scrollTo(0,0)
    }
  };
  $('#health-prev').textContent='前の記録日';
  $('#health-next').textContent='次の記録日';
  $('#health-prev').disabled=index===0;
  $('#health-next').disabled=index===dates.length-1;
  $('#health-prev').onclick=()=>shift(-1);
  $('#health-next').onclick=()=>shift(1);
  $('#health-date').onchange=e=>{
    if(compareDate(e.target.value)){
      date=e.target.value;
      render()
    }
  };
  const hint=document.createElement('p');
  hint.className='hint';
  hint.textContent=(requested!==date?'指定日の記録がないため '+date+' を表示。':'')+'天気だけの日は省き、記録のある日へ移動します。';
  $('.health-dates').after(hint);
  let start=null;
  const sheet=$('#health-sheet');
  sheet.onpointerdown=e=>{
    if(!e.target.closest('button,input,select,a'))start={x:e.clientX,y:e.clientY,id:e.pointerId}
  };
  sheet.onpointerup=e=>{
    if(start?.id===e.pointerId){
      const dx=e.clientX-start.x,dy=e.clientY-start.y;
      if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.4)shift(dx<0?1:-1)
    }
    start=null
  };
  sheet.onpointercancel=()=>start=null
}

function phonebookPage(v) {
  const entries=state.phoneBook||[];
  v.innerHTML=topButtons()+'<h2>電話帳・10件</h2><p class="hint">2秒押すと登録・変更。右端までスライドすると電話画面です。</p><div class="phone-rows">'+Array.from({length:10},(_,i)=>'<div class="phone-row"><div class="phone-track simple-phone" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="'+(i+1)+'件目 '+esc(entries[i]?.name||'未登録')+'、2秒長押しで設定" data-phone-index="'+i+'"><span class="phone-line"></span><span class="phone-symbol" aria-hidden="true">☎</span><span class="phone-card"><strong>'+String(i+1).padStart(2,'0')+'　'+esc(entries[i]?.name||'未登録')+'</strong><small>'+esc(entries[i]?.phone||'2秒押して登録')+'</small></span></div></div>').join('')+'</div>';
  v.querySelectorAll('[data-phone-index]').forEach(track=>{
    const i=Number(track.dataset.phoneIndex),card=track.querySelector('.phone-card');
    let start=null,progress=0;
    const reset=()=>{
      card.style.transform='';
      track.setAttribute('aria-valuenow','0');
      progress=0;
      start=null
    };
    const fired=bindHold(track,2000,()=>{
      reset();
      phoneEdit(i)
    });
    track.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'&&e.button!==0)return;
      start={x:e.clientX,y:e.clientY};
      track.setPointerCapture?.(e.pointerId)
    });
    track.addEventListener('pointermove',e=>{
      if(!start||fired())return;
      const dx=e.clientX-start.x,dy=e.clientY-start.y;
      if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>12){
        reset();
        return
      }
      const travel=Math.max(40,track.clientWidth-card.offsetWidth-12);
      progress=Math.max(0,Math.min(1,dx/travel));
      card.style.transform='translateX('+(progress*travel)+'px)';
      track.setAttribute('aria-valuenow',String(Math.round(progress*100)))
    });
    track.addEventListener('pointerup',()=>{
      const ready=progress>=.98&&!fired();
      reset();
      if(ready)phoneDetails(i)
    });
    track.addEventListener('pointercancel',reset);
    track.onkeydown=e=>{
      if(e.key==='Enter'||e.key==='F2'){
        e.preventDefault();
        phoneEdit(i)
      }else if(e.key==='End'){
        e.preventDefault();
        phoneDetails(i)
      }
    }
  });
  wireNavigation(v)
}

function reviewPage(v) {
  reviewPageFromFolders(v);
  v.querySelector('[data-go="expense"]')?.remove();
  if(state.receipts.length){
    const b=document.createElement('button');
    b.dataset.go='receipt-archive';
    b.textContent='旧レシート資料の取り出し';
    v.append(b);
    wireNavigation(v)
  }
}

function leafView(v, k) {
  leafViewFromFolders(v,k);
  const heading=Array.from(v.children).find(n=>n.tagName==='H3'&&n.textContent.startsWith('グラフ'));
  if(heading){
    const section=document.createElement('section');
    section.className='graph-first';
    let n=heading;
    while(n){
      const next=n.nextSibling;
      section.append(n);
      n=next
    }
    const shortcuts=v.querySelector('.date-shortcuts');
    shortcuts.after(section);
    section.querySelectorAll('.hint').forEach(n=>n.textContent=n.textContent.replace('上の日別一覧','下の日別一覧'));
    const range=state.chartSettings?.[k]?.range||'30',from=new Date(date+'T00:00:00');
    from.setDate(from.getDate()-Number(range)+1);
    const past=state.records.filter(r=>matchLeaf(r,k)&&new Date(r.at)>=from&&day(r.at)<date).sort((a,b)=>b.at.localeCompare(a.at));
    if(past.length){
      v.insertAdjacentHTML('beforeend','<h3>この期間の過去の記録（'+past.length+'件）</h3>'+past.slice(0,200).map(r=>'<article class="leaf-record"><strong>'+esc(day(r.at)+' '+time(r.at))+'</strong><p>'+esc(fullDescription(r))+'</p>'+(r.memo?'<p class="prewrap">'+esc(r.memo)+'</p>':'')+'<button data-past-edit="'+esc(r.id)+'">確認・訂正</button></article>').join('')+(past.length>200?'<p>新しい200件を表示しています。日付で絞り込めます。</p>':''));
      v.querySelectorAll('[data-past-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.pastEdit))
    }
  }
}

function render() {

  if (dataWiping) return;

  if (db) db.onversionchange = handleOtherReset;

  ensureClinic();

  ensureUX();

  ensureExtra();

  initialDue(state.profile);

  state.chartSettings ??= {};

  // Preserve old links while routing every supported page to one painter.

  if (page === 'pending-view') page = 'baby';

  if (page === 'growth' || page === 'graphs') page = 'review';

  if (page === 'mother') page = 'daily';

  if (page === 'vaccines') page = 'vaccine-view';

  if (['receipts', 'expense', 'receipt-view', 'leaf:expenses'].includes(page)) page = 'receipt-archive';

  if (page === 'visit') {

    page = 'day';

    doctorDay = true;

  }

  if (page !== 'visit') reportViewing = false;

  const v = $('#view'), home = page === 'home';

  document.querySelectorAll('.display-options').forEach(el => el.remove());

  $('#thumb-dock')?.remove();

  $('#nav').innerHTML = [['daily','毎日の記録'],['review','記録を見る'],['tools','初期設定・出産準備'],['alarms','音声アラーム']].map(([k,n]) => `<button data-go="${k}" class="${page===k||k==='review'&&['day','graphs','search','vaccine-view','receipt-view','legacy-photos','pending-view'].includes(page)?'active':''}">${n}</button>`).join('');

  $('#nav').hidden = true;

  document.body.classList.toggle('sign-hidden', signHidden);

  document.body.classList.remove('small-sign');

  document.body.classList.toggle('doctor-view', doctorDay);

  document.body.classList.toggle('camera-mode', page === 'camera');

  document.body.classList.toggle('alarm-mode', page === 'alarms');

  document.body.classList.toggle('focused-mode', !home);

  document.body.classList.toggle('gallery-mode', page === 'gallery');

  document.body.classList.toggle('only-clock', !home);

  const footer = document.querySelector('footer');

  footer.hidden = !home;

  $('#settings').textContent = home ? 'バックアップ・復元' : 'データ保存・復元';

  $('#settings').classList.add('backup-special');

  footer.querySelector('small').textContent = '記録はこのブラウザ内に保存されます';

  v.replaceChildren();

  switch (page) {
    case 'home':
      v.innerHTML = '<h2 class="top-marker">TOP <small>ここから選んでください</small></h2><div class="home-modes"><button data-go="daily">毎日の記録</button><button data-go="review">記録を見る</button><button data-go="tools">初期設定・出産準備</button><button data-go="alarms">音声アラーム</button><button data-go="health">健康カルテ<small class="doctor-subtitle">お医者様へ</small></button><a class="whowatch-button" href="https://whowatch.tv/" target="_blank" rel="noopener">ふわっち</a><button data-go="phonebook">電話帳</button><button data-go="gallery">写真館</button><button data-go="voice" class="quick-home">声だけメモ</button><button class="camera-home quick-home" data-go="camera">カメラ</button><a class="home-guide" role="button" href="ritchan-baby-guide.html" target="_blank" rel="noopener">説明書を読む</a></div>';
      if (!$('#company-logo')) footer.insertAdjacentHTML('beforeend','<div id="company-logo"><p class="usage-notice">※このアプリは、りっちゃんと、りっちゃんが利用を許可した方専用です。</p><img src="budo-company-logo.jpg" alt="Budo Company・ぶどうカンパニー" width="1024" height="1024" loading="lazy"></div>');
      break;
    case 'daily':
      entryPage(v);
      $('#entry-receipt')?.remove();
      v.querySelector('[data-go=voice]')?.remove();
      $('#entry-feed') && ($('#entry-feed').textContent = 'ミルク・授乳');
      v.querySelector('.quick-grid').insertAdjacentHTML('afterbegin','<button id="entry-morning">体温・顔色・ご機嫌</button>');
      $('#entry-morning').onclick = () => morningForm();
      v.insertAdjacentHTML('beforeend','<p id="weather-day-line" data-date="'+day(new Date())+'"></p><p class="weather-credit">'+WEATHER_CREDIT+'</p>');
      updateWeatherLine();
      for (const [id,who,label] of [['entry-baby-sleep','baby','赤ちゃん'],['entry-mama-sleep','mama','ママ']]) {

    const b = $('#'+id);

    if (b) {

      b.textContent = label+'の睡眠を記録';

      b.onclick = () => sleepEntryForm(who);

    }

  }
      if (state.prefs.sleep) v.insertAdjacentHTML('beforeend','<aside class="sleep-daily-total"><strong>'+day(new Date())+' の睡眠合計</strong><p>赤ちゃん：'+esc(reportSleep('baby',day(new Date())))+' ／ ママ：'+esc(reportSleep('mama',day(new Date())))+'</p></aside>');
      break;
    case 'review': reviewPage(v); v.insertAdjacentHTML('beforeend','<button data-go="health">健康カルテ</button>'); break;
    case 'baby': case 'mama':
      v.innerHTML = '<h2>'+folderNames[page]+'</h2>'+folderButtons(Object.entries(leaves).filter(([k,a])=>a[1]===page).map(([k,a])=>['leaf:'+k,a[0]]));
      break;
    case 'tools':
      settingsMenu(v);
      v.querySelector('h2').textContent = '初期設定・出産準備';
      $('#admin-backup')?.remove();
      v.insertAdjacentHTML('beforeend','<button id="tools-weather">天気の地域設定</button>');
      $('#tools-weather').onclick = weatherSettings;
      break;
    case 'prep': renderPrep(v); taskCalendarUX(v); break;
    case 'search': searchPage(v); break;
    case 'care': vaccineLibrary(v); break;
    case 'vaccine-view': vaccines(v); vaccineUX(v); v.querySelector('#new-vaccine')?.remove(); break;
    case 'legacy-photos': legacyPhotos(v); break;
    case 'receipt-archive': archiveReceipts(v); break;
    case 'voice': voiceView(v); $('#voice-record').onclick = () => startVoice(); break;
    case 'phonebook': phonebookPage(v); break;
    case 'pee-colours': case 'poop-colours': colourCalendar(v,page==='poop-colours'?'うんち':'おしっこ'); break;
    case 'health': case 'day': healthCard(v); break;
    case 'gallery': galleryPage(v); break;
    case 'alarms':
      alarmPage(v);
      $('#alarm-chips').querySelectorAll('.alarm-item').forEach((row,i)=>row.append(previewControls(()=>state.alarms[i]?.voice)));
      if (alarmDraft&&!state.alarms.some(a=>a.voice?.data===alarmDraft.data)) $('#alarm-manual').after(previewControls(()=>alarmDraft));
      compactAlarms();
      $('#alarm-stop').onclick = () => {

    stopAlarm('button');

    alarmMessage('停止しました。ほかの時刻の予定は有効です。');

  };
      updateAlarmFace();
      break;
    case 'camera':
      cameraPage(v);
      v.querySelector('.hint').textContent = '端末が対応する高解像度を優先します。保存時にアプリ独自の縮小は行いません。ブラウザで使えない撮影モードは「スマホのカメラを使う」から端末側で選んでください。';
      v.querySelector('.native-camera-button').firstChild.textContent = 'スマホのカメラを使う（端末側の画質設定）';
      break;
    default:
      if (page.startsWith('vax:')) vaccineArticle(v,page.slice(4));
      else if (page.startsWith('leaf:')&&leaves[page.slice(5)]) {

    leafView(v,page.slice(5));

    if (page==='leaf:milk') v.querySelector('h2').insertAdjacentHTML('afterend',feedingSummary(date));

    if (page==='leaf:poop'||page==='leaf:pee') {

      const kind = page==='leaf:poop'?'poop':'pee';

      v.querySelector('h2').insertAdjacentHTML('afterend','<button class="colour-month-button" data-go="'+kind+'-colours">１か月の色を並べて見る</button>');

      v.querySelectorAll('.leaf-record').forEach(a=>{
        const b=a.querySelector('[data-edit]'),r=state.records.find(r=>r.id===b?.dataset.edit);
        if(r&&observationHex(r))a.insertAdjacentHTML('afterbegin','<span class="record-colour" style="background:'+observationHex(r)+'" aria-label="'+esc(r.color)+'"></span>')
      });

    }

    if (page==='leaf:height'||page==='leaf:weight') {

      const box=document.createElement('aside');
      box.className='growth-export';
      box.innerHTML='<button type="button" id="growth-export">Excel用に保存</button><small>赤ちゃんの身長・体重を、全期間まとめて保存します。</small>';
      v.querySelector('h2').after(box);
      $('#growth-export').disabled=growthExportRows().length===0;
      $('#growth-export').onclick=exportBabyGrowth;

    }

  }
  }

  // One navigation/header pass after the page has been painted.

  if (['daily','review','tools','prep','search','voice','legacy-photos','vaccine-view'].includes(page)) showUndo();

  if (!home && !['phonebook','pee-colours','poop-colours','health','day','gallery','alarms','camera'].includes(page)) v.insertAdjacentHTML('afterbegin',topButtons());

  if (!home) v.querySelectorAll('button').forEach(b=>{
    if(!b.closest('.page-navigation')&&/^(戻る|前のページへ|TOPへ?)$/.test(b.textContent.trim()))b.hidden=true
  });

  const clock=$('#clock-strip');

  if (!$('#clock-profile')) $('#clock-now').insertAdjacentHTML('afterend','<button type="button" id="clock-profile" aria-label="名前・誕生日の設定"></button>');

  document.querySelector('main').prepend(clock);

  $('#clock-profile').onclick=()=>setupForm(false);

  updateHeaderClock();

  clock.setAttribute('aria-label',home?'現在日時と赤ちゃんの情報':'現在日時');

  if (headerFirstPaint) {

    headerFirstPaint=false;
    window.scrollTo(0,0);

  }

  $('#dialog').querySelectorAll('.milk-total').forEach(n=>n.outerHTML=feedingSummary());

  enhanceInputs(v);

  addNowButtons(v);

  wireNavigation();

  v.querySelectorAll('[data-go$="-colours"]').forEach(b=>b.onclick=()=>{
    colourMonth=date.slice(0,7);
    go(b.dataset.go)
  });

  watchChartDraft();

  lastRoute=page;

  if (page!=='gallery') stopGallery();

  if (home||page==='daily') {

    ensureWeather(day(new Date()));
    const yesterday=new Date();
    yesterday.setDate(yesterday.getDate()-1);
    ensureWeather(day(yesterday));

  }

  if (state&&!state.meta?.gallerySeeded&&!defaultGalleryBusy) {

    if(page==='gallery'){
      const e=$('#gallery-view .gallery-empty p');
      if(e)e.textContent='贈り物の写真5枚を準備しています…'
    }
    seedGiftGallery();

  }

}

// === media ===
'use strict';
// media: stable function declarations, with explicit dependencies.

function stopReceiptCamera() {
  cameraSession++;
  cameraOpening=false;
  if(cameraStream){
    cameraStream.getTracks().forEach(t=>t.stop());
    cameraStream=null
  }
  const video=$('#receipt-live');
  if(video)video.srcObject=null
}

function legacyPhotos(v) {
  const rs=state.records.filter(r=>r.type==='photo');
  v.innerHTML='<h2>旧版の保存写真</h2><p class="hint">新しい成長写真は登録しません。以前の写真は消さず、取り出せるよう保持しています。</p><button id="legacy-export">保存写真をまとめて取り出す</button><p>'+rs.length+'枚</p>';
  $('#legacy-export').onclick=()=>{
    const files={};
    for(const r of rs){
      const ext=r.image.startsWith('data:image/png')?'png':r.image.startsWith('data:image/webp')?'webp':'jpg';
      files['photo-'+day(r.at)+'-'+r.id+'.'+ext]=b64bytes(r.image.split(',')[1])
    }
    if(!rs.length){
      notify('保存写真はありません');
      return
    }
    saveBytes('legacy-growth-photos.zip',zipFiles(files),'application/zip');
    notify('写真の保存先を確認してください')
  }
}

function photo() {
  notify('成長写真の新規登録は廃止しました。写真はスマホの写真アプリをお使いください。')
}

function parseAlarmSpeech(text) {
  let s=String(text).normalize('NFKC').trim().replace(/[〇零一二三四五六七八九十]+(?=時|分)/g,x=>String(jpNumber(x)));
  const m=s.match(/(午前|午後|朝|夜)?\s*(\d{1,2})\s*(?:時|:)\s*(?:(\d{1,2})\s*分?|(半))?/);
  if(!m)return null;
  let h=Number(m[2]),min=m[4]?30:Number(m[3]||0);
  if(!Number.isInteger(min)||min>59||h>23)return null;
  const prefix=m[1];
  if(prefix){
    if(h>12)return null;
    h=h%12+(['午後','夜'].includes(prefix)?12:0)
  }else if(h>=1&&h<=12)return null;
  const label=s.slice(m.index+m[0].length).replace(/^[\s、,。に]+/,'').replace(/(?:の?アラーム(?:を設定)?|を設定して|をセットして)[。！!]?$/,'').trim();
  if(!label)return null;
  return {time:String(h).padStart(2,'0')+':'+String(min).padStart(2,'0'),text:label}
}

function alarmNext(time, now=new Date()) {
  const [h,m]=time.split(':').map(Number),d=new Date(now);
  d.setHours(h,m,0,0);
  if(d<=now)d.setDate(d.getDate()+1);
  return +d
}

async function writeAlarms(next) {
  const old=state.alarms;
  state.alarms=next;
  try{
    await persist()
  }catch(e){
    state.alarms=old;
    throw e
  }
}

function speakAlarm(s) {
  if(!window.speechSynthesis)return;
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(s);
    u.lang='ja-JP';
    speechSynthesis.speak(u)
  }catch(e){
  }
}

function alarmMessage(s) {
  if($('#alarm-message'))$('#alarm-message').textContent=s;else notify(s)
}

function alarmPage(v) {
  state.alarms??=[];
  v.innerHTML=topButtons()+'<div class="alarm-face"><h2>音声アラーム</h2><div id="alarm-big-clock" aria-label="現在時刻"></div><div id="alarm-next"></div><div id="alarm-countdown"></div><p id="alarm-ringing-text" role="status"></p></div><div class="alarm-ring-controls"><button id="alarm-stop">停止・ストップ</button><button id="alarm-snooze">5分スヌーズ</button></div><div id="alarm-chips">'+state.alarms.map(a=>'<div class="alarm-item"><button class="alarm-chip '+(a.enabled?'enabled':'')+'" data-alarm-id="'+esc(a.id)+'" aria-label="'+esc(a.time+' '+a.text+' '+(a.enabled?'オン':'オフ'))+'"><strong>'+esc(a.time)+'</strong><span>'+esc(Array.from(a.text).slice(0,5).join(''))+'</span><small>'+(a.enabled?'オン':'オフ')+'</small></button><button class="alarm-repeat '+(a.repeat?'active':'')+'" data-repeat="'+esc(a.id)+'" aria-pressed="'+a.repeat+'">毎日リピート</button><button data-alarm-edit="'+esc(a.id)+'">詳細・変更</button></div>').join('')+'</div><button id="alarm-hold" class="alarm-hold" style="touch-action:none">押しながら話す（最大10秒）</button><p id="alarm-message" role="status">例：午後六時、ミルク。録音した本人の声を再生します。</p><button id="alarm-manual">録音した声で時刻を選ぶ</button><button id="alarm-enable-sound">音を有効にする・試聴</button><p class="hint">最大10件。短押しでオン／オフ、1秒長押しで削除確認。リピートは毎日同じ時刻です。鳴動は最長10秒。「ストップ」の認識にはマイク許可が必要です。画面を開いて使う補助アラームです。別画面・画面ロック・終了中の鳴動は保証しません。音声認識はブラウザのサービスへ送信される場合があります。</p>';

  $('#alarm-stop').onclick=()=>stopAlarm();
  $('#alarm-snooze').onclick=snoozeAlarm;
  $('#alarm-manual').onclick=()=>alarmEdit();
  $('#alarm-enable-sound').onclick=()=>{
    alarmSoundArmed=true;
    speakAlarm('音声を有効にしました');
    alarmMessage('端末の音量と音声を確認してください。')
  };
  const b=$('#alarm-hold');
  b.oncontextmenu=e=>e.preventDefault();
  b.onpointerdown=e=>{
    if(e.button&&e.pointerType==='mouse')return;
    e.preventDefault();
    b.setPointerCapture?.(e.pointerId);
    beginAlarmHold()
  };
  b.onpointerup=e=>{
    e.preventDefault();
    endAlarmHold()
  };
  b.onpointercancel=endAlarmHold;
  b.onlostpointercapture=()=>{
    if(holdActive)endAlarmHold()
  };
  b.onkeydown=e=>{
    if(!e.repeat&&(e.key===' '||e.key==='Enter')){
      e.preventDefault();
      beginAlarmHold()
    }
  };
  b.onkeyup=e=>{
    if(e.key===' '||e.key==='Enter'){
      e.preventDefault();
      endAlarmHold()
    }
  };

  v.querySelectorAll('[data-alarm-id]').forEach(b=>{
    let timer=null,long=false,start=null;
    const cancel=()=>{
      clearTimeout(timer);
      timer=null
    };
    b.onpointerdown=e=>{
      if(e.pointerType==='mouse'&&e.button!==0)return;
      long=false;
      start={x:e.clientX,y:e.clientY};
      timer=setTimeout(()=>{
        long=true;
        deleteAlarm(b.dataset.alarmId)
      },1000)
    };
    b.onpointermove=e=>{
      if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>12){
        cancel();
        long=true
      }
    };
    b.onpointerup=cancel;
    b.onpointercancel=()=>{
      cancel();
      long=true
    };
    b.oncontextmenu=e=>e.preventDefault();
    b.onclick=()=>{
      cancel();
      if(!long)toggleAlarm(b.dataset.alarmId)
    };
    b.onkeydown=e=>{
      if(e.key==='Delete'){
        e.preventDefault();
        deleteAlarm(b.dataset.alarmId)
      }
    }
  });
  v.querySelectorAll('[data-repeat]').forEach(b=>b.onclick=async()=>{
    try{
      await writeAlarms(state.alarms.map(a=>a.id===b.dataset.repeat?{...a,repeat:!a.repeat}:a));
      render()
    }catch(e){
      alarmMessage('設定を保存できませんでした')
    }
  });
  v.querySelectorAll('[data-alarm-edit]').forEach(b=>b.onclick=()=>alarmEdit(state.alarms.find(a=>a.id===b.dataset.alarmEdit)));
  updateAlarmFace();
  wireNavigation(v)
}

function updateAlarmFaceFromAlarms() {
  if(page!=='alarms'||!$('#alarm-big-clock'))return;
  const now=new Date();
  $('#alarm-big-clock').textContent=now.toLocaleTimeString('ja-JP',{hour12:false});
  const next=(state?.alarms||[]).filter(a=>a.enabled&&a.nextAt>=+now).sort((a,b)=>a.nextAt-b.nextAt)[0];
  $('#alarm-next').textContent=next?new Date(next.nextAt).toLocaleString('ja-JP')+'　'+next.text:'有効な次の予定はありません';
  const sec=next?Math.max(0,Math.ceil((next.nextAt-now)/1000)):0;
  $('#alarm-countdown').textContent=next?'残り '+Math.floor(sec/3600)+'時間 '+Math.floor(sec%3600/60)+'分 '+sec%60+'秒':'';
  $('#alarm-ringing-text').textContent=alarmRinging?'再生中：'+alarmRinging.text:'';
  $('#alarm-stop').disabled=!alarmRinging;
  $('#alarm-snooze').disabled=!alarmRinging
}

async function toggleAlarm(id) {
  try{
    await writeAlarms(state.alarms.map(a=>a.id===id?{...a,enabled:!a.enabled,nextAt:a.enabled?a.nextAt:alarmNext(a.time)}:a));
    render()
  }catch(e){
    alarmMessage('保存できませんでした')
  }
}

async function deleteAlarm(id) {
  const a=state.alarms.find(a=>a.id===id);
  if(!a||!confirm(a.time+' '+a.text+' を削除しますか？'))return;
  try{
    await writeAlarms(state.alarms.filter(a=>a.id!==id));
    if(alarmRinging?.id===id)stopAlarm();
    render()
  }catch(e){
    alarmMessage('削除を保存できませんでした')
  }
}

async function beginAlarmHoldFromAlarms() {
  if(holdActive||alarmFinalizing)return;
  if(state.alarms.length>=10){
    alarmMessage('10件までです。不要な項目を削除してください。');
    return
  }
  if(alarmRinging)stopAlarm();
  if(voiceRecorder?.state==='recording'){
    alarmMessage('声だけメモの録音を停止してから操作してください');
    return
  }
  holdActive=true;
  alarmText='';
  alarmDraft=null;
  const token=++holdToken;
  alarmMessage('マイクを準備中…初回の許可後、離した場合はもう一度押してください。');
  try{
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('録音にはHTTPSと対応ブラウザが必要です');
    const media=await navigator.mediaDevices.getUserMedia({audio:true});
    if(!holdActive||token!==holdToken||page!=='alarms'){
      media.getTracks().forEach(t=>t.stop());
      return
    }
    alarmMedia=media;
    const parts=[],r=new MediaRecorder(media);
    alarmRecording=r;
    const began=Date.now();
    r.ondataavailable=e=>{
      if(e.data.size)parts.push(e.data)
    };
    r.onstop=async()=>{
      clearTimeout(alarmRecordingTimer);
      media.getTracks().forEach(t=>t.stop());
      alarmMedia=null;
      alarmRecording=null;
      if(token!==holdToken)return;
      alarmFinalizing=true;
      try{
        const blob=new Blob(parts,{type:r.mimeType||parts[0]?.type||'audio/webm'});
        if(!blob.size)throw Error('音声を保存できませんでした');
        const data=await new Promise((resolve,reject)=>{
          const f=new FileReader();
          f.onload=()=>resolve(f.result);
          f.onerror=reject;
          f.readAsDataURL(blob)
        });
        await new Promise(resolve=>setTimeout(resolve,700));
        if(token!==holdToken||page!=='alarms')return;
        alarmDraft={data,seconds:Math.min(10,(Date.now()-began)/1000)};
        const parsed=parseAlarmSpeech(alarmText);
        if(parsed){
          await saveAlarmDraft(parsed.time,parsed.text);
          alarmDraft=null
        }else{
          alarmMessage('時刻・内容を確定できませんでした。録音は保持しています。午前／午後と時刻・内容を入力して保存してください。');
          alarmEdit()
        }
      }catch(e){
        alarmMessage(e.message||'録音を保存できませんでした')
      }finally{
        alarmFinalizing=false
      }
    };
    r.start();
    alarmMessage('録音中…話し終えたら指を離してください。');
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(SR){
      try{
        const rec=new SR();
        alarmRecognition=rec;
        rec.lang='ja-JP';
        rec.interimResults=true;
        rec.continuous=true;
        rec.onresult=e=>{
          if(token!==holdToken||page!=='alarms')return;
          alarmText=Array.from(e.results).map(x=>x[0].transcript).join('');
          alarmMessage('聞き取り：'+alarmText)
        };
        rec.onerror=()=>{
        };
        rec.start()
      }catch(e){
        alarmRecognition=null
      }
    }
    alarmRecordingTimer=setTimeout(endAlarmHold,10000)
  }catch(e){
    holdActive=false;
    alarmMessage(e.message||'マイクを使えませんでした')
  }
}

function endAlarmHold() {
  holdActive=false;
  clearTimeout(alarmRecordingTimer);
  if(alarmRecognition){
    try{
      alarmRecognition.stop()
    }catch(e){
    }
    alarmRecognition=null
  }
  if(alarmRecording?.state==='recording')alarmRecording.stop()
}

async function saveAlarmDraft(time, text, old=null, repeat=false) {
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!text.trim())throw Error('時刻と内容を入力してください');
  if(!old&&state.alarms.length>=10)throw Error('10件まで登録できます');
  const voice=old?.voice||alarmDraft;
  if(!voice?.data)throw Error('先に大きなボタンを押して声を録音してください');
  if(text.trim().length>200||voice.data.length>2000000)throw Error('音声または内容が大きすぎます。短く録音してください');
  const a={id:old?.id||uid(),time,text:text.trim(),voice,enabled:true,repeat,nextAt:alarmNext(time)};
  await writeAlarms(old?state.alarms.map(x=>x.id===a.id?a:x):state.alarms.concat(a));
  alarmSoundArmed=true;
  render();
  const d=new Date(a.nextAt);
  const answer=d.toLocaleTimeString('ja-JP',{hour:'numeric',minute:'2-digit',hour12:true})+'に'+a.text+'ですね。設定しました';
  alarmMessage(answer);
  speakAlarm(answer)
}

function alarmEditFromAlarms(old) {
  form(old?'音声アラームの変更':'録音した声でアラームを設定','<label>時刻<input name="time" type="time" required value="'+esc(old?.time||'')+'"></label><label>内容<input name="text" required maxlength="200" value="'+esc(old?.text||alarmText.replace(/^.*?(?:時|:)[\d分半\s、]*/,''))+'"></label><label class="check"><input name="repeat" type="checkbox" '+(old?.repeat?'checked':'')+'><span>毎日同じ時刻にリピート</span></label><p>'+((alarmDraft||old?.voice)?'録音した本人の声を使います。':'録音がありません。戻って大きなボタンを押しながら話してください。')+'</p>',async f=>{
    await saveAlarmDraft(String(f.get('time')),String(f.get('text')),old,f.has('repeat'));
    alarmDraft=null
  });
}

function leaveAlarmFromAlarms() {
  holdActive=false;
  holdToken++;
  endAlarmHold();
  if(alarmMedia){
    alarmMedia.getTracks().forEach(t=>t.stop());
    alarmMedia=null
  }
  alarmDraft=null;
  stopAlarm();
}

function nextGalleryIndex(length, current, random=Math.random) {
  if(length<2)return 0;
  return (current+1+Math.floor(random()*(length-1)))%length
}

function stopGallery() {
  clearInterval(galleryTimer);
  galleryTimer=null
}

function scheduleGallery() {
  stopGallery();
  if(galleryAuto&&page==='gallery'&&!document.hidden)galleryTimer=setInterval(()=>{
    if(page!=='gallery'||document.hidden||dataWiping)return;
    galleryIndex=nextGalleryIndex(state.gallery.length,galleryIndex);
    paintGallery()
  },20000)
}

function paintGalleryFromClinic() {
  const img=$('#gallery-photo'),r=state.gallery[galleryIndex];
  if(img&&r){
    img.src=r.data;
    img.alt=r.name||'写真';
    $('#gallery-counter').textContent=(galleryIndex+1)+'／'+state.gallery.length
  }
  if($('#gallery-auto'))$('#gallery-auto').textContent=galleryAuto?'自動：オン（20秒）':'自動：オフ'
}

function galleryPageFromClinic(v) {
  ensureClinic();
  if(galleryIndex>=state.gallery.length)galleryIndex=0;
  v.innerHTML='<section id="gallery-view" aria-label="写真館">'+(state.gallery.length?'<img id="gallery-photo" alt="写真">':'<div class="gallery-empty"><h2>写真館</h2><p>スマホの写真を10枚まで選べます。</p></div>')+'<div class="gallery-controls"><span id="gallery-counter"></span><button id="gallery-auto" '+(!state.gallery.length?'disabled':'')+'>自動：オフ</button><button id="gallery-manage">写真を選ぶ・整理</button></div><button id="gallery-exit">終了</button></section>';
  $('#gallery-exit').onclick=goHome;
  $('#gallery-manage').onclick=galleryManage;
  $('#gallery-auto').onclick=()=>{
    galleryAuto=!galleryAuto;
    paintGallery();
    scheduleGallery()
  };
  if($('#gallery-photo'))$('#gallery-photo').onclick=()=>{
    galleryIndex=nextGalleryIndex(state.gallery.length,galleryIndex);
    paintGallery()
  };
  paintGallery();
  scheduleGallery()
}

function stopPreview() {
  clearTimeout(previewTimer);
  previewTimer=null;
  if(previewAudio){
    previewAudio.pause();
    previewAudio.src='';
    previewAudio=null
  }
}

function playPreview(voice, status) {
  stopPreview();
  if(holdActive||alarmFinalizing){
    status.textContent='録音の終了を待ってください。';
    return
  }
  if(alarmRinging)stopAlarm();
  if(window.speechSynthesis)speechSynthesis.cancel();
  if(!voice?.data){
    status.textContent='先に声を録音してください。';
    return
  }
  previewAudio=new Audio(voice.data);
  previewAudio.loop=false;
  status.textContent='録音した声を試し聞きしています';
  const end=()=>{
    stopPreview();
    if(status.isConnected)status.textContent='試し聞き終了'
  };
  previewAudio.onended=end;
  previewAudio.play().catch(()=>{
    stopPreview();
    if(status.isConnected)status.textContent='再生できません。端末の音量・再生許可を確認してください。'
  });
  previewTimer=setTimeout(end,10000)
}

function previewControls(voice) {
  const box=document.createElement('section');
  box.className='voice-preview';
  const b=document.createElement('button'),stop=document.createElement('button'),status=document.createElement('p');
  b.type=stop.type='button';
  b.textContent='録音した声を試し聞き';
  stop.textContent='試し聞きを停止';
  status.setAttribute('role','status');
  b.onclick=()=>playPreview(voice(),status);
  stop.onclick=()=>{
    stopPreview();
    status.textContent='停止しました'
  };
  box.append(b,stop,status);
  return box
}

async function beginAlarmHold() {
  stopPreview();
  return beginAlarmHoldFromAlarms()
}

function alarmEditFromClinic(old) {
  alarmEditFromAlarms(old);
  $('#form h2').after(previewControls(()=>old?.voice||alarmDraft))
}

function voiceView(v) {
  v.innerHTML=`<h2>声だけメモ</h2><p id="voice-state" role="status"></p><div class="voice-controls"><button id="voice-record">録音</button><button id="voice-stop">停止（巻き戻し）</button><button id="voice-play">再生</button></div><p class="hint">最大5分・1件。画面を閉じても録音済み音声を残します。次の録音が保存できたら前の音声を置き換えます。画面ロック中の録音継続は保証できません。</p>`;
  $('#voice-record').onclick=startVoice;
  $('#voice-stop').onclick=stopVoice;
  $('#voice-play').onclick=playVoice;
  updateVoice()
}

function updateVoice() {
  const el=$('#voice-state');
  if(!el)return;
  el.textContent=voiceRecorder?.state==='recording'?'録音中 '+Math.min(300,Math.floor((Date.now()-voiceStarted)/1000))+'秒 ／ 300秒':voiceBusy?'音声を保存中…':state.voice?'保存済み '+state.voice.seconds+'秒（'+new Date(state.voice.at).toLocaleString('ja-JP')+'）':'まだ録音がありません';
  $('#voice-record').disabled=voiceBusy||voiceRecorder?.state==='recording';
  $('#voice-play').disabled=voiceBusy||!state.voice||voiceRecorder?.state==='recording'
}

function haltPlayer() {
  if(voicePlayer){
    voicePlayer.pause();
    voicePlayer.currentTime=0
  }
  if(voiceURL){
    URL.revokeObjectURL(voiceURL);
    voiceURL=null
  }
}

async function startVoiceFromExtra() {
  const token=dataEpoch;
  if(dataWiping)return;
  if(voiceBusy||voiceRecorder?.state==='recording')return;
  haltPlayer();
  try{
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('このブラウザでは録音できません。HTTPSで開いてください');
    voiceMedia=await navigator.mediaDevices.getUserMedia({audio:true});
    if(token!==dataEpoch||dataWiping){
      voiceMedia.getTracks().forEach(t=>t.stop());
      voiceMedia=null;
      return
    }
    const options=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    voiceRecorder=new MediaRecorder(voiceMedia,options?{mimeType:options}:undefined);
    const chunks=[];
    voiceRecorder.ondataavailable=e=>{
      if(e.data.size)chunks.push(e.data)
    };
    voiceRecorder.onstop=async()=>{
      if(token!==dataEpoch||dataWiping)return;
      clearInterval(voiceTimer);
      voiceMedia?.getTracks().forEach(t=>t.stop());
      voiceMedia=null;
      voiceBusy=true;
      updateVoice();
      const previous=state.voice;
      try{
        const blob=new Blob(chunks,{type:voiceRecorder.mimeType});
        if(!blob.size)throw Error('音声が空です');
        const data=await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=()=>resolve(reader.result);
          reader.onerror=reject;
          reader.readAsDataURL(blob)
        });
        if(token!==dataEpoch||dataWiping)return;
        state.voice={data,seconds:Math.min(300,Math.round((Date.now()-voiceStarted)/1000)),at:new Date().toISOString()};
        await persist();
        notify('録音を保存しました。前の音声を置き換えました。')
      }catch(e){
        if(token===dataEpoch&&!dataWiping){
          state.voice=previous;
          notify('音声を保存できません。前の録音は保持しました。')
        }
      }finally{
        if(token===dataEpoch&&!dataWiping){
          voiceBusy=false;
          voiceRecorder=null;
          updateVoice()
        }
      }
    };
    voiceRecorder.onerror=()=>{
      notify('録音が中断されました');
      stopVoice()
    };
    voiceStarted=Date.now();
    voiceRecorder.start(1000);
    voiceTimer=setInterval(()=>{
      if(Date.now()-voiceStarted>=300000)stopVoice();
      updateVoice()
    },250);
    updateVoice()
  }catch(e){
    voiceMedia?.getTracks().forEach(t=>t.stop());
    voiceMedia=null;
    notify(e.message||'マイクを許可してください')
  }
}

function stopVoice() {
  if(voiceRecorder?.state==='recording')voiceRecorder.stop();
  haltPlayer();
  updateVoice()
}

async function playVoice() {
  if(!state.voice)return;
  haltPlayer();
  voicePlayer=new Audio(state.voice.data);
  try{
    await voicePlayer.play()
  }catch(e){
    notify('この端末で音声を再生できません')
  }
}

function alarmPolicy() {
  return state.alarmSettings||{snoozeMinutes:5,ringSeconds:10}
}

function alarmPolicyForm() {
  const p=alarmPolicy();
  form('全アラーム共通の設定','<label>スヌーズ（分）<input type="number" name="snooze" min="1" max="60" step="1" required value="'+p.snoozeMinutes+'"></label><label>一回に鳴らす長さ（秒・最大10秒）<input type="number" name="seconds" min="1" max="10" step="1" required value="'+p.ringSeconds+'"></label><p class="hint">停止・音声ストップは現在再生中の1件を止めます。スヌーズはその1件だけを指定分後に再生します。ほかの予定は止めません。</p>',async f=>{
    const snoozeMinutes=Number(f.get('snooze')),ringSeconds=Number(f.get('seconds'));
    if(!Number.isInteger(snoozeMinutes)||snoozeMinutes<1||snoozeMinutes>60||!Number.isInteger(ringSeconds)||ringSeconds<1||ringSeconds>10)throw Error('設定範囲を確認してください');
    const old=state.alarmSettings;
    state.alarmSettings={snoozeMinutes,ringSeconds};
    try{
      await persist()
    }catch(e){
      state.alarmSettings=old;
      throw e
    }
  })
}

function compactAlarms() {
  const chips=$('#alarm-chips');
  if(!chips)return;
  chips.classList.add('alarm-slots');
  const rows=[...chips.querySelectorAll('.alarm-item')];
  rows.forEach((row,i)=>{
    const a=state.alarms[i],chip=row.querySelector('.alarm-chip');
    chip.innerHTML='<span class="alarm-number">'+String(i+1).padStart(2,'0')+'</span><strong>'+esc(a.time)+'</strong><span class="alarm-short">'+esc(Array.from(a.text).slice(0,10).join(''))+'</span><span>'+(a.enabled?'オン':'オフ')+'</span>';
    row.querySelectorAll('.alarm-repeat').forEach(b=>b.remove());
    const edit=row.querySelector('[data-alarm-edit]');
    if(edit)edit.textContent='設定';
    row.querySelectorAll('.voice-preview').forEach(b=>b.remove())
  });
  for(let i=rows.length;i<10;i++){
    const b=document.createElement('div');
    b.className='alarm-empty';
    b.textContent=String(i+1).padStart(2,'0')+'　未登録';
    chips.append(b)
  }
  const h=document.createElement('h3');
  h.textContent='アラーム一覧　'+state.alarms.length+'／10件';
  chips.before(h);
  $('#view').append(h,chips);
  const controls=$('.alarm-ring-controls'),policy=alarmPolicy();
  $('#alarm-snooze').textContent=policy.snoozeMinutes+'分スヌーズ';
  const b=document.createElement('button');
  b.textContent='停止・スヌーズの共通設定';
  b.onclick=alarmPolicyForm;
  controls.after(b);
  const hints=[...$('#view').querySelectorAll('p.hint')];
  hints.forEach(p=>{
    if(p.textContent.includes('最大10件'))p.textContent='最大10件。各枠を押すたびオン／オフ。設定から試し聞き・時刻・毎日リピートを変更できます。同じ時刻は登録順に再生します。停止・スヌーズは再生中の1件に共通設定を適用します。画面を開いて使ってください。ロック・終了中の鳴動は保証しません。'
  })
}

function queueDueAlarms(alarms, now, queue) {
  const next=queue.filter(q=>alarms.some(a=>a.id===q.id&&a.enabled&&a.nextAt===q.at));
  for(const a of alarms.filter(a=>a.enabled&&a.nextAt<=now).sort((a,b)=>a.nextAt-b.nextAt)){
    if(!next.some(q=>q.id===a.id&&q.at===a.nextAt))next.push({id:a.id,at:a.nextAt,expired:now-a.nextAt>60000})
  }
  return next
}

function rememberGallery() {
  const id=state.gallery[galleryIndex]?.id||null;
  if(state.galleryLastId===id)return;
  const old=state.galleryLastId;
  state.galleryLastId=id;
  persist().catch(()=>{
    if(state.galleryLastId===id)state.galleryLastId=old;
    notify('最後の写真を記憶できませんでした')
  })
}

function alarmEdit(old) {
  alarmEditFromClinic(old);
  if(!old&&alarmDraft){
    setDraftCheck(()=>!!alarmDraft);
    const c=draftContexts.get($('#form'));
    if(c)c.discard=()=>{
      alarmDraft=null
    }
  }
}

function leaveAlarm() {
  alarmDueQueue=[];
  leaveAlarmFromAlarms()
}

function paintGallery() {
  paintGalleryFromClinic();
  if(page==='gallery'&&!dataWiping)rememberGallery()
}

function galleryPage(v) {
  const found=state.gallery.findIndex(r=>r.id===state.galleryLastId);
  if(found>=0)galleryIndex=found;
  galleryPageFromClinic(v);
  const img=$('#gallery-photo');
  if(!img)return;
  img.onclick=null;
  let start=null;
  const move=n=>{
    if(state.gallery.length<2)return;
    galleryAuto=false;
    galleryIndex=(galleryIndex+n+state.gallery.length)%state.gallery.length;
    paintGallery();
    scheduleGallery()
  };
  img.onpointerdown=e=>{
    start={x:e.clientX,y:e.clientY,id:e.pointerId}
  };
  img.onpointerup=e=>{
    if(start?.id===e.pointerId){
      const dx=e.clientX-start.x,dy=e.clientY-start.y;
      if(Math.max(Math.abs(dx),Math.abs(dy))>40)move(Math.abs(dy)>Math.abs(dx)?(dy<0?1:-1):(dx<0?1:-1))
    }
    start=null
  };
  img.onpointercancel=()=>start=null;
  let lastWheel=0;
  img.onwheel=e=>{
    e.preventDefault();
    if(Date.now()-lastWheel>450&&Math.abs(e.deltaY)>5){
      lastWheel=Date.now();
      move(e.deltaY>0?1:-1)
    }
  };
  img.tabIndex=0;
  img.onkeydown=e=>{
    if(['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(e.key)){
      e.preventDefault();
      move(['ArrowDown','ArrowRight'].includes(e.key)?1:-1)
    }
  };
  const controls=$('.gallery-controls');
  for(const [text,n]of [['前の写真',-1],['次の写真',1]]){
    const b=document.createElement('button');
    b.textContent=text;
    b.onclick=()=>move(n);
    controls.append(b)
  }
}

function galleryManage() {
  let draft=state.gallery.map(r=>({...r})),busy=false,selected=state.galleryLastId;
  const baseline=JSON.stringify(draft),token=dataEpoch;
  form('写真館の写真（10枚まで）','<label>スマホの写真から追加<input id="gallery-files" type="file" accept="image/*" multiple></label><p id="gallery-load-status" role="status"></p><p class="hint">写真をタップして表示。「外す」を2秒長押しで登録から外します。変更は保存で確定し、スマホの元写真は消しません。</p><div id="gallery-drafts"></div>',async()=>{
    if(busy)throw Error('写真の読み込みを待ってください');
    if(token!==dataEpoch||dataWiping)throw Error('画面を開き直してください');
    const previous=state.gallery,oldId=state.galleryLastId;
    state.gallery=draft;
    state.galleryLastId=draft.some(r=>r.id===selected)?selected:draft[0]?.id||null;
    try{
      await persist()
    }catch(e){
      state.gallery=previous;
      state.galleryLastId=oldId;
      throw e
    }
    galleryIndex=Math.max(0,draft.findIndex(r=>r.id===state.galleryLastId))
  });
  setDraftCheck(()=>busy||JSON.stringify(draft)!==baseline);
  const paint=()=>{
    const box=$('#gallery-drafts');
    if(!box)return;
    box.innerHTML=draft.map((r,i)=>'<figure><button type="button" class="gallery-pick" data-gallery-pick="'+i+'" aria-label="'+esc(r.name||'写真')+'を表示"><img src="'+r.data+'" alt="'+esc(r.name)+'"></button><button type="button" class="gallery-remove" data-gallery-remove="'+i+'">2秒押して外す</button></figure>').join('');
    box.querySelectorAll('[data-gallery-pick]').forEach(b=>b.onclick=async()=>{
      if(busy)return;
      const id=draft[Number(b.dataset.galleryPick)].id;
      selected=id;
      if(await close()){
        const index=state.gallery.findIndex(r=>r.id===id);
        if(index>=0){
          galleryIndex=index;
          galleryAuto=false;
          rememberGallery();
          render();
          scheduleGallery()
        }else notify('保存しなかった写真は表示できません')
      }
    });
    box.querySelectorAll('[data-gallery-remove]').forEach(b=>{
      const remove=()=>{
        if(busy||!b.isConnected)return;
        draft.splice(Number(b.dataset.galleryRemove),1);
        paint()
      };
      bindHold(b,2000,remove);
      b.onkeydown=e=>{
        if(e.key==='Enter'&&!e.repeat){
          e.preventDefault();
          b.dataset.keyStart=String(Date.now())
        }
      };
      b.onkeyup=e=>{
        if(e.key==='Enter'){
          e.preventDefault();
          if(Date.now()-Number(b.dataset.keyStart)>=2000)remove()
        }
      }
    });
    $('#gallery-load-status').textContent=draft.length+'／10枚'
  };
  $('#gallery-files').onchange=async e=>{
    const files=Array.from(e.target.files||[]),status=$('#gallery-load-status');
    if(files.length+draft.length>10){
      status.textContent='合計10枚までです。';
      e.target.value='';
      return
    }
    busy=true;
    status.textContent='写真を読み込んでいます…';
    try{
      const added=[];
      for(const f of files){
        const data=await imageFile(f,1600);
        if(token!==dataEpoch||!status.isConnected)return;
        added.push({id:uid(),data,name:f.name.slice(0,200)})
      }
      draft=draft.concat(added);
      paint()
    }catch(e){
      if(status.isConnected)status.textContent='写真を読み込めませんでした。別の写真を選んでください。'
    }finally{
      busy=false;
      if(e.target.isConnected)e.target.value=''
    }
  };
  paint()
}

function detachAlarmAudio(audio) {
  if(!audio)return;
  audio.onended=audio.onerror=null;
  try{
    audio.muted=true;
    audio.loop=false
  }catch(e){
  }
  try{
    audio.pause()
  }catch(e){
  }
  try{
    audio.currentTime=0
  }catch(e){
  }
  try{
    audio.removeAttribute('src');
    audio.srcObject=null;
    audio.load()
  }catch(e){
  }
  alarmOutputs.delete(audio)
}

function cameraMaximum(cap) {
  const n=cap?.max;
  return Number.isFinite(n)&&n>0?Math.floor(n):null
}

async function maximizeCameraTrack(track) {
  if(!track?.applyConstraints)return;
  let cap;
  try{
    cap=track.getCapabilities?.()||{}
  }catch(e){
    return
  }
  const width=cameraMaximum(cap.width),height=cameraMaximum(cap.height);
  if(!width&&!height)return;
  try{
    await track.applyConstraints({...(width?{width:{ideal:width}}:{}),...(height?{height:{ideal:height}}:{})})
  }catch(e){
    /* The initial stream remains usable if this combination is unsupported. */
  }
}

async function takeMaximumPhoto(track) {
  if(!track||typeof ImageCapture==='undefined')return null;
  try{
    const camera=new ImageCapture(track);
    let caps=null;
    try{
      caps=await camera.getPhotoCapabilities()
    }catch(e){
    }
    const width=cameraMaximum(caps?.imageWidth),height=cameraMaximum(caps?.imageHeight);
    if(width||height){
      try{
        return await camera.takePhoto({...(width?{imageWidth:width}:{}),...(height?{imageHeight:height}:{})})
      }catch(e){
        if(width)try{
          return await camera.takePhoto({imageWidth:width})
        }catch(e){
        }
      }
    }
    return await camera.takePhoto()
  }catch(e){
    return null
  }
}

function stopAlarm(reason='stop') {
  alarmOutputEpoch++;
  clearTimeout(ringTimer);
  ringTimer=null;
  const recognition=stopRecognition;
  stopRecognition=null;
  alarmRinging=null;
  if(reason==='button'||reason==='voice')alarmQuietUntil=Date.now()+1200;
  try{
    recognition?.abort()
  }catch(e){
  }
  for(const sound of new Set([...alarmOutputs,alarmAudio]))detachAlarmAudio(sound);
  alarmAudio=null;
  if(alarmAudioURL){
    URL.revokeObjectURL(alarmAudioURL);
    alarmAudioURL=null
  }
  stopPreview();
  try{
    haltPlayer()
  }catch(e){
  }
  try{
    window.speechSynthesis?.cancel()
  }catch(e){
  }
  updateAlarmFace()
}

function updateAlarmFace() {
  updateAlarmFaceFromAlarms();
  const stop=$('#alarm-stop');
  if(stop)stop.disabled=false
}

function ringAlarm(a) {
  stopAlarm('replace');
  alarmQuietUntil=0;
  alarmRinging=a;
  ringStarted=Date.now();
  const epoch=alarmOutputEpoch,sound=new Audio(a.voice.data);
  alarmAudio=sound;
  alarmOutputs.add(sound);
  sound.loop=true;
  const finish=()=>{
    if(epoch===alarmOutputEpoch)stopAlarm('finished');else detachAlarmAudio(sound)
  };
  sound.onerror=()=>{
    finish();
    alarmMessage('音声を再生できません。端末の音量と再生許可を確認してください。')
  };
  ringTimer=setTimeout(finish,alarmPolicy().ringSeconds*1000);
  try{
    Promise.resolve(sound.play()).then(()=>{
      if(epoch!==alarmOutputEpoch)detachAlarmAudio(sound)
    }).catch(()=>{
      if(epoch===alarmOutputEpoch){
        finish();
        alarmMessage('音声を再生できません。音を有効にする・試聴をお試しください。')
      }else detachAlarmAudio(sound)
    })
  }catch(e){
    finish();
    alarmMessage('音声を再生できませんでした')
  }
  startStopListening();
  updateAlarmFace()
}

async function snoozeAlarm() {
  const a=alarmRinging;
  if(!a)return;
  const minutes=alarmPolicy().snoozeMinutes;
  stopAlarm('button');
  try{
    await writeAlarms(state.alarms.map(x=>x.id===a.id?{...x,enabled:true,nextAt:Date.now()+minutes*60000}:x));
    render();
    alarmMessage(minutes+'分後にもう一度再生します')
  }catch(e){
    alarmMessage('音声は止めましたが、スヌーズを保存できませんでした')
  }
}

async function tickAlarms() {
  updateAlarmFace();
  if(!state||page!=='alarms'||document.hidden||alarmTickBusy)return;
  state.alarms??=[];
  alarmDueQueue=queueDueAlarms(state.alarms,Date.now(),alarmDueQueue);
  if(alarmRinging||holdActive||alarmFinalizing||Date.now()<alarmQuietUntil)return;
  const q=alarmDueQueue.shift();
  if(!q)return;
  const a=state.alarms.find(a=>a.id===q.id&&a.enabled&&a.nextAt===q.at);
  if(!a)return;
  const epoch=alarmOutputEpoch;
  alarmTickBusy=true;
  try{
    if(q.expired){
      await writeAlarms(state.alarms.map(x=>x.id===a.id?{...x,enabled:false}:x));
      render();
      alarmMessage('画面を開いていない間の予定は再生しませんでした。必要ならオンにしてください。');
      return
    }
    await writeAlarms(state.alarms.map(x=>x.id===a.id?{...x,enabled:!!x.repeat,nextAt:x.repeat?alarmNext(x.time):x.nextAt}:x));
    if(epoch!==alarmOutputEpoch||page!=='alarms'||document.hidden)return;
    render();
    ringAlarm(a)
  }catch(e){
    alarmMessage('アラーム状態を保存できませんでした')
  }finally{
    alarmTickBusy=false
  }
}

async function startFastCamera() {
  releaseCamera();
  const token=cameraToken,v=$('#fast-video');
  if(!v)return;
  $('#fast-shutter').disabled=true;
  let media=null;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw Error('直接撮影できません。「スマホのカメラを使う」を押してください。');
    media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:8192},height:{ideal:8192}},audio:false});
    if(token!==cameraToken||page!=='camera'){
      media.getTracks().forEach(t=>t.stop());
      return
    }
    quickCamera=media;
    await maximizeCameraTrack(media.getVideoTracks()[0]);
    if(token!==cameraToken||page!=='camera')return;
    v.srcObject=media;
    await v.play();
    const ready=()=>{
      if(token===cameraToken&&page==='camera'&&$('#fast-shutter')){
        $('#fast-shutter').disabled=false;
        $('#fast-camera-status').textContent='撮影できます。プレビュー '+v.videoWidth+' × '+v.videoHeight+'。対応端末では静止画の最大解像度を優先します。'
      }
    };
    if(v.videoWidth)ready();else v.addEventListener('loadeddata',ready,{once:true})
  }catch(e){
    if(media&&quickCamera!==media)media.getTracks().forEach(t=>t.stop());
    if(token===cameraToken){
      releaseCamera();
      if($('#fast-camera-status'))$('#fast-camera-status').textContent=e.message||'カメラを開けませんでした。スマホのカメラを使えます。'
    }
  }
}

async function captureFast() {
  if(shotBusy)return;
  const v=$('#fast-video');
  if(!v?.videoWidth)return;
  if(shotBlob&&!shotSaved&&!confirm('前の写真が未保存です。先に保存しないまま撮影しますか？'))return;
  shotBusy=true;
  const token=cameraToken;
  $('#fast-shutter').disabled=true;
  try{
    let blob=await takeMaximumPhoto(quickCamera?.getVideoTracks()[0]),method='高解像度の静止画';
    if(token!==cameraToken||page!=='camera')return;
    if(!blob?.size){
      const c=document.createElement('canvas');
      c.width=v.videoWidth;
      c.height=v.videoHeight;
      c.getContext('2d').drawImage(v,0,0);
      blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',1));
      method='映像の原寸'
    }
    if(!blob?.size)throw Error('撮影できませんでした');
    if(token!==cameraToken||page!=='camera')return;
    shotSaved=true;
    showShot(blob);
    $('#fast-camera-status').textContent=method+'で撮影しました。写真を保存または共有してください。'
  }catch(e){
    notify(e.message||'撮影できませんでした')
  }finally{
    shotBusy=false;
    if(token===cameraToken&&$('#fast-shutter'))$('#fast-shutter').disabled=false
  }
}

function releaseCamera() {
  cameraToken++;
  if(quickCamera){
    quickCamera.getTracks().forEach(t=>t.stop());
    quickCamera=null
  }
}

function photoExtension(blob) {
  const name=blob?.name||'';
  const ext=name.match(/\.(jpe?g|png|webp|heic|heif|avif)$/i);
  return ext?ext[1].toLowerCase():({'image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','image/avif':'avif'}[blob?.type]||'jpg')
}

function clearShot() {
  if(shotURL)URL.revokeObjectURL(shotURL);
  shotURL=null;
  shotBlob=null;
  shotSaved=true
}

function cameraPage(v) {
  v.innerHTML=topButtons()+'<h2>カメラ</h2><div class="fast-camera"><video id="fast-video" autoplay muted playsinline></video><p id="fast-camera-status" role="status">カメラを開いています…</p><button id="fast-shutter" disabled>撮影</button></div><div class="row"><button id="camera-restart">カメラを開く</button><label class="native-camera-button">スマホのカメラを使う<input id="native-camera" type="file" accept="image/*" capture="environment"></label></div><section id="shot-preview" hidden><img id="shot-image" alt="撮影した写真"><div class="row"><button id="shot-save">写真を保存</button><button id="shot-share">共有・写真アプリへ</button></div><p>このアプリには写真を記録しません。保存先で確認してください。</p></section><p class="hint">初回はカメラ許可が必要です。画面ロック中は撮影できません。標準カメラを開く動作・写真一覧への保存は端末によって異なります。</p>';
  $('#fast-shutter').onclick=captureFast;
  $('#camera-restart').onclick=startFastCamera;
  $('#native-camera').onchange=async e=>{
    const f=e.target.files[0];
    if(f){
      releaseCamera();
      showShot(f)
    }
  };
  $('#shot-save').onclick=()=>{
    if(!shotBlob)return;
    const a=document.createElement('a');
    a.href=shotURL;
    a.download='baby-'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+photoExtension(shotBlob);
    a.click();
    shotSaved=true;
    $('#fast-camera-status').textContent='保存を要求しました。スマホの保存先を確認してください。'
  };
  $('#shot-share').onclick=async()=>{
    if(!shotBlob)return;
    const f=new File([shotBlob],'baby-photo.'+photoExtension(shotBlob),{type:shotBlob.type||'image/jpeg'});
    try{
      if(!navigator.canShare?.({files:[f]})){
        notify('共有に非対応です。「写真を保存」を使ってください');
        return
      }
      await navigator.share({files:[f],title:'撮影した写真'});
      shotSaved=true
    }catch(e){
      if(e.name!=='AbortError')notify('共有できませんでした。「写真を保存」を使ってください')
    }
  };
  if(shotBlob)showShot(shotBlob,false);
  startFastCamera()
}

function showShot(blob, replace=true) {
  if(replace){
    if(shotBlob&&!shotSaved&&!confirm('前の写真は保存操作が済んでいません。新しい写真に切り替えますか？'))return;
    clearShot();
    shotBlob=blob;
    shotURL=URL.createObjectURL(blob);
    shotSaved=false
  }
  $('#shot-image').src=shotURL;
  $('#shot-preview').hidden=false;
  $('#fast-camera-status').textContent='撮影しました。写真を保存または共有してください。'
}

async function openMirrorHighResolution() {
  const epoch=++mirrorEpoch;
  if(stream){
    stream.getTracks().forEach(t=>t.stop());
    stream=null
  }
  modal('<section class="mirror-view"><h2>手鏡</h2><video id="mirror" autoplay playsinline muted></video><p id="mirror-status" role="status">内側カメラを準備しています…</p></section>');
  const dialog=$('#dialog'),video=$('#mirror'),status=$('#mirror-status');
  dialog.classList.add('mirror-dialog');
  const alive=()=>epoch===mirrorEpoch&&dialog.open&&video.isConnected;
  let media=null;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw Error('手鏡にはHTTPSでの接続と対応ブラウザが必要です。');
    media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},width:{ideal:8192},height:{ideal:8192}},audio:false});
    if(!alive()){
      media.getTracks().forEach(t=>t.stop());
      return
    }
    stream=media;
    await maximizeCameraTrack(media.getVideoTracks()[0]);
    if(!alive()||stream!==media){
      media.getTracks().forEach(t=>t.stop());
      return
    }
    video.srcObject=media;
    await video.play();
    if(!alive())return;
    const ready=()=>{
      if(alive())status.textContent='手鏡 '+video.videoWidth+' × '+video.videoHeight+' ／ 対応する高解像度を優先・写真は保存しません'
    };
    if(video.videoWidth)ready();else video.addEventListener('loadeddata',ready,{once:true})
  }catch(e){
    media?.getTracks().forEach(t=>t.stop());
    if(stream===media)stream=null;
    if(alive())status.textContent=e.name==='NotAllowedError'?'カメラを許可してください。':e.message||'内側カメラを利用できませんでした。'
  }
}

async function startVoice() {
  if(state.voice&&!voiceBusy&&voiceRecorder?.state!=='recording'&&!confirm('前の録音を新しい録音に置き換えます。録音を始めますか？'))return;
  return startVoiceFromExtra()
}

// === vaccines ===
'use strict';
// vaccines: stable function declarations, with explicit dependencies.

function vaccines(v) {
  const all=state.vaccines.slice().sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));
  const next=all.filter(x=>x.status==='予定'&&x.date>=day(new Date()))[0];
  v.innerHTML=`<h2>予防接種</h2><p class="hint">次の予定：${next?esc(next.date+' '+(next.time||'')+' '+next.name):'未登録'}<br>予定と接種済みを区別します。期限を過ぎても自動で接種済みにはしません。</p><button id="new-vaccine">＋ 1回の予防接種を登録</button><h3>接種年表</h3>${all.map(x=>`<button class="timeline" data-vaccine="${x.id}"><span>${esc(x.date||'日付未定')} ${esc(x.time||'')}　${esc(x.status)}</span><strong>${esc(x.name)} ${esc(x.dose||'')}</strong><small>${esc(x.hospital||'病院未記入')}</small></button>`).join('')||'<p class="empty">まだ登録がありません。</p>'}<details><summary>予防接種情報（厚生労働省）</summary><p class="hint">ロタウイルス、5種混合、小児肺炎球菌、B型肝炎、BCG、MR、水痘など。接種時期・回数は製剤や接種歴で異なります。個別日程は病院で確認し登録してください。</p><a href="${vaccineSource}" target="_blank" rel="noopener">厚生労働省の予防接種・ワクチン情報を開く</a><small>情報入口の確認：2026年11月3日</small></details>`;
  $('#new-vaccine').onclick=()=>vaccineForm();
  v.querySelectorAll('[data-vaccine]').forEach(b=>b.onclick=()=>vaccineForm(state.vaccines.find(x=>x.id===b.dataset.vaccine)))
}

function vaccineUX(v) {
  v.querySelectorAll('[data-vaccine]').forEach(b=>b.onclick=()=>vaccineDetails(state.vaccines.find(r=>r.id===b.dataset.vaccine)))
}

function vaccineData(id, name, group, kind, disease, age, interval, doses, slug, extra={}) {
  return {id,name,group,kind,disease,age,interval,doses,source:slug?MHLW+'vaccine/'+slug+'/index.html':VAX_NOTES,...extra}
}

function sourceLink(url, title) {
  return '<a href="'+esc(url)+'" target="_blank" rel="noopener">'+esc(title)+'</a>'
}

function vaccineLibrary(v) {
  const groups=[...new Set(VACCINES.map(r=>r.group))];
  v.innerHTML='<h2>予防接種百科事典</h2><p class="hint">選ぶだけでは予定になりません。各ワクチンの各回で状態を保存します。情報確認：'+VAX_CHECKED+'。将来の制度変更は自動反映されません。</p><label>名前・病名で探す<input id="vax-search" type="search" placeholder="ロタ、肺炎球菌など"></label><div id="vax-matches"></div><button id="vax-history">自分の予定・打たない・接種済み一覧</button><div id="vax-groups">'+groups.map(g=>'<details '+(g==='赤ちゃん・子供'?'open':'')+'><summary>'+g+'</summary>'+folderButtons(VACCINES.filter(r=>r.group===g).map(r=>['vax:'+r.id,r.name]))+'</details>').join('')+'</div><p>'+sourceLink(VAX_SCHEDULE,'公的スケジュールの最新版を確認')+'</p>';
  $('#vax-history').onclick=()=>go('vaccine-view');
  $('#vax-search').oninput=e=>{
    const q=e.target.value.trim().toLowerCase();
    $('#vax-matches').innerHTML=q?folderButtons(VACCINES.filter(r=>(r.name+r.disease).toLowerCase().includes(q)).map(r=>['vax:'+r.id,r.name])):'';
    $('#vax-groups').hidden=!!q;
    wireNavigation(v)
  };
  wireNavigation(v)
}

function catalogRecords(vax) {
  return state.vaccines.filter(r=>r.catalogId===vax.id||!r.catalogId&&r.name===vax.name)
}

function vaccineArticle(v, id) {
  const r=VACCINES.find(x=>x.id===id);
  if(!r){
    v.innerHTML='<p>項目が見つかりません。</p>';
    return
  }
  const records=catalogRecords(r);
  v.innerHTML='<h2>'+esc(r.name)+'</h2><dl class="vax-encyclopedia"><dt>防ぐ病気</dt><dd>'+esc(r.disease)+'</dd><dt>制度・強制か</dt><dd>'+esc(r.kind)+'。'+(r.kind==='定期A類'?'対象者（子供では保護者）に努力義務があります。強制接種とは異なります。':'「任意」は不要という意味ではありません。対象者・医学的必要性は医師と確認。')+'</dd><dt>時期・対象年齢</dt><dd>'+esc(r.age)+'</dd><dt>回数・間隔</dt><dd>'+esc(r.interval)+'</dd><dt>費用・2025年の資料</dt><dd>'+esc(r.price||(r.kind==='定期A類'?'定期の対象期間・指定医療機関などの条件内は原則公費。2025年の自費料金は確認できません。':'全国一律の価格はありません。2025年の確認できる料金資料は未収録。自治体助成・医療機関の料金を確認。'))+(r.priceSource?'<br>'+sourceLink(r.priceSource,'2025年の料金例の出典'):'')+'</dd><dt>どのくらいの人が受けたか</dt><dd>'+esc(r.rate||'この製剤・対象年齢・回数について、比較できる全国割合は本版では確認できていません。割合は接種の必要性を決める基準ではありません。')+(r.rateSource?'<br>'+sourceLink(r.rateSource,'年度・接種率の出典'):'')+'</dd><dt>副反応・接種前の確認</dt><dd>'+esc(r.risk||'発熱や接種部位の痛み・腫れなどが起こることがあります。製剤ごとの頻度・重大な副反応・接種できない条件は下の公式資料と接種医に確認。')+'</dd>'+(r.recommend?'<dt>推奨元</dt><dd>'+esc(r.recommend)+'</dd>':'')+'</dl><p>'+sourceLink(r.source,'接種時期・製剤等の公的資料')+' ／ '+sourceLink(VAX_SCHEDULE,'最新の制度・全体表')+'</p><p class="hint">確認日：'+VAX_CHECKED+'。標準時期は個別の接種指示ではありません。予定日は病院と決めてください。</p><h3>1回ごとの状態</h3>'+r.doses.map(d=>{
    const old=records.find(x=>x.dose===d);
    return '<article><strong>'+esc(d)+'</strong><p>'+esc(old?(old.status==='接種済み'?'済':old.status)+' '+(old.date||'日付未定'):'未定（未登録）')+'</p><button data-vax-dose="'+esc(d)+'">予定・打たない・済を選ぶ／詳細</button></article>'
  }).join('')+'<button id="extra-vax-dose">別の回・年度を追加</button><h3>このワクチンの登録履歴</h3>'+records.map(x=>'<button class="timeline" data-vax-record="'+esc(x.id)+'">'+esc((x.date||'日付未定')+' '+x.dose+' '+x.status)+'</button>').join('');
  v.querySelectorAll('[data-vax-dose]').forEach(b=>b.onclick=()=>{
    const d=b.dataset.vaxDose;
    vaccineForm(records.find(x=>x.dose===d)||{name:r.name,catalogId:r.id,dose:d,status:'未定'})
  });
  v.querySelectorAll('[data-vax-record]').forEach(b=>b.onclick=()=>vaccineForm(records.find(x=>x.id===b.dataset.vaxRecord)));
  $('#extra-vax-dose').onclick=()=>vaccineForm({name:r.name,catalogId:r.id,status:'未定'})
}

function vaccineFormFromVaccineLibrary(old) {
  const r=old||{},existing=!!r.id;
  form('予防接種：1回の詳細','<label>ワクチンを選択<select name="catalogId"><option value="">その他・手入力</option>'+VACCINES.map(v=>'<option value="'+v.id+'" '+(r.catalogId===v.id||!r.catalogId&&r.name===v.name?'selected':'')+'>'+esc(v.name)+'</option>').join('')+'</select></label>'+textField('name','ワクチン名',r.name||'')+textField('dose','何回目・年度・製品名',r.dose||'')+'<fieldset><legend>状態（一つ選択）</legend><div class="choices">'+['未定','予定','打たない','接種済み'].map(s=>'<label><input type="radio" name="status" value="'+s+'" '+((r.status||'未定')===s?'checked':'')+'><span>'+(s==='接種済み'?'済':s)+'</span></label>').join('')+'</div></fieldset><label>日付<input type="date" name="date" value="'+(r.date||'')+'"></label><label>時刻<input type="time" name="time" value="'+(r.time||'')+'"></label>'+textField('hospital','病院・接種会場',r.hospital||'')+'<label>費用（円、無料は0）<input type="number" min="0" step="1" name="cost" placeholder="0" value="'+(r.cost??'')+'"></label><label>理由・自由メモ・接種後の様子<textarea name="memo">'+esc(r.memo||'')+'</textarea></label><p class="hint">「打たない」も後から変更できます。接種済みは実際に受けた日を入れて保存します。</p>'+(existing?'<button type="button" id="vaccine-delete" class="danger">この記録を削除</button>':''),async f=>{
    const name=String(f.get('name')).trim(),status=String(f.get('status')),d=String(f.get('date'));
    if(!name)throw Error('ワクチン名を確認してください');
    if(status==='接種済み'&&(!d||d>day(new Date())))throw Error('済の場合は実際に受けた日付を確認してください');
    const n={id:r.id||uid(),catalogId:String(f.get('catalogId')),name,dose:String(f.get('dose')),status,date:d,time:String(f.get('time')),hospital:String(f.get('hospital')),cost:zeroNum(f,'cost'),memo:String(f.get('memo'))};
    const before=state.vaccines;
    state.vaccines=state.vaccines.filter(x=>x.id!==n.id).concat(n);
    try{
      await persist()
    }catch(e){
      state.vaccines=before;
      throw e
    }
  });
  $('#form [name="catalogId"]').onchange=e=>{
    const v=VACCINES.find(v=>v.id===e.target.value);
    if(v)$('#form [name="name"]').value=v.name
  };
  if(existing)$('#vaccine-delete').onclick=async()=>{
    if(confirm('この1回分の登録を削除しますか？')){
      const before=state.vaccines;
      state.vaccines=state.vaccines.filter(x=>x.id!==r.id);
      try{
        await persist();
        closeCommitted();
        render()
      }catch(e){
        state.vaccines=before;
        notify('削除を保存できませんでした')
      }
    }
  }
}

function vaccineDetails(r) {
  vaccineForm(r)
}

function vaccineForm(old) {
  vaccineFormFromVaccineLibrary(old);
  const actions=document.createElement('div');
  actions.className='grid';
  const calendar=document.createElement('button');
  calendar.type='button';
  calendar.textContent='予定をカレンダーファイルに保存';
  calendar.onclick=()=>{
    const f=new FormData($('#form'));
    if(f.get('status')!=='予定'||!f.get('date')){
      notify('状態を予定にし、予定日を入力してください');
      return
    }
    calendarDownload(String(f.get('name'))+' '+String(f.get('dose')),String(f.get('date')),String(f.get('time')),String(f.get('hospital')),String(f.get('memo')))
  };
  actions.append(calendar);
  const copy=document.createElement('button');
  copy.type='button';
  copy.textContent='同じ日時・病院で別の接種を追加';
  copy.onclick=()=>{
    const f=new FormData($('#form'));
    vaccineForm({date:String(f.get('date')),time:String(f.get('time')),hospital:String(f.get('hospital')),status:'未定'})
  };
  actions.append(copy);
  $('#form').insertBefore(actions,$('#form .actions'))
}

// === utilities ===
'use strict';
// utilities: stable function declarations, with explicit dependencies.

function jpNumber(s) {
  if(/^\d+$/.test(s))return Number(s);
  const digits={'零':0,'〇':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  if(s.includes('十')){
    const [a,b]=s.split('十');
    if(s.split('十').length>2)return NaN;
    return (a?digits[a]:1)*10+(b?digits[b]:0)
  }
  return s.length===1?digits[s]:NaN
}

function feedMenu(forceChoice=false) {
  const recent=agoRecord(['milk','breast']);
  const key=recent?.type==='breast'?'breast':recent?.kind==='搾母乳'?'pumped':'milk';
  if(forceChoice!==true&&recent&&state.prefs[key]){
    if(key==='breast')feedingForm('breast');else feedingForm('milk',null,key==='pumped'?'搾母乳':'ミルク');
    return;
  }
  feedMenuFromUsability();
  $('#dialog h2')?.insertAdjacentHTML('afterend',feedingSummary())
}

function ensureClinic() {
  state.gallery??=state.profile.coverPhoto?[{id:uid(),data:state.profile.coverPhoto,name:'以前のTOP写真'}]:[];
  state.weather??={};
}

function morningDescription(r) {
  return ['体温・顔色・ご機嫌',r.temperature===null?'体温未記録':'体温 '+r.temperature+' ℃','顔色：'+(r.face||'未記録'),'ご機嫌：'+(r.mood||'未記録')].join(' ／ ')
}

function morningForm(old) {
  const token=dataEpoch,recordId=old?.id||uid();
  form(old?'体温・顔色・ご機嫌の訂正':'体温・顔色・ご機嫌を記録',dateField(old?.at||new Date())+'<label>体温（℃）<input type="number" name="temperature" step="0.1" min="0" max="50" placeholder="0.0" value="'+(old?.temperature??'')+'"></label>'+'<p class="hint">朝の観察も再検温も、一回ずつ日時を付けて保存します。前の記録は残ります。薄い0.0、0、0.1は未記録です。</p>'+choice('face','顔色',FACES,old?.face)+choice('mood','ご機嫌',MOODS,old?.mood)+'<label>メモ<textarea name="memo">'+esc(old?.memo||'')+'</textarea></label><p class="hint">見た様子を記録します。自動で正常・異常を判定しません。</p>',async f=>{
    const at=new Date(f.get('at')),raw=String(f.get('temperature')||''),n=raw===''||Number(raw)===0||Number(raw)===0.1?null:Number(raw);
    if(!Number.isFinite(+at)||at>new Date())throw Error('現在以前の日時を選んでください');
    if(n!==null&&(!Number.isFinite(n)||n<20||n>50))throw Error('体温の値と単位を確認してください');
    const r={id:recordId,type:'morning',at:at.toISOString(),temperature:n,face:String(f.get('face')||''),mood:String(f.get('mood')||''),memo:String(f.get('memo')||'')};
    if(n===null&&!r.face&&!r.mood&&!r.memo.trim())throw Error('一項目以上記入してください');
    if(token!==dataEpoch||dataWiping)throw Error('画面を開き直してください');
    const previous=state.records;
    state.records=previous.filter(x=>x.id!==r.id).concat(r);
    try{
      await persist()
    }catch(e){
      state.records=previous;
      throw e
    }
  })
}

async function fetchWeatherJSON(url) {
  const c=new AbortController();
  weatherControllers.add(c);
  const timer=setTimeout(()=>c.abort(),12000);
  try{
    const r=await fetch(url,{signal:c.signal,credentials:'omit'});
    if(!r.ok)throw Error('通信できませんでした（'+r.status+'）');
    return await r.json()
  }finally{
    clearTimeout(timer);
    weatherControllers.delete(c)
  }
}

function weatherText(code) {
  if(code===0)return '晴れ';
  if([1,2].includes(code))return '晴れ・曇り';
  if(code===3)return '曇り';
  if([45,48].includes(code))return '霧';
  if([51,53,55,56,57].includes(code))return '霧雨';
  if([61,63,65,66,67,80,81,82].includes(code))return '雨';
  if([71,73,75,77,85,86].includes(code))return '雪';
  if([95,96,99].includes(code))return '雷雨';
  return '不明'
}

function parseDailyWeather(payload, d, place, archive=false) {
  const h=payload?.hourly;
  if(!h||!Array.isArray(h.time))throw Error('天気データの形式を確認できません');
  const indices=h.time.map((t,i)=>String(t).slice(0,10)===d?i:-1).filter(i=>i>=0);
  const average=key=>{
    const a=indices.map(i=>h[key]?.[i]).filter(x=>typeof x==='number'&&Number.isFinite(x));
    if(a.length!==24)throw Error('一日分の天気データが揃っていません');
    return a.reduce((n,x)=>n+x,0)/24
  };
  const temperature=Number(average('temperature_2m').toFixed(1)),humidity=Math.round(average('relative_humidity_2m'));
  if(humidity<0||humidity>100)throw Error('湿度の値を確認できません');
  const di=payload.daily?.time?.indexOf(d)??-1,code=di>=0?payload.daily.weather_code?.[di]:null;
  if(!Number.isInteger(code))throw Error('天気の種類を取得できません');
  return {date:d,temperature,humidity,code,text:weatherText(code),place:{...place},source:'Open-Meteo',method:archive?'再解析':'気象モデル',provisional:d===day(new Date()),fetchedAt:new Date().toISOString()}
}

async function ensureWeather(d, force=false) {
  ensureClinic();
  const place=state.profile.weatherPlace;
  if(!place||!compareDate(d)||d>day(new Date())||dataWiping)return;
  const token=dataEpoch,key=[place.latitude,place.longitude,d].join('|'),existing=state.weather[d],today=day(new Date());
  if(!force&&existing&&(!existing.provisional||d===today&&Date.now()-Date.parse(existing.fetchedAt)<14400000))return;
  if(weatherBusy.has(key)||!force&&Date.now()-(weatherTried.get(key)||0)<300000)return;
  weatherBusy.add(key);
  weatherTried.set(key,Date.now());
  weatherStatus='天気を取得中…';
  updateWeatherLine();
  try{
    const age=Math.floor((new Date(today+'T12:00:00')-new Date(d+'T12:00:00'))/86400000),archive=age>5,base=archive?'https://archive-api.open-meteo.com/v1/archive':'https://api.open-meteo.com/v1/forecast';
    const params=new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),start_date:d,end_date:d,timezone:'Asia/Tokyo',hourly:'temperature_2m,relative_humidity_2m',daily:'weather_code'});
    const payload=await fetchWeatherJSON(base+'?'+params);
    const record=parseDailyWeather(payload,d,place,archive);
    if(token!==dataEpoch||dataWiping||state.profile.weatherPlace?.latitude!==place.latitude||state.profile.weatherPlace?.longitude!==place.longitude)return;
    const previous=state.weather[d];
    state.weather[d]=record;
    try{
      await persist()
    }catch(e){
      if(previous)state.weather[d]=previous;else delete state.weather[d];
      throw e
    }
    weatherStatus='';
  }catch(e){
    if(token===dataEpoch&&!dataWiping)weatherStatus='天気を更新できませんでした。保存済みの値は残します。'
  }finally{
    weatherBusy.delete(key);
    if(token===dataEpoch&&!dataWiping){
      updateWeatherLine();
      if(['health','day'].includes(page))render()
    }
  }
}

function weatherSummary(d) {
  const w=state.weather?.[d];
  return w?w.text+' ／ 平均 '+w.temperature+' ℃ ／ 湿度 '+w.humidity+'％'+(w.provisional?'（予測を含む暫定値）':'（'+w.method+'・参考値）'):'気温・湿度：未取得'
}

function updateWeatherLine() {
  const el=$('#weather-day-line');
  if(el){
    const d=el.dataset.date;
    el.textContent=weatherSummary(d)+(state.weather?.[d]?'　'+state.weather[d].place.label:'')+(weatherStatus?' ／ '+weatherStatus:'')
  }
}

function weatherSettingsFromClinic() {
  let results=[],searchToken=0;
  const token=dataEpoch;
  modal('<h2>天気の地域設定</h2><label>都道府県<select id="weather-pref"><option value="">選択してください</option>'+PREFECTURES.map(p=>'<option '+(state.profile.weatherPlace?.prefecture===p?'selected':'')+'>'+p+'</option>').join('')+'</select></label><label>市区町村・区<input id="weather-city" maxlength="80" placeholder="例：新宿区、横浜市"></label><button id="weather-search">地域を検索</button><p id="weather-search-status" role="status"></p><div id="weather-results"></div><p class="hint">検索する地名と選んだ地域の代表座標をOpen-Meteoに送信します。住所・現在位置・健康記録は送りません。区が見つからない場合は近隣の市などを選んでください。</p><p class="hint">市区全域の実測平均ではなく、代表地点付近の気象モデルの目安です。室温・室内湿度ではありません。</p><p>'+WEATHER_CREDIT+'</p>'+(state.profile.weatherPlace?'<button id="weather-disable">自動取得を止める</button>':''));
  $('#weather-search').onclick=async()=>{
    const query=$('#weather-city').value.trim();
    if(!query){
      $('#weather-search-status').textContent='市区町村名を入力してください';
      return
    }
    const st=++searchToken,status=$('#weather-search-status'),box=$('#weather-results');
    status.textContent='検索中…';
    box.replaceChildren();
    try{
      const payload=await fetchWeatherJSON('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:query,count:'20',language:'ja',countryCode:'JP'}));
      if(st!==searchToken||token!==dataEpoch||!status.isConnected)return;
      results=(payload.results||[]).filter(p=>p.country_code==='JP'&&/^(PPL|ADM)/.test(p.feature_code||'')&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
      status.textContent=results.length?'都道府県と地名を確認し、近い地域を選んでください。':'見つかりませんでした。近隣の市名、またはローマ字でも検索できます。';
      results.forEach(p=>{
        const b=document.createElement('button');
        b.textContent=[p.admin1,p.admin2,p.name].filter(Boolean).join(' ／ ');
        b.onclick=async()=>{
          const previous=state.profile.weatherPlace;
          state.profile.weatherPlace={label:[p.admin1,p.name].filter(Boolean).join(' '),prefecture:$('#weather-pref').value||p.admin1||'',latitude:p.latitude,longitude:p.longitude};
          try{
            await persist();
            closeCommitted();
            render();
            ensureWeather(day(new Date()),true)
          }catch(e){
            state.profile.weatherPlace=previous;
            status.textContent='地域を保存できませんでした'
          }
        };
        box.append(b)
      })
    }catch(e){
      if(status.isConnected)status.textContent='検索できませんでした。通信状態を確認してください。'
    }
  };
  if($('#weather-disable'))$('#weather-disable').onclick=async()=>{
    const old=state.profile.weatherPlace;
    delete state.profile.weatherPlace;
    try{
      await persist();
      closeCommitted();
      render()
    }catch(e){
      state.profile.weatherPlace=old;
      notify('保存できませんでした')
    }
  }
}

function babyAgeOn(d) {
  const b=state.profile.birth;
  if(!b)return '生後日数：出生未登録';
  const n=Math.round((new Date(d+'T12:00:00')-new Date(b+'T12:00:00'))/86400000);
  return n<0?'出産前':'生後 '+n+'日'
}

function leaveClinic() {
  stopGallery();
  stopPreview();
  cancelErase();
  if(page==='gallery'&&document.fullscreenElement)document.exitFullscreen?.().catch(()=>{
  })
}

function descriptionFromClinic(r) {
  return r.type==='morning'?morningDescription(r):descriptionFromFolders(r)
}

function edit(id) {
  const r=state.records.find(x=>x.id===id);
  if(r?.type==='morning')morningForm(r);else editFromAdministration(id)
}

function xmlSafe(s) {
  return String(s??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
}

function zipFiles(files) {
  const crcTable=Uint32Array.from({length:256},(_,n)=>{
    let c=n;
    for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;
    return c>>>0
  });
  const parts=[],central=[];
  let offset=0;
  const bytes=(size,values)=>{
    const b=new Uint8Array(size),v=new DataView(b.buffer);
    for(const [at,n,len]of values)len===2?v.setUint16(at,n,true):v.setUint32(at,n,true);
    return b
  };
  for(const [path,input]of Object.entries(files)){
    const data=typeof input==='string'?utf8.encode(input):input,name=utf8.encode(path);
    let c=0xffffffff;
    for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);
    const crc=(c^0xffffffff)>>>0;
    const local=bytes(30,[[0,0x04034b50,4],[4,20,2],[6,0x800,2],[14,crc,4],[18,data.length,4],[22,data.length,4],[26,name.length,2]]);
    parts.push(local,name,data);
    const cd=bytes(46,[[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[16,crc,4],[20,data.length,4],[24,data.length,4],[28,name.length,2],[42,offset,4]]);
    central.push(cd,name);
    offset+=local.length+name.length+data.length
  }
  const centralSize=central.reduce((a,b)=>a+b.length,0);
  const end=bytes(22,[[0,0x06054b50,4],[8,Object.keys(files).length,2],[10,Object.keys(files).length,2],[12,centralSize,4],[16,offset,4]]);
  const out=new Uint8Array(offset+centralSize+22);
  let pos=0;
  for(const b of [...parts,...central,end]){
    out.set(b,pos);
    pos+=b.length
  }
  return out
}

function expenseXlsxFromExpense(records) {
  const entries=Object.fromEntries(Object.entries(ExpenseTemplate).map(([k,v])=>[k,b64bytes(v)]));
  const path='xl/worksheets/sheet1.xml';
  let xml=new TextDecoder().decode(entries[path]);
  const section=xml.match(/<x:sheetData>([\s\S]*?)<\/x:sheetData>/)[1];
  let header=section.match(/<x:row r="[1-4]"[\s\S]*?<\/x:row>/g).join('');
  const last=Math.max(5,records.length+4),sum=records.reduce((a,r)=>a+(r.amount??0),0);
  header=header.replace(/<x:c r="B2"[\s\S]*?<\/x:c>/,`<x:c r="B2" s="6"><x:f>SUM(B5:B${last})</x:f><x:v>${sum}</x:v></x:c>`);
  const text=(ref,value)=>`<x:c r="${ref}" s="1" t="inlineStr"><x:is><x:t xml:space="preserve">${xmlSafe(value)}</x:t></x:is></x:c>`;
  const rows=records.map((r,i)=>{
    const n=i+5;
    const serial=r.date?Math.round((Date.parse(r.date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000):null;
    return `<x:row r="${n}">${serial===null?`<x:c r="A${n}" s="5"/>`:`<x:c r="A${n}" s="5"><x:v>${serial}</x:v></x:c>`}${r.amount===null?`<x:c r="B${n}" s="6"/>`:`<x:c r="B${n}" s="6"><x:v>${r.amount}</x:v></x:c>`}${text('C'+n,r.shop)}${text('D'+n,r.items)}${text('E'+n,r.category)}${text('F'+n,r.memo)}${text('G'+n,'receipts/'+r.id+'.jpg')}${text('H'+n,r.id)}</x:row>`
  }).join('');
  xml=xml.replace(/<x:sheetData>[\s\S]*?<\/x:sheetData>/,`<x:sheetData>${header}${rows}</x:sheetData>`);
  entries[path]=utf8.encode(xml);
  if(entries['xl/calcChain.xml'])delete entries['xl/calcChain.xml'];
  return zipFiles(entries)
}

function saveBytes(name, bytes, mime) {
  const u=URL.createObjectURL(new Blob([bytes],{type:mime})),a=document.createElement('a');
  a.href=u;
  a.download=name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(u),30000)
}

async function expenseDownload(withPhotos) {
  try{
    await persist();
    const rs=state.receipts.slice().sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')),xlsx=expenseXlsx(rs);
    if(withPhotos){
      const files={'child-expenses.xlsx':xlsx};
      for(const r of rs)files['receipts/'+r.id+'.jpg']=b64bytes(r.image.split(',')[1]);
      saveBytes('child-expenses-and-receipts-'+day(new Date())+'.zip',zipFiles(files),'application/zip')
    }else saveBytes('child-expenses-'+day(new Date())+'.xlsx',xlsx,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    notify('保存先を確認してください')
  }catch(e){
    notify('出力できません：'+e.message)
  }
}

function ensureExtra() {
  state.vaccines??=[];
  state.receipts??=[];
  state.voice??=null
}

function zeroNum(f, k) {
  const raw=f.get(k);
  if(raw===''||raw===null)return null;
  const n=Number(raw);
  if(!Number.isFinite(n)||n<0)throw Error('金額は0以上で入力してください');
  return n
}

function motherGrowthFromExtra(old) {
  const recordId=old?.id||uid();
  form('ママの身長・体重',dateField(old?.at||new Date())+num('height','身長','cm',old?.height??'')+num('weight','体重','kg',old?.weight??''),async f=>{
    const height=number(f,'height'),weight=number(f,'weight');
    if(height===null&&weight===null)throw Error('身長か体重を入力してください');
    const r={id:recordId,type:'mamagrowth',at:new Date(f.get('at')).toISOString(),height,weight};
    const previous=state.records;
    state.records=previous.filter(x=>x.id!==r.id).concat(r);
    try{
      await persist()
    }catch(e){
      state.records=previous;
      throw e
    }
  })
}

async function imageFile(file, max=2200) {
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file),im=new Image();
    im.onload=()=>{
      const n=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement('canvas');
      c.width=Math.round(im.width*n);
      c.height=Math.round(im.height*n);
      c.getContext('2d').drawImage(im,0,0,c.width,c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg',.9))
    };
    im.onerror=()=>{
      URL.revokeObjectURL(url);
      reject(Error('写真を読み込めません'))
    };
    im.src=url
  })
}

function editFromExtra(id) {
  const r=state.records.find(x=>x.id===id);
  if(r?.type==='mamagrowth'){
    modal(`<h2>ママの測定値</h2><p>${esc(day(r.at))}</p><div class="actions"><button id="mg-change">変更</button><button id="mg-delete">削除</button><button id="mg-close">戻る</button></div>`);
    $('#mg-change').onclick=()=>motherGrowth(r);
    $('#mg-close').onclick=close;
    $('#mg-delete').onclick=async()=>{
      if(confirm('この測定記録を削除しますか？')){
        state.records=state.records.filter(x=>x.id!==id);
        await persist();
        closeCommitted();
        render()
      }
    };
    return
  }
  editFromApp(id)
}

function growthExportRows() {

  const birth=state.profile.birth;

  const ordinal=d=>{
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||'');
    return m?Date.UTC(+m[1],+m[2]-1,+m[3])/86400000:null
  };

  const born=ordinal(birth),valid=n=>Number.isFinite(n)&&n>0.1;

  return state.records.filter(r=>r.type==='growth'&&Number.isFinite(Date.parse(r.at))&&(valid(r.height)||valid(r.weight))).slice().sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).map(r=>{

    const at=new Date(r.at),d=day(at),age=born===null?null:ordinal(d)-born;

    return [localTime(at).replace('T',' ').replaceAll('-','/')+':'+String(at.getSeconds()).padStart(2,'0'),age!==null&&age>=0?age:'',valid(r.height)?r.height:'',valid(r.weight)?r.weight:''];

  });

}

function growthExportCSV(rows=growthExportRows()) {

  const quote=v=>'"'+String(v).replaceAll('"','""')+'"';

  return '\ufeff'+[['測定日時','生後日数（日）','身長（cm）','体重（kg）'],...rows].map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n';

}

function exportBabyGrowth() {
  const rows=growthExportRows();
  if(!rows.length){
    notify('身長・体重の記録がありません');
    return
  }
  saveBytes('baby-growth-'+day(new Date())+'.csv',growthExportCSV(rows),'text/csv;charset=utf-8');
  notify('Excel用ファイルの保存先を確認してください')
}

function clearNotice() {
  undoAction=null;
  clearTimeout(undoExpireTimer);
  const el=$('#undo-strip');
  if(el){
    el.hidden=true;
    el.replaceChildren()
  }
}

function updateHeaderClockFromHeader() {
  const now=new Date();
  $('#clock-now').textContent=`${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  $('#clock-age').textContent=birthElapsed(state?.profile,now);
}

function birthElapsedFromHeader(profile, now=new Date()) {
  if(!profile?.birth)return '出生日は設定から登録できます';
  const b=new Date(profile.birth+'T'+(profile.birthTime||'00:00:00'));
  if(!Number.isFinite(+b))return '出生日を設定してください';
  if(b>now)return '出生日時を確認してください';
  if(!profile.birthTime){
    const today=new Date(day(now)+'T12:00:00'),born=new Date(profile.birth+'T12:00:00');
    return '生後'+Math.round((today-born)/86400000)+'日（出生時刻は未登録）'
  }
  const hours=Math.floor((now-b)/3600000);
  return '生まれてから '+Math.floor(hours/24)+'日 '+hours%24+'時間';
}

function notify(message) {
  const el=$('#status');
  el.textContent=message;
  document.querySelectorAll('.save-feedback').forEach(e=>e.remove());
  const dialog=$('#dialog');
  if(dialog.open){const feedback=document.createElement('p');feedback.className='save-feedback';feedback.setAttribute('role','status');feedback.textContent=message;dialog.prepend(feedback)}
  clearTimeout(statusExpireTimer);
  statusExpireTimer=setTimeout(()=>{
    el.textContent='';
    document.querySelectorAll('.save-feedback').forEach(e=>e.remove())
  },3500)
}

function setUndo(label, fn) {
  clearNotice();
  const token=uid();
  undoAction={label,fn,until:Date.now()+5000,token};
  showUndo();
  undoExpireTimer=setTimeout(()=>{
    if(undoAction?.token===token)clearNotice()
  },5000)
}

function showUndo() {
  let el=$('#undo-strip');
  if(!el){
    el=document.createElement('div');
    el.id='undo-strip';
    el.setAttribute('role','status')
  }
  const anchor=$('#day-list')?.closest('.quick-grid');
  if(anchor)anchor.before(el);else if(!el.isConnected)$('#view').prepend(el);
  if(!undoAction||Date.now()>=undoAction.until||page!=='daily'){
    el.hidden=true;
    return
  }
  el.hidden=false;
  el.innerHTML=`<span>${esc(undoAction.label)}</span><button type="button" id="undo-quick">取り消す</button>`;
  $('#undo-quick').onclick=async()=>{
    const action=undoAction;
    if(!action||quickBusy)return;
    quickBusy=true;
    try{
      await action.fn();
      clearNotice();
      render();
      notify('直前の記録を取り消しました')
    }catch(e){
      notify('取り消しを保存できませんでした')
    }finally{
      quickBusy=false;
      showUndo()
    }
  }
}

function canLeaveImmediately(forms) {
  return !leaveBusy&&forms.every(f=>!formIsDirty(f)&&!draftContexts.get(f)?.saving)
}

function recordedHealthDates() {
  const dates=new Set();
  const add=d=>{
    if(compareDate(d))dates.add(d)
  };
  const span=(at,end)=>{
    const a=new Date(at),b=new Date(end);
    if(!Number.isFinite(+a)||!Number.isFinite(+b)||b<=a)return;
    let d=day(a),last=day(new Date(Math.min(+b-1,Date.now())));
    while(d<=last){
      add(d);
      const x=new Date(d+'T12:00:00');
      x.setDate(x.getDate()+1);
      d=day(x)
    }
  };
  for(const r of state.records){
    if(r.type==='photo')continue;
    if(r.type==='sleep')span(r.at,r.end);else add(day(r.at))
  }
  for(const r of state.vaccines||[])add(r.date);
  for(const r of state.receipts||[])add(r.date);
  for(const [d,n] of Object.entries(state.notes||{}))if(String(n).trim())add(d);
  return [...dates].sort()
}

function bindHold(element, ms, action) {
  let timer=null,start=null,fired=false;
  const cancel=()=>{
    clearTimeout(timer);
    timer=null
  };
  element.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    cancel();
    start={x:e.clientX,y:e.clientY};
    fired=false;
    timer=setTimeout(()=>{
      if(!element.isConnected)return;
      fired=true;
      action()
    },ms)
  });
  element.addEventListener('pointermove',e=>{
    if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>12)cancel()
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture','blur'])element.addEventListener(event,cancel);
  element.addEventListener('contextmenu',e=>e.preventDefault());
  return ()=>fired
}

function startStopListening() {
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR)return;
  const epoch=alarmOutputEpoch;
  try{
    const r=new SR();
    stopRecognition=r;
    r.lang='ja-JP';
    r.continuous=true;
    r.interimResults=true;
    r.onresult=e=>{
      if(epoch!==alarmOutputEpoch)return;
      for(const x of Array.from(e.results))if(/ストップ|すとっぷ|stop/i.test(x[0].transcript)){
        stopAlarm('voice');
        alarmMessage('停止しました');
        return
      }
    };
    r.onerror=()=>{
    };
    r.onend=()=>{
      if(epoch===alarmOutputEpoch&&alarmRinging&&stopRecognition===r)try{
        r.start()
      }catch(e){
      }
    };
    r.start()
  }catch(e){
    stopRecognition=null
  }
}

function archiveReceipts(v) {
  v.innerHTML='<h2>旧レシート資料</h2><p>新規撮影・文字読取りは終了しました。以前の資料は削除せず、取り出せます。</p><button id="archive-export">Excelと元写真を取り出す</button>'+state.receipts.map(r=>'<details><summary>'+esc((r.date||'日付不明')+' '+(r.shop||'店名未記入'))+'</summary><img class="receipt-image" src="'+r.image+'" alt="保存したレシート"><dl><dt>日付</dt><dd>'+esc(r.date||'未記録')+'</dd><dt>全体金額</dt><dd>'+esc(r.amount??'未記録')+'</dd><dt>店名</dt><dd>'+esc(r.shop||'未記録')+'</dd><dt>品名</dt><dd class="prewrap">'+esc((r.items||'未記録').replace(/[、，]/g,'\n'))+'</dd></dl>'+(r.ocrText?'<pre class="ocr-archive-text">'+esc(r.ocrText)+'</pre>':'')+'</details>').join('');
  $('#archive-export').onclick=()=>expenseDownload(true)
}

function receiptForm() {
  notify('レシート入力は終了しました。旧資料は「記録を見る」から取り出せます。')
}

// === startup ===
'use strict';
// Initialization follows the v1.20 order; database startup remains asynchronous.

// app.js
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])), day=BabyCore.day;

// app.js
const uid=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');

// app.js
let db, state, page='daily', date=day(new Date()), stream=null, toastTimer, saveQueue=Promise.resolve();

// app.js
const initial=()=>({app:'ritchan-baby-v1',version:1,records:[],notes:{},words:[],profile:{birth:'',due:'2026-11-24',stage:'入院準備'},tasks:[],contacts:''});

// app.js
const localTime=d=>{
  const x=new Date(d);
  return `${day(x)}T${String(x.getHours()).padStart(2,'0')}:${String(x.getMinutes()).padStart(2,'0')}`
};

// app.js
const time=d=>new Date(d).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}), duration=n=>n?`${Math.floor(n/60)}時間${n%60}分`:'未記録';

// app.js
$('#dialog').addEventListener('close',()=>{
  if(stream){
    stream.getTracks().forEach(t=>t.stop());
    stream=null
  }
});

// app.js
$('#sign').onclick=()=>openMirrorHighResolution();

// app.js
$('#settings').onclick=()=>{
  modal(`<h2>設定・バックアップ</h2><label>実際の出生日<input id="birth" type="date" value="${state.profile.birth}"></label><label>出産予定日<input id="due" type="date" value="${state.profile.due}"></label><button id="profile-save">日付を保存</button><h3>バックアップ</h3><p class="hint">写真を含む全記録を保存します。ブラウザのデータ削除や機種変更前に保存してください。自動クラウド共有はありません。</p><button id="export">バックアップを保存</button><label>バックアップから復元<input id="restore" type="file" accept="application/json,.json"></label><p class="hint">復元は現在の記録を置き換えます。先にバックアップしてください。</p><button id="settings-close">戻る</button>`);
  $('#settings-close').onclick=close;
  $('#profile-save').onclick=async()=>{
    const b=$('#birth').value;
    if(b&&b>day(new Date())){
      notify('出生日に未来の日は登録できません');
      return
    }
    state.profile.birth=b;
    state.profile.due=$('#due').value;
    await persist();
    closeCommitted();
    render();
    notify('保存しました')
  };
  $('#export').onclick=async()=>{
    await persist();
    download('ritchan-baby-backup-'+day(new Date())+'.json',JSON.stringify(state));
    notify('バックアップの保存先を確認してください')
  };
  $('#restore').onchange=async e=>{
    try{
      const f=e.target.files[0];
      if(!f)return;
      const obj=JSON.parse(await f.text());
      validateBackup(obj);
      if(!confirm('現在の記録を、このバックアップに置き換えますか？'))return;
      state=obj;
      await persist();
      closeCommitted();
      render();
      notify('復元しました')
    }catch(err){
      notify('復元できません：'+err.message)
    }
  }
};

// app.js
(async()=>{
  try{
    db=await new Promise((resolve,reject)=>{
      const q=indexedDB.open('ritchan-baby-v1',1);
      q.onupgradeneeded=()=>q.result.createObjectStore('data');
      q.onsuccess=()=>resolve(q.result);
      q.onerror=()=>reject(q.error)
    });
    state=await new Promise((resolve,reject)=>{
      const t=db.transaction('data'),q=t.objectStore('data').get('state');
      q.onsuccess=()=>resolve(q.result||initial());
      q.onerror=()=>reject(q.error)
    });
    render()
  }catch(e){
    $('#view').textContent='保存領域を開けません。別の通常ブラウザで開き直してください。既存データは変更していません。';
    $('#settings').disabled=true
  }
})();

// expense.js
const utf8=new TextEncoder(), b64bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));

// extra.js
let voiceRecorder=null, voiceMedia=null, voiceTimer=null, voiceStarted=0, voicePlayer=null, voiceURL=null, voiceBusy=false;

// extra.js
const vaccineSource='https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/kekkaku-kansenshou/yobou-sesshu/index.html';

// extra.js
const labels={daily:'今日のデータ',growth:'成長写真',prep:'準備と予定',mother:'お母さん',graphs:'グラフ',visit:'受診用3日',vaccines:'予防接種',receipts:'レシート',voice:'声だけメモ'};

// extra.js
window.addEventListener('pagehide',()=>{
  if(voiceRecorder?.state==='recording')stopVoice()
});

// usability.js
let undoAction=null, quickBusy=false, reviewGroup='baby', reviewRange='30', reportYesterday=false, reportMemo=false, reportViewing=false, receiptFilter='all', observedState=null, setupDeferred=false;

// usability.js
const compareDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00'));

// usability.js
const prefsDefault=()=>({smallSign:true,food:false,diaper:true,sleep:true,breast:true,milk:true,pumped:true,milkAmounts:[60,80,100,120]});

// usability.js
document.addEventListener('focusin',e=>{
  if(e.target.matches('input,textarea,select'))document.body.classList.add('input-focused')
});

// usability.js
document.addEventListener('focusout',()=>setTimeout(()=>{
  if(!document.activeElement?.matches('input,textarea,select'))document.body.classList.remove('input-focused')
},0));

// usability.js
let chartSpan=null;

// usability.js
$('#settings').onclick=()=>{
  ensureUX();
  const exported=new Set(state.meta.lastExportItems||[]),added=backupItems().filter(k=>!exported.has(k)).length,bytes=new Blob([JSON.stringify(state)]).size;
  modal(`<h2>設定・バックアップ</h2><button id="prefs-open">表示・出生日・入力候補</button><h3>バックアップ状況</h3><p>最後の出力操作：${state.meta.lastExportAt?esc(new Date(state.meta.lastExportAt).toLocaleString('ja-JP')):'まだありません'}</p><p>その後の追加記録：${added}件<br>編集を含む更新：${Math.max(0,state.meta.revision-state.meta.lastExportRevision)}回<br>写真・音声を含むデータ：約${(bytes/1024/1024).toFixed(2)} MB</p><p class="hint">出力操作の履歴です。端末へのファイル保存完了は確認できません。保存先でファイルを確認してください。</p><button id="backup-export" class="primary">全データをバックアップ出力</button><label>バックアップから復元<input type="file" id="backup-restore" accept="application/json,.json"></label><p class="hint">復元は現在の記録を置き換えます。先にバックアップしてください。写真・録音・睡眠中の開始時刻も対象です。</p><button id="backup-close">戻る</button><p id="backup-error" role="alert"></p>`);
  $('#backup-close').onclick=close;
  $('#prefs-open').onclick=()=>setupForm(false);
  $('#backup-export').onclick=async()=>{
    try{
      await backupExport()
    }catch(e){
      $('#backup-error').textContent='出力できません。空き容量を確認してください'
    }
  };
  $('#backup-restore').onchange=async e=>{
    try{
      if(voiceRecorder?.state==='recording'||voiceBusy)throw Error('録音の保存が終わってから復元してください');
      const f=e.target.files[0];
      if(!f)return;
      const restored=JSON.parse(await f.text());
      validateBackup(restored);
      if(!confirm('現在の記録をバックアップの内容に置き換えますか？'))return;
      const previous=state;
      state=restored;
      observedState=null;
      ensureUX();
      try{
        await persist()
      }catch(e){
        state=previous;
        observedState=null;
        throw e
      }
      undoAction=null;
      close();
      render();
      notify('復元しました')
    }catch(e){
      $('#backup-error').textContent='復元できません：'+e.message
    }
  }
};

// usability.js
setInterval(()=>{
  document.querySelectorAll('[data-since]').forEach(el=>el.textContent=elapsed(Number(el.dataset.since)))
},60000);

// header.js
let signHidden=false, signPointer=null, signPressTimer=null, signLongPressed=false, undoExpireTimer=null, statusExpireTimer=null, headerFirstPaint=true;

// header.js
const mirrorOpen=$('#sign').onclick;

// header.js
if('scrollRestoration' in history)history.scrollRestoration='manual';

// header.js
bindSignGestures();

// header.js
updateHeaderClockFromHeader();

// header.js
setInterval(()=>updateHeaderClock(),1000);

// header.js
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){
    updateHeaderClock();
    if(undoAction&&Date.now()>=undoAction.until)clearNotice()
  }
});

// header.js
if(typeof module!=='undefined')module.exports={birthElapsed: birthElapsedFromHeader};

// administration.js
let routeHistory=[], lastRoute='home', dayPrivate=true, doctorDay=false, recordTarget='baby', searchText='', cameraStream=null, cameraOpening=false, cameraSession=0, receiptDraftImage=null;

// administration.js
page='home';

// administration.js
$('#dialog').addEventListener('close',stopReceiptCamera);

// administration.js
window.addEventListener('pagehide',stopReceiptCamera);

// vaccine-library.js
const VAX_SCHEDULE='https://id-info.jihs.go.jp/immunization/schedule/currently/index.html';

// vaccine-library.js
const VAX_NOTES='https://id-info.jihs.go.jp/immunization/schedule/2026/20261001_note.pdf';

// vaccine-library.js
const MHLW='https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/kekkaku-kansenshou/yobou-sesshu/';

// vaccine-library.js
const RATE_SOURCE='https://www.mhlw.go.jp/bunya/kenkou/kekkaku-kansenshou21/dl/260828-01.pdf';

// vaccine-library.js
const PRICE_SOURCE='https://www.city.shinjuku.lg.jp/content/000418936.pdf';

// vaccine-library.js
const VAX_CHECKED='2026年11月4日';

// vaccine-library.js
const VACCINES=[
vaccineData('hepb','B型肝炎','赤ちゃん・子供','定期A類','B型肝炎','標準：生後2～9か月。定期対象は1歳未満。','通常3回。1→2回は27日以上、1→3回は139日以上。母子感染予防は別の医療計画。',['1回目','2回目','3回目'],'hepatitis-b'),
vaccineData('rota1','ロタウイルス（1価）','赤ちゃん・子供','定期A類','ロタウイルス胃腸炎','生後6週～24週0日。初回は生後2か月頃、出生14週6日までが推奨。','27日以上あけて2回。5価とは選択肢であり、両方の全回数を受ける意味ではありません。',['1回目','2回目'],'rota',{risk:'下痢・嘔吐など。腸重積症に注意。接種後の反復する激しい泣き・嘔吐・血便は速やかに受診。'}),
vaccineData('rota5','ロタウイルス（5価）','赤ちゃん・子供','定期A類','ロタウイルス胃腸炎','生後6週～32週0日。初回は出生14週6日までが推奨。','27日以上ずつあけて3回。1価との選択は医療機関で確認。',['1回目','2回目','3回目'],'rota',{risk:'下痢・嘔吐など。腸重積症に注意。接種後の反復する激しい泣き・嘔吐・血便は速やかに受診。'}),
vaccineData('five','5種混合','赤ちゃん・子供','定期A類','百日せき・ジフテリア・破傷風・ポリオ・Hib感染症','標準：生後2～7か月未満に開始。定期対象は生後2か月～7歳6か月未満。','初回3回は各20日以上（標準20～56日）。追加は3回目から6～18か月。',['初回1','初回2','初回3','追加'],'dpt-ipv-hib'),
vaccineData('pcv','小児肺炎球菌（15価・20価）','赤ちゃん・子供','定期A類','肺炎球菌による髄膜炎・菌血症など','標準：生後2か月に開始、追加は生後12～15か月。定期対象は生後2か月～5歳未満。','生後2～7か月未満に開始なら初回3回＋追加1回。遅い開始では必要回数が変わります。',['初回1','初回2','初回3','追加'],'pneumococcus-child'),
vaccineData('bcg','BCG','赤ちゃん・子供','定期A類','結核','標準：生後5～8か月未満。定期対象は1歳未満。','1回。',['1回目'],'bcg',{risk:'接種部位が赤くなったり膿をもつことがあります。早期の強い反応や長引く症状は接種医へ相談。'}),
vaccineData('mr','MR（麻しん・風しん）','赤ちゃん・子供','定期A類','麻しん・風しん','1期：1歳～2歳未満。2期：小学校入学前の1年間。','1期・2期の計2回。',['1期','2期'],'mr',{rate:'2025年度・全国：麻しん1期96.2％、風しん1期96.2％。各対象者に対する接種率（MRと単独ワクチンを含み、特例接種者も含む）。約9.6割ですがMR製品だけの割合ではありません。',rateSource:RATE_SOURCE}),
vaccineData('varicella','水痘（水ぼうそう）','赤ちゃん・子供','定期A類','水痘','定期対象：1歳～3歳未満。標準初回は1歳～1歳3か月。','2回。3か月以上あけ、標準は1回目から6～12か月後。',['1回目','2回目'],'chickenpox'),
vaccineData('je','日本脳炎','赤ちゃん・子供','定期A類','日本脳炎','標準：3歳で2回、4歳で追加、9歳で2期。地域・事情で早期接種は医師と相談。','1期初回2回を6日以上（標準6～28日）あけ、追加はおおむね1年後。2期を含め計4回。',['1期初回1','1期初回2','1期追加','2期'],'japanese-encephalitis'),
vaccineData('dt','DT（2種混合）','赤ちゃん・子供','定期A類','ジフテリア・破傷風','定期対象：11歳～13歳未満。標準11歳。','2期として1回。',['2期'],'dt'),
vaccineData('hpv9','HPV（9価）','赤ちゃん・子供','定期A類','HPV感染に関連する子宮頸がんなど','定期対象：小学6年～高校1年相当の女子。標準は中学1年。','初回15歳未満は通常2回（標準6か月間隔）。15歳以降は通常3回。間隔によって追加が必要。',['1回目','2回目','3回目（必要な場合）'],null),
vaccineData('mumps','おたふくかぜ','任意・学会推奨','任意','流行性耳下腺炎と合併症','1歳から。日本小児科学会は1歳と就学前の2回を推奨。','2回の推奨と自治体の助成回数は別です。',['1回目','2回目'],null,{recommend:'日本小児科学会の推奨。国の定期接種と区別。',price:'2025年の例：新宿区の助成対象（1歳～就学前）の1回分自己負担3,000円。対象世帯は免除あり。全国相場や助成前の全額ではありません。',priceSource:PRICE_SOURCE,risk:'接種部位の腫れ、発熱など。まれな無菌性髄膜炎等について公式説明・接種医に確認。'}),
vaccineData('flu','インフルエンザ（注射）','任意・学会推奨','任意','季節性インフルエンザ','生後6か月から接種可能。乳児への適否は医師に確認。','13歳未満は通常そのシーズン2回（2～4週間隔）。毎年のため「別の回・年度を追加」で記録。',['今シーズン1','今シーズン2'],null),
vaccineData('flu-nasal','インフルエンザ（経鼻生）','任意・学会推奨','任意','季節性インフルエンザ','2歳以上19歳未満。赤ちゃんや妊婦には使いません。','通常そのシーズン1回。接種できない条件を医師に確認。',['今シーズン1'],null),
vaccineData('covid','新型コロナ（小児）','任意・学会推奨','任意','新型コロナウイルス感染症','小児の対象年齢は製品で異なります。乳幼児用は生後6か月からの製品があります。','年齢・製品・既接種歴で回数が違います。病院で決めた各回を登録。',['1回目','追加の回'],null),
vaccineData('rs-maternal','RSウイルス（母子免疫）','妊娠中のママ','定期A類','乳児のRSウイルス下気道感染症','2026年度から妊娠28週0日～36週6日の妊婦が定期対象。','妊娠中に1回。赤ちゃんへの注射ではありません。母子免疫用製剤を使用。',['今回の妊娠'],'rs',{risk:'接種部位の痛み、頭痛、筋肉痛など。妊娠経過・既往歴を接種医と確認。',price:'2025年の全国統一価格は確認できません。2026年度は定期接種の対象条件・自治体の案内を確認。'}),
vaccineData('dpt','DPT（3種混合）','個別事情・旧接種歴','定期／任意は用途による','百日せき・ジフテリア・破傷風','5種混合とは別製剤。接種歴・年齢・追加目的で判断。','必要回数と間隔は接種歴を医師に確認。重複登録・接種に注意。',['1回目','2回目','3回目','追加'],null),
vaccineData('ipv','不活化ポリオ（単独）','個別事情・旧接種歴','定期／任意は用途による','ポリオ','5種混合に含まれる成分。単独接種は過去の接種歴などで判断。','必要回数・間隔は既接種歴によります。',['1回目','2回目','3回目','追加'],null),
vaccineData('measles','麻しん（単独）','個別事情・旧接種歴','定期／任意は用途による','麻しん','通常はMRを使用。単独製剤を使う事情は自治体・医師に確認。','MRの記録と合わせて既接種回数を確認。',['1回目','2回目'],null),
vaccineData('rubella','風しん（単独）','個別事情・旧接種歴','定期／任意は用途による','風しん','通常はMRを使用。妊娠中は接種できません。','MRの記録と合わせて確認。妊娠予定を医師に伝えてください。',['1回目','2回目'],null),
vaccineData('hib-legacy','Hib（単独・旧記録用）','個別事情・旧接種歴','旧記録・供給終了','Hib感染症','国内流通ロットが2026年10月16日に使用期限を迎えたため、現行スケジュールでの表示終了。','新たな標準選択肢として勧めるものではありません。旧記録保存用。5種混合への移行は医師に確認。',['初回1','初回2','初回3','追加'],null),
vaccineData('four-legacy','4種混合（旧記録用）','個別事情・旧接種歴','旧記録・供給終了','百日せき・ジフテリア・破傷風・ポリオ','最終ロットの有効期限は2025年12月12日に終了。','旧記録保存用です。5種混合への移行は医師に確認。',['初回1','初回2','初回3','追加'],null),
...[
 ['hepa','A型肝炎','A型肝炎'],['tetanus','破傷風トキソイド','破傷風'],['meningococcus','髄膜炎菌','侵襲性髄膜炎菌感染症'],['typhoid','腸チフス','腸チフス'],['tick','ダニ媒介性脳炎','ダニ媒介性脳炎'],['yellow','黄熱','黄熱'],['rabies','狂犬病','狂犬病']
].map(([id,name,disease])=>vaccineData(id,name,'渡航・特別な事情','任意・個別判断',disease,'乳児全員への標準接種ではありません。製剤の対象年齢・渡航先・曝露歴により判断。','年齢・製剤・渡航前／曝露後で異なります。渡航外来・医師の指示を登録してください。',['1回目','2回目','3回目・追加'],null)),
...[
 ['hpv-old','HPV（2価・4価、旧歴）','HPV関連疾患'],['pcv-adult','成人用肺炎球菌','肺炎球菌感染症'],['rs-adult','成人用RSウイルス','RSウイルス感染症'],['zoster','帯状疱疹','帯状疱疹']
].map(([id,name,disease])=>vaccineData(id,name,'その他の公的掲載製剤','対象条件・製剤で異なる',disease,'赤ちゃんの標準接種とは異なる対象者・製剤です。公的スケジュールの該当欄を確認。','製剤・対象年齢・接種歴により異なります。医師の指示を登録。',['1回目','2回目・追加'],null))
];

// vaccine-library.js
const OLD_RATE_SOURCE='https://www.mhlw.go.jp/content/10906000/001359165.pdf';

// vaccine-library.js
for(const [id,note]of Object.entries({hepb:'B型肝炎：1回目96.0％、3回目94.3％。',rota1:'ロタ1価：1回目63.5％、2回目63.4％。5価は別集計。',rota5:'ロタ5価：1回目31.0％、3回目30.5％。1価は別集計。',pcv:'小児肺炎球菌：1回目96.8％、追加94.5％。現行の15価・20価別の割合ではありません。',bcg:'結核（BCG）：97.5％。',varicella:'水痘：1回目95.5％、2回目85.7％。',je:'日本脳炎：1期初回1回目106.5％。待機していた対象者の接種等を含むため100％超。', 'hib-legacy':'Hib：1回目96.8％、追加94.8％。', 'four-legacy':'4種混合：1回目96.4％、追加91.8％。'})){
  const r=VACCINES.find(v=>v.id===id);
  r.rate='過去資料：2022年度・全国の実施率。'+note+' 当該年度の実施人員／新たな対象人口による値で、同じ子供集団の「何割が接種したか」ではありません。最新の割合としては使わないでください。';
  r.rateSource=OLD_RATE_SOURCE
}

// folders.js
const folderNames={review:'記録を見る',baby:'赤ちゃん',mama:'ママ',expense:'支出',care:'予防接種',tools:'設定・準備',daily:'毎日の記録',day:'1日の全記録',search:'検索',prep:'予定・持ち物・連絡先',voice:'声だけメモ','receipt-view':'レシート台帳','legacy-photos':'旧写真の取り出し','pending-view':'睡眠中の記録'};

// folders.js
const leaves={milk:['授乳量','baby','mL／日'],breast:['母乳','baby','回／日'],food:['離乳食','baby','回／日'],poop:['うんち','baby','回／日'],pee:['おしっこ','baby','回／日'],babysleep:['睡眠','baby','時間／日'],height:['身長','baby','cm'],weight:['体重','baby','kg'],mamasleep:['睡眠','mama','時間／日'],mamaheight:['身長','mama','cm'],mamaweight:['体重','mama','kg'],condition:['体調・服薬','mama',''],notes:['日別メモ','review',''],expenses:['子供関係の出費','expense','円／日']};

// folders.js
let modalLayers=[];

// folders.js
$('#dialog').addEventListener('cancel',e=>{
  e.preventDefault();
  close()
});

// folders.js
const COLORS=['黄色','茶色','緑色','黒色','赤色','白っぽい','その他'];

// folders.js
const CHART_COLORS={'緑':'#426b52','青':'#2765a1','赤':'#b13d4b','紫':'#7b4aa0','黒':'#333333'};

// practical.js
folderNames.tools='初期設定・出産準備';

// practical.js
folderNames.alarms='音声アラーム';

// practical.js
folderNames.camera='カメラ';

// practical.js
const settings106=$('#settings').onclick;

// practical.js
$('#settings').onclick=()=>{
  settings106();
  $('#dialog h2').textContent='データ保存・復元';
  $('#prefs-open')?.remove()
};

// practical.js
let quickCamera=null, cameraToken=0, shotBlob=null, shotURL=null, shotSaved=true, shotBusy=false;

// practical.js
window.addEventListener('pagehide',releaseCamera);

// practical.js
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)releaseCamera();else if(page==='camera')startFastCamera()
});

// alarms.js
let alarmRecording=null, alarmMedia=null, alarmRecognition=null, stopRecognition=null, holdActive=false, holdToken=0, alarmDraft=null, alarmRecordingTimer=null, alarmFinalizing=false, alarmText='', alarmAudio=null, alarmAudioURL=null, alarmRinging=null, ringTimer=null, ringStarted=0, alarmTickBusy=false, alarmSoundArmed=false;

// alarms.js
window.addEventListener('pagehide',leaveAlarmFromAlarms);

// alarms.js
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&page==='alarms')leaveAlarm()
});

// alarms.js
setInterval(()=>tickAlarms(),250);

// family.js
const POO_SWATCHES=[['白っぽい','#eee7d5'],['薄い黄色','#e5d596'],['黄色','#d6b92a'],['黄土色','#b18a33'],['茶色','#80552e'],['緑色','#637443'],['黒っぽい','#35332f'],['赤っぽい','#a54436'],['その他','#a49a91']];

// family.js
const URINE_SWATCHES=[['無色に近い','#fafafa'],['ごく薄い黄色','#fffbe8'],['薄い黄色','#fff3b0'],['黄色','#f4d956'],['濃い黄色','#c7a52b'],['薄いオレンジ1','#ffe6b4'],['薄いオレンジ2','#ffd08b'],['オレンジ','#edaa52'],['濃いオレンジ1','#ce843c'],['濃いオレンジ2','#a7632d'],['薄いピンク1','#fae0df'],['薄いピンク2','#f3bcbb'],['ピンク','#e3989c'],['赤っぽい','#bf6468'],['赤色','#993b41'],['薄い茶色1','#e2ceba'],['薄い茶色2','#c8a987'],['茶色','#a17d5b'],['濃い茶色1','#79583f'],['濃い茶色2','#533e31'],['灰色がかる1','#e2e0d7'],['灰色がかる2','#c7c6b9'],['灰色がかる3','#aaa99d'],['褐色がかる1','#92816b'],['褐色がかる2','#6f6253']];

// family.js
let colourMonth=day(new Date()).slice(0,7);

// clinic.js
let dataEpoch=0, dataWiping=false, galleryTimer=null, galleryIndex=0, galleryAuto=false, previewAudio=null, previewTimer=null;

// clinic.js
const WEATHER_CREDIT='<a href="https://open-meteo.com/" target="_blank" rel="noopener">天気データ：Open-Meteo</a>（CC BY 4.0・地域の参考値）／ 地名：<a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a>';

// clinic.js
const PREFECTURES='北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(' ');

// clinic.js
const FACES=['いつも通り','白っぽい','赤っぽい','黄色っぽい','その他','不明'], MOODS=['ご機嫌','いつも通り','ぐずる','泣いている','眠そう','その他','不明'];

// clinic.js
const weatherBusy=new Set(), weatherTried=new Map(), weatherControllers=new Set();

// clinic.js
let weatherStatus='';

// clinic.js
class EraseGate{constructor(){
  this.phase='idle';
  this.since=0
}start(now){
  if(this.phase==='idle'){
    this.phase='holding';
    this.since=now
  }
}release(){
  if(this.phase==='holding')this.cancel()
}cancel(){
  this.phase='idle';
  this.since=0
}tick(now,visible=true){
  if(!visible){
    this.cancel();
    return false
  }
  if(this.phase==='holding'&&now-this.since>=10000){
    this.phase='countdown';
    this.since=now
  }
  if(this.phase==='countdown'&&now-this.since>=10000){
    this.phase='done';
    return true
  }
  return false
}remaining(now){
  return Math.max(0,Math.ceil((10000-(now-this.since))/1000))
}}

// clinic.js
let eraseGate=null, eraseTicker=null;

// clinic.js
const RESET_KEY='ritchan-baby-reset-event';

// clinic.js
let resetMark='';

// clinic.js
try{
  resetMark=localStorage.getItem(RESET_KEY)||''
}catch(e){
}

// clinic.js
window.addEventListener('storage',e=>{
  if(e.key===RESET_KEY&&e.newValue)handleOtherReset()
});

// clinic.js
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    cancelErase();
    stopGallery();
    stopPreview()
  }else if(page==='gallery')scheduleGallery()
});

// clinic.js
window.addEventListener('pagehide',()=>{
  cancelErase();
  stopGallery();
  stopPreview()
});

// daily-records.js
const FELT_AMOUNTS=['少','並','多','分からない'];

// daily-records.js
const ADDRESS_BASE='https://geolonia.github.io/japanese-addresses/api/', addressCache=new Map();

// daily-records.js
let healthLayout='groups';

// interaction.js
const draftContexts=new WeakMap();

// interaction.js
let leaveBusy=false, leaveBypass=false;

// interaction.js
window.addEventListener('beforeunload',e=>{
  if(dataWiping)return;
  if(openDraftForms().some(formIsDirty)){
    e.preventDefault();
    e.returnValue=''
  }
});

// interaction.js
let alarmDueQueue=[];

// media-fix.js
let alarmOutputEpoch=0, alarmQuietUntil=0;

// media-fix.js
const alarmOutputs=new Set();

// media-fix.js
window.addEventListener('pagehide',()=>stopAlarm('leave'));

// media-fix.js
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)stopAlarm('leave')
});

// sleep-mirror.js
let mirrorEpoch=0;

// reset-gallery.js
let resetInProgress=false, defaultGalleryBusy=false, resetChannel=null;

// reset-gallery.js
try{
  resetChannel=new BroadcastChannel("ritchan-baby-reset");
  resetChannel.onmessage=()=>{
    if(!dataWiping)handleOtherReset()
  }
}catch(e){
}

// reset-gallery.js
const backup118=$('#settings').onclick;

// reset-gallery.js
$('#settings').onclick=()=>{
  backup118();
  const d=$('#dialog'),h=[...d.querySelectorAll('h3')].find(h=>h.textContent==='バックアップ状況');
  if(h){
    let next=h.nextElementSibling;
    while(next&&next.id!=='backup-export'){
      const after=next.nextElementSibling;
      next.remove();
      next=after
    }
    h.insertAdjacentHTML('beforebegin',backupOverview());
    h.remove()
  }
};

// reset-gallery.js
const DEFAULT_GALLERY=[['01.png','写真1'],['02.png','写真2'],['03.png','写真3'],['04.jpg','写真4'],['05.jpg','写真5']];
