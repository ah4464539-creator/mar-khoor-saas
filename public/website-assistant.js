const launch=document.getElementById('mk-ai-launch');
const panel=document.getElementById('mk-ai-panel');
const close=document.getElementById('mk-ai-close');
const form=document.getElementById('mk-ai-form');
const input=document.getElementById('mk-ai-input');
const send=document.getElementById('mk-ai-send');
const messages=document.getElementById('mk-ai-messages');
function toggle(open){panel.hidden=!open;launch.setAttribute('aria-expanded',String(open));if(open)input.focus();else launch.focus()}
launch.addEventListener('click',()=>toggle(panel.hidden));close.addEventListener('click',()=>toggle(false));
panel.addEventListener('keydown',e=>{if(e.key==='Escape')toggle(false)});
function addMessage(text,from){const p=document.createElement('p');p.dataset.from=from;p.textContent=text;messages.append(p);messages.scrollTop=messages.scrollHeight;return p}
form.addEventListener('submit',async e=>{
 e.preventDefault();const message=input.value.trim();if(!message||send.disabled)return;
 addMessage(message,'user');input.value='';send.disabled=true;const pending=addMessage('Thinking…','assistant');
 try{const res=await fetch('/api/public/assistant/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})});const data=await res.json();pending.textContent=res.ok?data.reply:(data.error||'Assistant unavailable');}
 catch{pending.textContent='Connection unavailable. Please try again.'}
 finally{send.disabled=false;input.focus()}
});

fetch('/api/public/assistant/status', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(status => { launch.hidden = status?.enabled !== true; })
  .catch(() => {});
