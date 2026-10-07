import { unzip } from 'fflate';
import { DESKTOP, CONTROL, SETTINGS, CARD, GROUP_LABEL, stemOf, slotSize, matchName } from './lib/icon/iconSpec';

const grid=document.querySelector('#grid'), count=document.querySelector('#count'), status=document.querySelector('#status'); let group='DESKTOP'; const picked=new Map(); const replacementUrls=new Map(); let previewBytes;
const alphabet='0123456789';function randomId(){let out='';for(let i=0;i<12;i++)out+=alphabet[Math.floor(Math.random()*alphabet.length)];return out}document.querySelector('#random-id').onclick=()=>{document.querySelector('#pkg').value=randomId()};
const slots={DESKTOP:DESKTOP.map(slot=>slot.stem),CONTROL:CONTROL.map(slot=>slot.stem),SETTINGS:SETTINGS.map(slot=>slot.stem),CARD:CARD.map(slot=>slot.stem)};
function render(){grid.innerHTML='';for(const stem of slots[group]){const el=document.createElement('div');el.className='slot'+(picked.has(stem)?' selected':'');el.dataset.stem=stem;const img=document.createElement('img');const previewStem=stem==='perpetual_calendar'?'calendar_background':stem;img.src=replacementUrls.get(stem)||`/stock_icons/${previewStem}.png`;img.alt=stem;img.onerror=()=>{img.style.display='none'};el.append(img);const row=document.createElement('div');row.className='slot-row';const label=document.createElement('small');label.textContent=stem;row.append(label);const actions=document.createElement('div');actions.className='slot-actions';const replace=document.createElement('button');replace.type='button';replace.className='slot-action replace';replace.textContent='选择替换图标';replace.onclick=(ev)=>{ev.stopPropagation();chooseReplacement(stem)};const restore=document.createElement('button');restore.type='button';restore.className='slot-action';restore.textContent='复原官方图标';restore.onclick=(ev)=>{ev.stopPropagation();picked.delete(stem);replacementUrls.delete(stem);status.textContent=`已复原 ${stem}`;update()};actions.append(replace,restore);row.append(actions);el.append(row);el.onclick=()=>chooseReplacement(stem);img.onclick=(ev)=>{ev.stopPropagation();chooseReplacement(stem)};grid.append(el)}count.textContent=picked.size}
function chooseReplacement(stem){const input=document.createElement('input');input.type='file';input.accept='image/png';input.onchange=async()=>{const file=input.files?.[0];if(!file)return;const bm=await createImageBitmap(file);const [width,height]=slotSize(stemOf(stem));if(bm.width!==width||bm.height!==height){status.textContent=`${stem} 必须选择 ${width}×${height} PNG`;return}const c=document.createElement('canvas');c.width=bm.width;c.height=bm.height;c.getContext('2d').drawImage(bm,0,0);picked.set(stem,c.getContext('2d').getImageData(0,0,c.width,c.height));replacementUrls.set(stem,c.toDataURL('image/png'));status.textContent=`已替换 ${stem}`;update()};input.click()}
function update(){count.textContent=picked.size;render();document.querySelector('#export').disabled=!picked.size}
for(const t of document.querySelectorAll('.tab'))t.onclick=()=>{document.querySelector('.tab.active').classList.remove('active');t.classList.add('active');group=t.dataset.group;render()};document.querySelector('#clear').onclick=()=>{if(!confirm(`确定清空当前“${GROUP_LABEL[group]}”页面的全部替换图标并恢复官方图标吗？`))return;for(const stem of slots[group]){picked.delete(stem);replacementUrls.delete(stem)}status.textContent='当前页面已恢复官方图标';update()};render();
async function importNamedPng(file) {
  if (!/\.png$/i.test(file.name)) return false;
  const slot = matchName(file.name.replace(/\.[^.]+$/, ''));
  if (!slot) return false;
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (![137,80,78,71,13,10,26,10].every((v,i)=>signature[i]===v)) return false;
  const bm = await createImageBitmap(file);
  try {
    const [width,height] = slotSize(slot);
    if (bm.width !== width || bm.height !== height) return false;
    const c = document.createElement('canvas'); c.width=width; c.height=height;
    const ctx = c.getContext('2d'); ctx.drawImage(bm,0,0);
    picked.set(slot.stem,ctx.getImageData(0,0,width,height));
    replacementUrls.set(slot.stem,c.toDataURL('image/png'));
    return true;
  } finally { bm.close(); }
}
document.querySelector('#files').onchange = async e => {
  const input=e.target, files=Array.from(input.files || []);
  let matched=0, rejected=0; const errors=[];
  status.textContent='正在导入…'; input.disabled=true;
  try {
    for (const file of files) {
      let candidates=[file];
      if (/\.zip$/i.test(file.name)) {
        try {
          const awaitBuffer = await file.arrayBuffer();
          const entries = await new Promise((resolve,reject)=>unzip(new Uint8Array(awaitBuffer), (err,data)=>err?reject(err):resolve(data)));
          candidates=Object.entries(entries).filter(([path])=>!path.endsWith('/') && !path.startsWith('__MACOSX/') && /\.png$/i.test(path)).map(([path,data])=>new File([data],path.split(/[\\/]/).pop(),{type:'image/png'}));
        } catch { errors.push(`无法解压 ${file.name}`); continue; }
      }
      for (const candidate of candidates) {
        try { if(await importNamedPng(candidate)) matched++; else rejected++; }
        catch { rejected++; }
      }
    }
    status.textContent=(matched ? `已导入 ${matched} 张图标${rejected?`，跳过 ${rejected} 张`:''}` : '请上传符合名称和尺寸的 PNG 图片或 ZIP 压缩包')+(errors.length?`；${errors.join('；')}`:'');
  } finally { input.disabled=false; input.value=''; update(); }
};

async function assetText(name){const r=await fetch(new URL('../pack/'+name,document.baseURI));return r.text()}async function assetBytes(name){const r=await fetch(new URL('../pack/'+name,document.baseURI));return new Uint8Array(await r.arrayBuffer())}function save(b,n){const a=document.createElement('a');const u=URL.createObjectURL(new Blob([b],{type:'application/octet-stream'}));a.href=u;a.download=n;a.style.display='none';document.body.appendChild(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(u)},1000)}
document.querySelector('#export').onclick=async()=>{try{status.textContent='正在生成…';const {convert}=await import('./lib/icon/iconConvert');const {exportIcons}=await import('./lib/icon/iconSpec');const {buildIconPack}=await import('./lib/pack/packBuilders');const converted=new Map();for(const [stem,image] of picked){const p=image.data,px=new Uint32Array(image.width*image.height);for(let i=0;i<px.length;i++)px[i]=(p[i*4+3]<<24)|(p[i*4]<<16)|(p[i*4+1]<<8)|p[i*4+2];const slot=(await import('./lib/icon/iconSpec')).stemOf(stem);converted.set(stem,convert(px,image.width,image.height,slot)[0])}const icons=exportIcons(converted);const {imageDataPreview}=await import('./lib/pack/previewFactory');const pc=document.createElement('canvas');pc.width=336;pc.height=480;const pctx=pc.getContext('2d');pctx.fillStyle='#1c1c1e';pctx.fillRect(0,0,336,480);pctx.fillStyle='#f2f2f2';pctx.font='40px sans-serif';pctx.textAlign='center';pctx.fillText(document.querySelector('#title').value,168,90);const preview=imageDataPreview(pctx.getImageData(0,0,336,480));const out=buildIconPack({ko:await assetBytes('chaos_sup.ko'),iconBin:await assetBytes('chaos_icon.bin'),fontLua:'',iconLua:await assetText('icon_pack.lua')},{short:document.querySelector('#short').value,packName:document.querySelector('#packname').value,title:document.querySelector('#title').value,pkgName:document.querySelector('#pkg').value||null,icons},preview);save(out.bytes,out.pkgName+'.bin');status.textContent=`已生成 ${out.iconCount} 张图标，包名 ${out.pkgName}`;}catch(e){status.textContent=e.message||String(e)}};
