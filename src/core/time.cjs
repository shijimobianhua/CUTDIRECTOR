'use strict';
const {fail}=require('./util.cjs');
function fpsCheck(fps) { if(!fps || !Number.isSafeInteger(fps.num)||!Number.isSafeInteger(fps.den)||fps.num<=0||fps.den<=0) fail('FPS_INVALID'); }
function frame(us,fps,policy='nearest') {
  fpsCheck(fps); if(!Number.isSafeInteger(us)||us<0) fail('TIME_INVALID');
  const n=BigInt(us)*BigInt(fps.num), d=1000000n*BigInt(fps.den);
  const q=policy==='floor'?n/d:policy==='ceil'?(n+d-1n)/d:policy==='nearest'?(2n*n+d)/(2n*d):fail('QUANTIZATION_INVALID');
  const out=Number(q); if(!Number.isSafeInteger(out)) fail('TIME_OVERFLOW'); return out;
}
function microseconds(f,fps) { fpsCheck(fps); if(!Number.isSafeInteger(f)||f<0) fail('TIME_INVALID'); return Number((BigInt(f)*1000000n*BigInt(fps.den)+BigInt(fps.num)/2n)/BigInt(fps.num)); }
function cover(startUs,endUs,fps) { if(endUs<=startUs) fail('RANGE_INVALID'); return {inFrame:frame(startUs,fps,'floor'),outFrame:frame(endUs,fps,'ceil'),policy:'outward'}; }
module.exports={fpsCheck,frame,microseconds,cover};
