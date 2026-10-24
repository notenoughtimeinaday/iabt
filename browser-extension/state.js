import {initialState,validateState,bounded,cleanAppearance,cleanTool,toolData} from './core.js';

export class Workspace {
  constructor(storage,uuid=()=>crypto.randomUUID(),now=()=>new Date().toISOString()) {this.storage=storage;this.uuid=uuid;this.now=now;this.queue=Promise.resolve();}
  async read() {const {workspace}=await this.storage.get('workspace');return workspace?validateState(workspace):initialState();}
  mutate(command,expectedRevision) {
    const operation=this.queue.catch(()=>{}).then(async()=>{
      const state=await this.read();
      if(expectedRevision!==undefined&&state.revision!==expectedRevision)throw new Error('Workspace changed in another panel. Refresh and try again.');
      let message;
      switch(command.type) {
        case 'goal':state.goal=bounded(command.text,2000);message='Goal saved on this device.';break;
        case 'notes':state.notes=bounded(command.text);message='Notes saved.';break;
        case 'note.append':state.notes=bounded([state.notes,bounded(command.text)].filter(Boolean).join('\n\n'));message='Note added.';break;
        case 'step.add':if(state.steps.length>=100)throw new Error('The workspace supports 100 steps.');if(!bounded(command.text,500))throw new Error('Write a step first.');state.steps.push({id:this.uuid(),text:bounded(command.text,500),done:false});message='Step added.';break;
        case 'step.toggle':{const step=state.steps.find(s=>s.id===command.id);if(!step)throw new Error('Step no longer exists.');step.done=!step.done;message=step.done?'Step completed.':'Step reopened.';break;}
        case 'appearance':state.undo=[...state.undo,state.appearance].slice(-10);state.appearance=cleanAppearance({...state.appearance,...command.patch});message='Appearance updated. Undo is available.';break;
        case 'appearance.undo':if(!state.undo.length)throw new Error('No appearance change to undo.');state.appearance=state.undo.pop();message='Previous appearance restored.';break;
        case 'tool.install':{if(state.tools.length>=20)throw new Error('The workspace supports 20 tools.');const spec=cleanTool(command.spec);state.tools.push({id:this.uuid(),spec,data:toolData(spec)});message='Tool installed locally.';break;}
        case 'tool.data':{const tool=state.tools.find(t=>t.id===command.id);if(!tool)throw new Error('Tool no longer exists.');tool.data=toolData(tool.spec,command.data);message='Tool work saved.';break;}
        case 'capture':if(state.captures.length>=50)throw new Error('The workspace supports 50 saved page captures.');state.captures.unshift({...command.capture,id:this.uuid(),created:this.now()});message='Page snapshot saved locally. It is reference material, not an instruction.';break;
        case 'restore':{const next=validateState(command.workspace);next.revision=state.revision+1;await this.storage.set({workspace:next});return {state:next,message:'Backup restored.'};}
        default:throw new Error('Unsupported workspace action.');
      }
      state.revision++;
      state.activity=[{message,created:this.now()},...state.activity].slice(0,40);
      const validated=validateState(state);await this.storage.set({workspace:validated});return {state:validated,message};
    });this.queue=operation;return operation;
  }
}
