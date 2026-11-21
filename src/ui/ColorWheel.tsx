import {useRef} from 'react';
import {hsvToHex,mapWheelPoint,type HSV} from '../engine/colors';
type Props={value:HSV;onChange:(value:HSV)=>void;onCommit:()=>void};
const hueGradient='conic-gradient(#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)';
export default function ColorWheel({value,onChange,onCommit}:Props){
 const ref=useRef<HTMLDivElement>(null),drag=useRef(false),mode=useRef<'hue'|'sv'|null>(null);
 const update=(e:React.PointerEvent<HTMLDivElement>)=>{const rect=ref.current?.getBoundingClientRect();if(!rect)return;const pos=mapWheelPoint(e.clientX-rect.left,e.clientY-rect.top,Math.min(rect.width,rect.height),value);if(!mode.current){if(pos.zone==='outside')return;mode.current=pos.zone;}if(mode.current==='hue')onChange({...value,h:pos.hue});else onChange({...value,s:pos.saturation,v:pos.value});};
 const down=(e:React.PointerEvent<HTMLDivElement>)=>{drag.current=true;mode.current=null;e.currentTarget.setPointerCapture(e.pointerId);update(e);};
 const up=(e:React.PointerEvent<HTMLDivElement>)=>{if(!drag.current)return;drag.current=false;mode.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);onCommit();};
 const rad=value.h*Math.PI/180,hx=50+43*Math.cos(rad),hy=50+43*Math.sin(rad),sx=25+value.s*50,sy=25+(1-value.v)*50;
 return <div ref={ref} className="color-wheel" role="application" aria-label="HSV color wheel. Drag the outer ring to select hue and the inner square to select saturation and brightness." onPointerDown={down} onPointerMove={e=>{if(drag.current)update(e)}} onPointerUp={up} onPointerCancel={up}>
  <div className="wheel-ring" style={{background:hueGradient}}/><div className="wheel-sv" style={{backgroundColor:`hsl(${value.h} 100% 50%)`}}/><span className="wheel-hue-marker" style={{left:`${hx}%`,top:`${hy}%`}}/><span className="wheel-sv-marker" style={{left:`${sx}%`,top:`${sy}%`,backgroundColor:hsvToHex(value)??'#fff'}}/>
 </div>;
}
