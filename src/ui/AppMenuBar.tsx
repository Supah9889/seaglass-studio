import {useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';

export type MenuCommand={
 label:string;
 shortcut?:string|null;
 disabled?:boolean;
 run:(opener:HTMLButtonElement)=>void;
};

export type MenuGroup={label:string;commands:MenuCommand[]};

const compactQuery='(max-width: 680px)';
const groupList=-1;

export function AppMenuBar({groups,onOpenChange,canOpen}:{
 groups:MenuGroup[];
 onOpenChange:(open:boolean)=>void;
 canOpen:()=>boolean;
}){
 const [open,setOpen]=useState<number|null>(null);
 const [compact,setCompact]=useState(()=>matchMedia(compactQuery).matches);
 const nav=useRef<HTMLElement>(null);
 const popup=useRef<HTMLDivElement>(null);
 const triggers=useRef<(HTMLButtonElement|null)[]>([]);
 const opener=useRef<HTMLButtonElement|null>(null);
 const focusLast=useRef(false);
 const returnGroup=useRef<number|null>(null);
 const dismissedClick=useRef<EventTarget|null>(null);
 const breakpointFocus=useRef(false);
 const onChange=useRef(onOpenChange);
 onChange.current=onOpenChange;

 function close(restoreFocus=true){
  setOpen(null);
  onChange.current(false);
  if(restoreFocus)opener.current?.focus();
 }

 function show(index:number,button:HTMLButtonElement,last=false){
  if(!canOpen())return;
  opener.current=button;
  focusLast.current=last;
  returnGroup.current=null;
  setOpen(index);
  onChange.current(true);
 }

 useLayoutEffect(()=>{
  const query=matchMedia(compactQuery);
  const resize=()=>{
   breakpointFocus.current=!!nav.current?.contains(document.activeElement);
   setCompact(query.matches);
   setOpen(null);
   onChange.current(false);
  };
  query.addEventListener('change',resize);
  const resetClick=(event:MouseEvent)=>{if(event.detail===1)dismissedClick.current=null;};
  const blockDoubleClick=(event:MouseEvent)=>{
   if(dismissedClick.current===event.target){event.preventDefault();event.stopImmediatePropagation();}
   dismissedClick.current=null;
  };
  document.addEventListener('click',resetClick,true);
  document.addEventListener('dblclick',blockDoubleClick,true);
  return()=>{
   query.removeEventListener('change',resize);
   document.removeEventListener('click',resetClick,true);
   document.removeEventListener('dblclick',blockDoubleClick,true);
  };
 },[]);

 useLayoutEffect(()=>{
  if(breakpointFocus.current){
   breakpointFocus.current=false;
   nav.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.focus();
  }
 },[compact]);

 useLayoutEffect(()=>{
  if(open===null)return;
  const items=popup.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]')??[];
  const index=returnGroup.current??(focusLast.current?items.length-1:0);
  items[index]?.focus();
  const outside=(event:Event)=>!nav.current?.contains(event.target as Node);
  const block=(event:Event)=>{
   if(!outside(event))return;
   event.preventDefault();
   event.stopImmediatePropagation();
  };
  const dismiss=(event:Event)=>{
   if(!outside(event))return;
   if(event.type==='click')dismissedClick.current=event.target;
   block(event);
   close();
  };
  const blockDrag=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();};
  document.addEventListener('pointerdown',block,true);
  document.addEventListener('click',dismiss,true);
  document.addEventListener('wheel',block,{capture:true,passive:false});
  document.addEventListener('dragenter',blockDrag,true);
  document.addEventListener('dragover',blockDrag,true);
  document.addEventListener('drop',blockDrag,true);
  document.addEventListener('contextmenu',dismiss,true);
  return()=>{
   document.removeEventListener('pointerdown',block,true);
   document.removeEventListener('click',dismiss,true);
   document.removeEventListener('wheel',block,true);
   document.removeEventListener('dragenter',blockDrag,true);
   document.removeEventListener('dragover',blockDrag,true);
   document.removeEventListener('drop',blockDrag,true);
   document.removeEventListener('contextmenu',dismiss,true);
  };
 },[open]);

 function menuKey(event:KeyboardEvent<HTMLDivElement>){
  event.stopPropagation();
  const items=Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]')??[]);
  const index=items.indexOf(document.activeElement as HTMLButtonElement);
  if(event.key==='Tab'){close();return;}
  if(event.key==='Escape'){event.preventDefault();close();return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'||event.key==='Home'||event.key==='End'){
   event.preventDefault();
   const position=event.key==='Home'?0:event.key==='End'?items.length-1:
    (index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
   items[position]?.focus();
  }else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
   event.preventDefault();
   if(compact){
    if(open===groupList&&event.key==='ArrowRight')items[index]?.click();
    else if(open!==groupList&&event.key==='ArrowLeft')back();
   }else if(open!==null){
    const next=(open+(event.key==='ArrowRight'?1:-1)+groups.length)%groups.length;
    const trigger=triggers.current[next];
    if(trigger)show(next,trigger);
   }
  }
 }

 function back(){
  returnGroup.current=open;
  setOpen(groupList);
 }

 function trigger(index:number,label:string){
  const expanded=compact?open!==null:open===index;
  return <button
   ref={button=>{triggers.current[index]=button;}} type="button"
   aria-label={compact?'Application menu':label} aria-haspopup="menu" aria-expanded={expanded}
   aria-controls={expanded?'application-menu-popup':undefined}
   onClick={event=>{if(expanded)close();else show(index,event.currentTarget);}}
   onKeyDown={event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
     event.preventDefault();
     if(expanded)popup.current?.querySelector<HTMLButtonElement>(event.key==='ArrowUp'?'[role=menuitem]:last-child':'[role=menuitem]')?.focus();
     else show(index,event.currentTarget,event.key==='ArrowUp');
    }else if(!compact&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){
     event.preventDefault();
     const next=(index+(event.key==='ArrowRight'?1:-1)+groups.length)%groups.length;
     triggers.current[next]?.focus();
    }
   }}>{label}</button>;
 }

 function entries(){
  if(open===groupList)return groups.map((group,index)=><button key={group.label} type="button"
   role="menuitem" tabIndex={-1} aria-label={group.label} aria-haspopup="menu" onClick={()=>{focusLast.current=false;returnGroup.current=null;setOpen(index);}}>
   {group.label}<span aria-hidden="true">›</span>
  </button>);
  return <>
   {compact&&<button role="menuitem" type="button" tabIndex={-1} onClick={back}>‹ All menus</button>}
   {open!==null&&groups[open].commands.map((command,index)=><button key={command.label}
    role="menuitem" type="button" tabIndex={-1} aria-label={command.label}
    aria-describedby={command.shortcut?`menu-key-${index}`:undefined}
    aria-disabled={command.disabled||undefined} onClick={()=>{
     const button=opener.current;
     if(command.disabled||!button)return;
     close();
     command.run(button);
    }}>
    <span>{command.label}</span>{command.shortcut&&<kbd id={`menu-key-${index}`}>{command.shortcut}</kbd>}
   </button>)}
  </>;
 }

 const popover=open!==null&&<div ref={popup} id="application-menu-popup" className="menu-popover glass"
  role="menu" aria-label={open===groupList?'Application menu':groups[open].label} onKeyDown={menuKey}>
  {entries()}
 </div>;

 return <nav ref={nav} className="menubar app-menubar" aria-label="Application commands">
  {compact?<div className="menu-anchor">{trigger(groupList,'Menu')}{popover}</div>:
   groups.map((group,index)=><div className="menu-anchor" key={group.label}>
    {trigger(index,group.label)}{open===index&&popover}
   </div>)}
 </nav>;
}
