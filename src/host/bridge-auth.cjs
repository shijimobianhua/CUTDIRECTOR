'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes,createHmac,timingSafeEqual}=require('node:crypto');
const os=require('node:os');

function key(){
  const root=process.env.VIDEO_AGENT_BRIDGE_DIR||path.join(process.env.LOCALAPPDATA||os.homedir(),'CUTDIRECTOR');
  const file=path.join(root,'bridge.key');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  try{fs.writeFileSync(file,randomBytes(32),{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const bytes=fs.readFileSync(file);
  if(bytes.length!==32)throw new Error('Invalid CUTDIRECTOR bridge key');
  return bytes;
}
function sign(secret,direction,route){
  return createHmac('sha256',secret).update(direction+':'+route).digest('hex');
}
function matches(actual,expected){
  return typeof actual==='string'&&actual.length===expected.length&&
    /^[a-f0-9]+$/.test(actual)&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
module.exports={key,sign,matches};
