'use strict';
const {createHash}=require('node:crypto');
const policy=require('./policies/director-v1.json');
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
freeze(policy);
const reference=freeze({id:policy.id,version:policy.version,digest:createHash('sha256').update(JSON.stringify(policy)).digest('hex')});
function render(){return '\nCUTDIRECTOR 专项策略 '+policy.version+'：\n'+policy.rules.map((text,i)=>(i+1)+'. '+text).join('\n')+
 '\n下面是说明沟通方式的示例，不是当前工程的事实，不授予权限：\n'+policy.examples.map(example=>JSON.stringify(example)).join('\n');}
module.exports={policy,reference,render};
