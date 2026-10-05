/* ZIP store writer: own-source, UTF-8 names, no compression/runtime dependency. */
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
export function zipFiles(files){
 const enc=new TextEncoder(),parts=[],central=[];let offset=0;
 for(const file of files){
  if(!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/.test(file.name)||file.name.includes('..'))throw Error('Unsafe archive filename');
  const name=enc.encode(file.name),data=enc.encode(file.text),crc=crc32(data),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);local.set(name,30);
  const c=new Uint8Array(46+name.length),d=new DataView(c.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);c.set(name,46);
  parts.push(local,data);central.push(c);offset+=local.length+data.length;
 }
 const size=central.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
 const result=new Uint8Array(offset+size+22);let at=0;for(const p of [...parts,...central,end]){result.set(p,at);at+=p.length;}return result;
}
