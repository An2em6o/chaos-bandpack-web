/** Browser implementation of Android PreviewFactory's palette/RLE block. */
export const PREVIEW_W = 336;
export const PREVIEW_H = 480;
const MAGIC = 0x5aa521e0;

function le16(v: number) { return [v & 255, (v >>> 8) & 255]; }
function le32(v: number) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
function qkey(r:number,g:number,b:number) { return ((r >>> 3) << 12) | ((g >>> 3) << 6) | (b >>> 3); }

export function rleEncode(data: Uint8Array): Uint8Array {
  const out:number[]=[]; let i=0;
  while(i<data.length){ let j=i; while(j<data.length&&data[j]===data[i])j++; let run=j-i;
    if(run>=3){ while(run){const n=Math.min(run,127); out.push(n,data[i]); run-=n;i+=n;} }
    else {const s=i; let k=i; while(k<data.length&&k-s<127){if(k+2<data.length&&data[k]===data[k+1]&&data[k]===data[k+2])break;k++;} out.push(0x80|(k-s),...data.subarray(s,k));i=k;}
  } return Uint8Array.from(out);
}

export function encodePreview(indices: Uint8Array, palette: Uint8Array, w=PREVIEW_W, h=PREVIEW_H): Uint8Array {
  if(indices.length!==w*h||palette.length!==1024) throw new Error("预览像素或调色板长度不符");
  const raw=new Uint8Array(1024+indices.length); raw.set(palette); raw.set(indices,1024);
  const stream=rleEncode(raw), out=new Uint8Array(20+stream.length), dv=new DataView(out.buffer);
  dv.setUint8(0,0x10); dv.setUint8(1,4); dv.setUint16(2,0,true); dv.setUint16(4,w,true); dv.setUint16(6,h,true); dv.setUint32(8,stream.length+8,true);
  dv.setUint32(12,MAGIC,true); dv.setUint32(16,(1|((raw.length&0xffffff)<<4))>>>0,true); out.set(stream,20); return out;
}

export function decodePreview(blob: Uint8Array): {w:number;h:number;palette:Uint8Array;indices:Uint8Array} {
  if(blob.length<20||blob[0]!==0x10||blob[1]!==4) throw new Error("不是小米预览 RLE 块");
  const dv=new DataView(blob.buffer,blob.byteOffset,blob.byteLength), w=dv.getUint16(4,true),h=dv.getUint16(6,true), len=dv.getUint32(8,true);
  if(dv.getUint32(12,true)!==MAGIC) throw new Error("预览魔数不符");
  const meta=dv.getUint32(16,true), total=meta>>>4; if((meta&15)!==1||total!==1024+w*h) throw new Error("预览长度不符");
  const raw=new Uint8Array(total); let i=20,o=0; while(o<total){const c=blob[i++]; if(c<128){const n=c; raw.fill(blob[i++],o,o+n);o+=n;} else {const n=c&127;raw.set(blob.subarray(i,i+n),o);i+=n;o+=n;}}
  if(o!==total||i!==blob.length) throw new Error("预览 RLE 流损坏"); return {w,h,palette:raw.slice(0,1024),indices:raw.slice(1024)};
}

/** Converts ImageData/ARGB pixels to the Android-compatible 256-color block. */
export function imageDataPreview(image: ImageData): Uint8Array {
  if(image.width!==PREVIEW_W||image.height!==PREVIEW_H) throw new Error(`预览尺寸必须是 ${PREVIEW_W}x${PREVIEW_H}`);
  const counts=new Map<number,number>(), reps=new Map<number,[number,number,number]>(), p=image.data;
  for(let i=0;i<p.length;i+=4){const a=p[i+3]; if(a<16)continue; const k=qkey(p[i],p[i+1],p[i+2]);counts.set(k,(counts.get(k)||0)+1);if(!reps.has(k))reps.set(k,[p[i],p[i+1],p[i+2]]);}
  const colors=[...counts.entries()].sort((a,b)=>b[1]-a[1]).map(([k])=>reps.get(k)!); const must=[[28,28,30],[42,130,228],[255,195,0]]; for(const c of must)if(!colors.some(x=>x[0]===c[0]&&x[1]===c[1]&&x[2]===c[2]))colors.push(c);
  if(colors.length>255) throw new Error("预览调色板超过 256 色"); const pal=new Uint8Array(1024); const map=new Map<number,number>(); colors.forEach((c,i)=>{pal[(i+1)*4]=c[2];pal[(i+1)*4+1]=c[1];pal[(i+1)*4+2]=c[0];pal[(i+1)*4+3]=255;map.set(qkey(...c),i+1);});
  const idx=new Uint8Array(PREVIEW_W*PREVIEW_H); for(let i=0,j=0;i<p.length;i+=4,j++){if(p[i+3]>=16)idx[j]=map.get(qkey(p[i],p[i+1],p[i+2]))!;} return encodePreview(idx,pal);
}
