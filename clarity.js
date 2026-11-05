'use strict';
// v1.10: one task per screen, preserving the existing storage format.
function milkTotal(d=day(new Date())){
 const rs=state.records.filter(r=>r.type==='milk'&&day(r.at)===d&&Number.isFinite(r.amount)&&r.amount>0);
 const sum=kind=>{const items=rs.filter(r=>r.kind===kind);return items.length?items.reduce((n,r)=>n+r.amount,0)+' mL':'未記録'};
 const total=rs.reduce((n,r)=>n+r.amount,0);
 return '<aside class="milk-total"><strong>'+esc(d)+' の飲んだ量（合計）</strong><p>'+(rs.length?total+' mL':'未記録')+'</p><small>ミルク '+sum('ミルク')+' ／ 搾母乳 '+sum('搾母乳')+'<br>直接の母乳は量に含めません。</small></aside>';
}
const feed108=feedMenu,milk108=milkQuick;
feedMenu=function(){feed108();$('#dialog h2')?.insertAdjacentHTML('afterend',milkTotal())};
milkQuick=function(kind){milk108(kind);$('#dialog h2')?.insertAdjacentHTML('afterend',milkTotal())};
sleepToggle=function(who){
 ensureUX();const previous=state.activeSleep[who]?{...state.activeSleep[who]}:null;
 const label=who==='mama'?'ママ':'赤ちゃん';
 form(label+'：'+(previous?'起きた':'寝た'),'<p class="hint">いまの時刻が入っています。時刻を押すと変更できます。</p><label>寝た日時<input name="at" type="datetime-local" required value="'+localTime(previous?.at||new Date())+'"></label>'+(previous?'<label>起きた日時<input name="end" type="datetime-local" required value="'+localTime(new Date())+'"></label>':'')+'<button type="button" id="sleep-now">'+(previous?'起きた':'寝た')+'時刻を「いま」にする</button>',async f=>{
  const at=new Date(f.get('at')),end=previous?new Date(f.get('end')):null,now=new Date();
  if(!Number.isFinite(+at)||at>now)throw Error('寝た日時は現在以前を指定してください');
  if(previous&&(!Number.isFinite(+end)||end>now||end<=at))throw Error('起きた日時は寝た日時より後、現在以前を指定してください');
  if(previous&&end-at>86400000&&!confirm('24時間以上の睡眠です。日時が正しければ保存します。'))throw Error('日時を確認してください');
  const record=previous?{id:uid(),type:'sleep',who,at:at.toISOString(),end:end.toISOString(),memo:''}:null;
  if(record){state.records.push(record);delete state.activeSleep[who]}else state.activeSleep[who]={id:uid(),at:at.toISOString()};
  try{await persist()}catch(e){if(record)state.records=state.records.filter(r=>r.id!==record.id);if(previous)state.activeSleep[who]=previous;else delete state.activeSleep[who];throw e}
 });
 $('#sleep-now').onclick=()=>{$('#dialog input[name="'+(previous?'end':'at')+'"]').value=localTime(new Date())};
};
const modal108=modal;
modal=function(html){modal108(html);const d=$('#dialog');d.querySelectorAll('button').forEach(b=>{if(b.matches('[data-home]'))b.textContent='TOP';else if(b.id!=='modal-back'&&/^(戻る|前のページへ|TOPへ?)$/.test(b.textContent.trim()))b.hidden=true});};
const render108=render;
render=function(){
 render108();const v=$('#view'),home=page==='home';
 document.body.classList.toggle('focused-mode',!home);
 $('#nav').hidden=true;document.querySelector('footer').hidden=!home;
 v.querySelectorAll('.breadcrumbs').forEach(n=>n.remove());
 v.querySelectorAll('[data-home]').forEach(b=>b.textContent='TOP');
 v.querySelectorAll('#admin-backup').forEach(b=>b.remove());
 const navs=v.querySelectorAll('.page-navigation');navs.forEach((n,i)=>{if(i)n.remove()});
 if(!home)v.querySelectorAll('button').forEach(b=>{if(!b.closest('.page-navigation')&&/^(戻る|前のページへ|TOPへ?)$/.test(b.textContent.trim()))b.hidden=true});
 if(home){const h=v.querySelector('h2');if(h){h.className='top-marker';h.innerHTML='TOP <small>ここから選んでください</small>'}$('#settings').textContent='バックアップ・復元';}
 if(page==='daily'&&$('#entry-feed'))$('#entry-feed').textContent='ミルク・授乳';
 if(page==='leaf:milk')v.querySelector('h2')?.insertAdjacentHTML('afterend',milkTotal(date));
 $('#dialog').querySelectorAll('.milk-total').forEach(n=>n.outerHTML=milkTotal());
 wireNavigation();
};
if(state)render();
