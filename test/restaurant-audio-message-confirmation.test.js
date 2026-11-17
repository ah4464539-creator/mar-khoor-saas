import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const voice = readFileSync(new URL('../public/restaurant-assistant-voice.js',import.meta.url),'utf8');
const panel = readFileSync(new URL('../public/restaurant-assistant-panel.js',import.meta.url),'utf8');
const sites = readFileSync(new URL('../src/sites.js',import.meta.url),'utf8');
const start = voice.indexOf('function explicitYes(text) {');
const end = voice.indexOf('async function verifiedMenu',start);
const confirm = vm.runInNewContext(voice.slice(start,end)+'; explicitYes;');

test('accepts natural English, Roman Urdu, Hindi and Urdu confirmations',()=>{
  for(const phrase of ['Yes, confirm my order','haan ji yehi order confirm kar dein','Please place the order','हाँ जी, यही ऑर्डर कन्फर्म कर दो','جی ہاں کنفرم کر دو']){
    assert.equal(confirm(phrase),true,phrase);
  }
});
test('does not accept explicit negation',()=>{
  for(const phrase of ['no','nahi confirm','dont place order','नहीं अभी नहीं','cancel order']) assert.equal(confirm(phrase),false,phrase);
});
test('same draft does not clear already obtained confirmation',()=>{
  assert.match(voice,/signature !== current\.draftSignature\) current\.confirmedSinceDraft = false/);
});
test('only one live voice control is rendered',()=>{
  assert.match(sites,/id="start-voice"/);
  assert.doesNotMatch(sites,/id="stop-voice"/);
  assert.doesNotMatch(sites,/id="assistant-audio-message"/);
  assert.doesNotMatch(sites,/id="assistant-dictate"/);
  assert.match(voice,/finish\('Voice ended\.'\)/);
});
