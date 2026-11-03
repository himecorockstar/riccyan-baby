'use strict';
const BabyCore=(()=>{
const day=d=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`};
function sleepMinutes(records,who,date){const start=new Date(date+'T00:00:00').getTime(),end=new Date(new Date(date+'T00:00:00').setDate(new Date(date+'T00:00:00').getDate()+1)).getTime();const ranges=records.filter(r=>r.type==='sleep'&&r.who===who).map(r=>[Math.max(start,new Date(r.at).getTime()),Math.min(end,new Date(r.end).getTime())]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a).sort((a,b)=>a[0]-b[0]);let total=0,edge=-Infinity;for(const [a,b] of ranges){total+=Math.max(0,b-Math.max(a,edge));edge=Math.max(edge,b)}return Math.round(total/60000)}
function summary(records,date){const r=records.filter(x=>day(x.at)===date);return {milk:r.filter(x=>x.type==='milk').reduce((a,x)=>a+x.amount,0),milkCount:r.filter(x=>x.type==='milk').length,food:r.filter(x=>x.type==='food').length,diaper:r.filter(x=>x.type==='diaper').length,babySleep:sleepMinutes(records,'baby',date),mamaSleep:sleepMinutes(records,'mama',date)}}
return {day,sleepMinutes,summary};})();
if(typeof module!=='undefined')module.exports=BabyCore;
