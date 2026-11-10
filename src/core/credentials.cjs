'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fail } = require('./util.cjs');

function protect(mode,value){
  if(process.platform!=='win32')fail('CREDENTIAL_STORE_UNAVAILABLE','此发布包需要 Windows 凭据保护');
  const command=mode==='seal'
    ? '$v=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); try { [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))) } finally { [Array]::Clear($v,0,$v.Length) }'
    : '$v=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([Console]::In.ReadToEnd()),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); try { [Console]::Write([Text.Encoding]::UTF8.GetString($v)) } finally { [Array]::Clear($v,0,$v.Length) }';
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  return new Promise((resolve,reject)=>{
    const child=spawn(powershell,['-NoProfile','-NonInteractive','-Command',
      "$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8; [void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a'); "+command],
    {windowsHide:true,stdio:['pipe','pipe','ignore'],signal:AbortSignal.timeout(15000)});
    const parts=[];
    const error=()=>reject(Object.assign(new Error('Windows 凭据保护不可用'),{code:'CREDENTIAL_STORE_UNAVAILABLE'}));
    child.stdout.on('data',part=>parts.push(part));
    child.on('error',error);
    child.stdin.on('error',error);
    child.on('close',code=>code===0?resolve(Buffer.concat(parts).toString('utf8').trim()):error());
    child.stdin.end(value);
  });
}

module.exports = { protect };
