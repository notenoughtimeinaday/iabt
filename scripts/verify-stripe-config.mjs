import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../base44/shared/stripe.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
const env={STRIPE_WEBHOOK_SECRET:'whsec_fixture',STRIPE_BUILDER_PRICE_ID:'price_fixture_b',STRIPE_PRO_PRICE_ID:'price_fixture_p',STRIPE_AGENCY_PRICE_ID:'price_fixture_a',STRIPE_AI_CREDIT_PACK_PRICE_ID:'price_fixture_c'};
const ctx=vm.createContext({secrets:{get:k=>env[k]},URL:globalThis.URL,URLSearchParams:globalThis.URLSearchParams,crypto:globalThis.crypto});
vm.runInContext(source,ctx);
for(const mode of ['test','live']){
 env.IABT_STRIPE_MODE=mode;
 for(const type of ['sk','rk']){
  env.STRIPE_SECRET_KEY=[type,mode,'fixture'].join('_');
  assert.equal(ctx.getStripeReadiness().ready,true);
  assert.ok(ctx.authHeaders().Authorization);
  env.STRIPE_SECRET_KEY=[type,mode==='test'?'live':'test','fixture'].join('_');
  assert.equal(ctx.getStripeReadiness().ready,false);
  assert.throws(()=>ctx.authHeaders());
 }
}
console.log('PASS: IABT secret/restricted keys accepted only in matching environment; wrong-mode credentials rejected.');
