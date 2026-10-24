export const HOST='com.iabt.master_control';
export function cleanNativeAction(raw) {
  if(!raw||!['move','click','doubleClick','rightClick','scroll','type','key'].includes(raw.kind))throw new Error('Unsupported computer action.');
  const action={kind:raw.kind};
  if(['move','click','doubleClick','rightClick','scroll'].includes(raw.kind)){
    if(!Number.isInteger(raw.x)||!Number.isInteger(raw.y)||Math.abs(raw.x)>100000||Math.abs(raw.y)>100000)throw new Error('Enter integer screen coordinates.');action.x=raw.x;action.y=raw.y;
  }
  if(raw.kind==='scroll'){if(!Number.isInteger(raw.amount)||raw.amount===0||Math.abs(raw.amount)>20)throw new Error('Scroll amount must be between -20 and 20.');action.amount=raw.amount;}
  if(raw.kind==='type'){if(typeof raw.text!=='string'||!raw.text||raw.text.length>2000)throw new Error('Typed text must contain 1–2000 characters.');action.text=raw.text;}
  if(raw.kind==='key'){if(!['ENTER','TAB','ESC','BACKSPACE','CTRL+A','CTRL+C','CTRL+V','CTRL+Z','CTRL+L'].includes(raw.key))throw new Error('Unsupported keyboard shortcut.');action.key=raw.key;}
  if(['type','key'].includes(raw.kind)){if(typeof raw.window!=='string'||!/^\d{1,20}$/.test(raw.window))throw new Error('Select a target window first.');action.window=raw.window;action.title=String(raw.title||'').slice(0,300);}
  return action;
}
export function parseNativeCommand(value,target) {
  const text=value.trim();
  const typing=text.match(/^type\s+([\s\S]+)$/i);
  if(typing)return cleanNativeAction({kind:'type',...target,text:typing[1]});
  const key=text.match(/^press\s+(enter|tab|esc|backspace|ctrl\+[acvzl])$/i);
  if(key)return cleanNativeAction({kind:'key',...target,key:key[1].toUpperCase()});
  const scroll=text.match(/^scroll (up|down) (\d+) at (-?\d+)\s*[, ]\s*(-?\d+)$/i);
  if(scroll)return cleanNativeAction({kind:'scroll',x:Number(scroll[3]),y:Number(scroll[4]),amount:Number(scroll[2])*(scroll[1].toLowerCase()==='down'?-1:1)});
  let match=value.trim().match(/^(move(?: cursor)?|click|double click|right click)(?: to| at)?\s+(-?\d+)\s*[, ]\s*(-?\d+)$/i);
  if(!match)return null;
  const kind=({'move cursor':'move','double click':'doubleClick','right click':'rightClick'})[match[1].toLowerCase()]||match[1].toLowerCase();
  return cleanNativeAction({kind,x:Number(match[2]),y:Number(match[3])});
}
export function createVault(api) {
  let mode='unknown';
  const rpc=async(message)=>{const result=await api.runtime.sendNativeMessage(HOST,message);if(!result?.ok)throw new Error(result?.error||'The local companion refused this request.');return result;};
  async function connect(){try{const result=await rpc({type:'status'});mode='vault';return {connected:true,...result};}catch(error){mode='session';return {connected:false,message:'Windows companion is not connected. Work is temporary in this browser session; it is not yet stored in an encrypted folder.'};}}
  const ensure=async()=>{if(mode==='unknown')await connect();};
  const storage={
    async get(){await ensure();if(mode==='vault')return {workspace:(await rpc({type:'workspace.read'})).workspace};return api.storage.session.get('workspace');},
    async set(value){await ensure();if(mode==='vault')return rpc({type:'workspace.write',workspace:value.workspace});return api.storage.session.set(value);},
  };
  return {storage,connect,rpc,async history(event){await ensure();if(mode==='vault')await rpc({type:'history.append',event});},async status(){await ensure();return {connected:mode==='vault'};}};
}
