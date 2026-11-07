'use strict';
// Only measured baby growth; export is independent of graph/day filters.
function growthExportRows(){
 const birth=state.profile.birth;
 const ordinal=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||'');return m?Date.UTC(+m[1],+m[2]-1,+m[3])/86400000:null};
 const born=ordinal(birth),valid=n=>Number.isFinite(n)&&n>0.1;
 return state.records.filter(r=>r.type==='growth'&&Number.isFinite(Date.parse(r.at))&&(valid(r.height)||valid(r.weight))).slice().sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).map(r=>{
  const at=new Date(r.at),d=day(at),age=born===null?null:ordinal(d)-born;
  return [localTime(at).replace('T',' ').replaceAll('-','/')+':'+String(at.getSeconds()).padStart(2,'0'),age!==null&&age>=0?age:'',valid(r.height)?r.height:'',valid(r.weight)?r.weight:''];
 });
}
function growthExportCSV(rows=growthExportRows()){
 const quote=v=>'"'+String(v).replaceAll('"','""')+'"';
 return '\ufeff'+[['測定日時','生後日数（日）','身長（cm）','体重（kg）'],...rows].map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n';
}
function exportBabyGrowth(){const rows=growthExportRows();if(!rows.length){notify('身長・体重の記録がありません');return}saveBytes('baby-growth-'+day(new Date())+'.csv',growthExportCSV(rows),'text/csv;charset=utf-8');notify('Excel用ファイルの保存先を確認してください')}
const render117=render;
render=function(){render117();const v=$('#view');if(page==='home'){v.querySelectorAll('[data-go="health"]').forEach(b=>{b.innerHTML='健康カルテ<small class="doctor-subtitle">お医者様へ</small>'})}if(page==='leaf:height'||page==='leaf:weight'){const box=document.createElement('aside');box.className='growth-export';box.innerHTML='<button type="button" id="growth-export">Excel用に保存</button><small>赤ちゃんの身長・体重を、全期間まとめて保存します。</small>';v.querySelector('h2').after(box);$('#growth-export').disabled=growthExportRows().length===0;$('#growth-export').onclick=exportBabyGrowth}};
if(state)render();
