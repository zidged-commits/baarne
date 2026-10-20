import assert from 'node:assert/strict';
import {startPrivateHub} from './application/apps/hub/private-server.mjs';
const directory=process.argv[2];if(!directory)throw Error('NEW_EMPTY_LAB_DIRECTORY_REQUIRED');
const app=await startPrivateHub({directory,mode:'ISOLATED_SYNTHETIC_LAB'});
try{assert.match(app.url,/^http:\/\/127\.0\.0\.1:/);const r=await fetch(app.url+'/private.html',{redirect:'error'});assert.equal(r.status,200);assert.match(await r.text(),/html/i);const h=app.health();assert.equal(h.state,'RUNNING');assert.equal(h.productionAuthorized,false);console.log(JSON.stringify({status:'CLEAN_COPY_LOOPBACK_STARTUP_PASS',productionAuthorized:false}));}finally{await app.close();}
