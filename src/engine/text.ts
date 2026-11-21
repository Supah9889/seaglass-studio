/**
 * SG-19: editable text layers.
 *
 * A text layer is an ordinary layer whose `text` field holds the editable source: the content,
 * box and style. Its canvas is a rendered cache of that source, so compositing, visibility,
 * opacity, ordering, groups, blend modes, thumbnails, PNG export and recovery all work without
 * changes. Raster tools never paint on a text layer; edits go through the source and re-render
 * the cache. Projects store both, so a file reopens with identical pixels and stays editable.
 */
export type TextAlign='left'|'center'|'right';
export type TextData={text:string;x:number;y:number;width:number;height:number;fontFamily:string;fontSize:number;color:string;align:TextAlign;lineHeight:number};
export type TextBox={x:number;y:number;width:number;height:number};
export type Measure=(text:string)=>number;

export const TEXT_FONTS:readonly {label:string;value:string}[]=[
 {label:'Arial',value:'Arial, Helvetica, sans-serif'},
 {label:'Segoe UI',value:'"Segoe UI", Arial, sans-serif'},
 {label:'Verdana',value:'Verdana, Geneva, sans-serif'},
 {label:'Trebuchet MS',value:'"Trebuchet MS", Arial, sans-serif'},
 {label:'Georgia',value:'Georgia, "Times New Roman", serif'},
 {label:'Times New Roman',value:'"Times New Roman", Times, serif'},
 {label:'Courier New',value:'"Courier New", Consolas, monospace'},
 {label:'Comic Sans MS',value:'"Comic Sans MS", "Comic Sans", cursive'},
];
/** Boxes may extend past the canvas edge, within this many pixels. */
export const TEXT_MAX_EXTENT=16384;
export const TEXT_MIN_SIZE=4,TEXT_MAX_SIZE=512,TEXT_MAX_CHARS=10_000,TEXT_MIN_BOX=8,TEXT_LINE_HEIGHT=1.25;
export const TEXT_LAYER_RASTER_MESSAGE='Text layers can’t be painted directly. Edit them with the Text tool, or choose Rasterize in Layers to paint on them.';
export const TEXT_LAYER_LOCKED_MESSAGE='Unlock this text layer to edit or rasterize it.';
export const TEXT_LOCKED_GROUP_MESSAGE='This layer group is locked. Unlock it, or select a layer outside it, to add text.';
export const DEFAULT_TEXT_STYLE={fontFamily:TEXT_FONTS[0].value,fontSize:48,align:'left' as TextAlign};

const isFiniteNumber=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const HEX=/^#[0-9a-f]{6}$/i;
/** Font lists are stored as text; only plain family names, quotes, commas and spaces are accepted. */
const FONT_FAMILY=/^[A-Za-z0-9 ,"'_-]{1,160}$/;

/**
 * Validates text source read from a project. Returns null for anything malformed so the reader
 * can refuse the file instead of guessing. Values are clamped to the supported ranges.
 */
export function normalizeTextData(value:unknown,docWidth:number,docHeight:number):TextData|null{
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>;
 if(typeof v.text!=='string'||v.text.length>TEXT_MAX_CHARS)return null;
 if(![v.x,v.y,v.width,v.height,v.fontSize].every(isFiniteNumber))return null;
 if(typeof v.fontFamily!=='string'||!FONT_FAMILY.test(v.fontFamily))return null;
 if(typeof v.color!=='string'||!HEX.test(v.color))return null;
 if(v.align!=='left'&&v.align!=='center'&&v.align!=='right')return null;
 const lineHeight=v.lineHeight===undefined?TEXT_LINE_HEIGHT:v.lineHeight;
 if(!isFiniteNumber(lineHeight))return null;
 return{text:v.text,
  x:clamp(v.x as number,-TEXT_MAX_EXTENT,docWidth+TEXT_MAX_EXTENT),y:clamp(v.y as number,-TEXT_MAX_EXTENT,docHeight+TEXT_MAX_EXTENT),
  width:clamp(v.width as number,TEXT_MIN_BOX,TEXT_MAX_EXTENT),height:clamp(v.height as number,TEXT_MIN_BOX,TEXT_MAX_EXTENT),
  fontFamily:v.fontFamily,fontSize:clamp(v.fontSize as number,TEXT_MIN_SIZE,TEXT_MAX_SIZE),color:v.color.toLowerCase(),align:v.align,
  lineHeight:clamp(lineHeight,.8,3)};
}
export function sameTextData(a:TextData|undefined,b:TextData|undefined){
 if(!a||!b)return a===b;
 return a.text===b.text&&a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height&&a.fontFamily===b.fontFamily&&a.fontSize===b.fontSize&&a.color===b.color&&a.align===b.align&&a.lineHeight===b.lineHeight;
}
export const textFont=(data:Pick<TextData,'fontSize'|'fontFamily'>)=>`${data.fontSize}px ${data.fontFamily}`;
export const lineAdvance=(data:Pick<TextData,'fontSize'|'lineHeight'>)=>data.fontSize*data.lineHeight;

/**
 * Wraps like a textarea with `white-space: pre-wrap; overflow-wrap: break-word`: explicit line
 * breaks are kept, lines break after spaces, and a word wider than the box breaks between
 * characters. Trailing spaces never force a wrap.
 */
export function wrapText(text:string,width:number,measure:Measure):string[]{
 const breakWord=(token:string)=>{const parts:string[]=[];let part='',partWidth=0;for(const char of Array.from(token)){const w=measure(char);if(part&&char.trim()&&partWidth+w>width){parts.push(part);part='';partWidth=0;}part+=char;partWidth+=w;}parts.push(part);return parts;};
 const lines:string[]=[];
 for(const paragraph of text.split('\n')){
  let line='';
  for(const token of paragraph.match(/\S+\s*|\s+/g)??[]){
   if(line&&measure((line+token).trimEnd())<=width){line+=token;continue;}
   if(line){lines.push(line);line='';}
   if(measure(token.trimEnd())>width){const parts=breakWord(token);lines.push(...parts.slice(0,-1));line=parts[parts.length-1];}
   else line=token;
  }
  lines.push(line);
 }
 return lines;
}
export type TextLine={text:string;x:number;y:number};
/** Line positions in document pixels. `y` is the vertical middle of each line box. */
const layoutCache=new Map<string,string[]>();
const LAYOUT_CACHE_LIMIT=64;
/** Wrapped lines for a source, cached by everything that affects wrapping. */
function wrappedLines(data:TextData,measure:Measure,cacheable:boolean){
 if(!cacheable)return wrapText(data.text,data.width,measure);
 const key=`${data.fontSize}|${data.fontFamily}|${data.width}|${data.text}`,hit=layoutCache.get(key);
 if(hit){layoutCache.delete(key);layoutCache.set(key,hit);return hit;}
 const lines=wrapText(data.text,data.width,measure);
 layoutCache.set(key,lines);if(layoutCache.size>LAYOUT_CACHE_LIMIT)layoutCache.delete(layoutCache.keys().next().value!);
 return lines;
}
/** Real canvas measurements are cacheable; tests pass their own measure functions. */
const canvasMeasures=new WeakSet<Measure>();
export function layoutText(data:TextData,measure:Measure){
 const lines=wrappedLines(data,measure,canvasMeasures.has(measure)),advance=lineAdvance(data);
 const x=data.align==='left'?data.x:data.align==='center'?data.x+data.width/2:data.x+data.width;
 return{lines:lines.map((text,i):TextLine=>({text,x,y:data.y+advance*(i+.5)})),contentHeight:lines.length*advance};
}
/** The box as displayed: never shorter than its text. */
export function textBounds(data:TextData,measure:Measure):TextBox{
 const {contentHeight}=layoutText(data,measure);
 return{x:data.x,y:data.y,width:data.width,height:Math.max(data.height,contentHeight)};
}
type Ctx2D=Pick<CanvasRenderingContext2D,'clearRect'|'save'|'restore'|'fillText'|'measureText'>&{font:string;fillStyle:string|CanvasGradient|CanvasPattern;textAlign:CanvasTextAlign;textBaseline:CanvasTextBaseline};
export const contextMeasure=(ctx:Pick<CanvasRenderingContext2D,'measureText'>):Measure=>{const measure:Measure=text=>ctx.measureText(text).width;canvasMeasures.add(measure);return measure;};
/**
 * Replaces the layer's cached pixels with the rendered text. With `previous`, only the area
 * either version could have inked is cleared (box plus a margin for glyph overhang), which
 * keeps typing cheap on large canvases.
 */
export function renderTextLayer(canvas:HTMLCanvasElement,data:TextData,previous?:TextData){
 const ctx=canvas.getContext('2d') as unknown as Ctx2D|null;
 if(!ctx)throw new Error('Canvas memory is unavailable for this text layer.');
 drawText(ctx,canvas.width,canvas.height,data,previous?inkArea(ctx,[previous,data]):undefined);
}
/** Generous bounds of everything a set of text sources can draw. */
function inkArea(ctx:Ctx2D,sources:TextData[]):TextBox{
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(const data of sources){
  ctx.font=textFont(data);
  const box=textBounds(data,contextMeasure(ctx)),margin=Math.ceil(data.fontSize);
  x0=Math.min(x0,box.x-margin);y0=Math.min(y0,box.y-margin);x1=Math.max(x1,box.x+box.width+margin);y1=Math.max(y1,box.y+box.height+margin);
 }
 return{x:Math.floor(x0),y:Math.floor(y0),width:Math.ceil(x1-x0),height:Math.ceil(y1-y0)};
}
export function drawText(ctx:Ctx2D,width:number,height:number,data:TextData,clear?:TextBox){
 if(clear)ctx.clearRect(clear.x,clear.y,clear.width,clear.height);else ctx.clearRect(0,0,width,height);
 ctx.save();
 ctx.font=textFont(data);ctx.fillStyle=data.color;ctx.textAlign=data.align;ctx.textBaseline='middle';
 for(const line of layoutText(data,contextMeasure(ctx)).lines)if(line.text.trim())ctx.fillText(line.text,line.x,line.y);
 ctx.restore();
}
/** A text box created by a click gets a comfortable default width that stays inside the canvas. */
export function textBoxFromGesture(start:{x:number;y:number},end:{x:number;y:number},docWidth:number,docHeight:number,fontSize:number,zoom:number):TextBox{
 const dragged=Math.hypot(end.x-start.x,end.y-start.y)*zoom>=4;
 const line=Math.ceil(fontSize*TEXT_LINE_HEIGHT);
 if(!dragged){
  const x=clamp(Math.round(start.x),0,Math.max(0,docWidth-TEXT_MIN_BOX)),y=clamp(Math.round(start.y),0,Math.max(0,docHeight-TEXT_MIN_BOX));
  return{x,y,width:Math.max(TEXT_MIN_BOX,Math.min(Math.round(fontSize*10),docWidth-x)),height:line};
 }
 const x=Math.round(Math.min(start.x,end.x)),y=Math.round(Math.min(start.y,end.y));
 return{x,y,width:Math.max(TEXT_MIN_BOX,Math.round(Math.abs(end.x-start.x))),height:Math.max(TEXT_MIN_BOX,line,Math.round(Math.abs(end.y-start.y)))};
}
export type TextHandle='move'|'nw'|'ne'|'sw'|'se'|'e'|'w';
/** Handles are hit in screen pixels so they stay easy to grab at any zoom. */
export function hitTestTextBox(box:TextBox,p:{x:number;y:number},zoom:number):TextHandle|null{
 const r=8/zoom,left=box.x,right=box.x+box.width,top=box.y,bottom=box.y+box.height,midY=(top+bottom)/2;
 const near=(x:number,y:number)=>Math.abs(p.x-x)<=r&&Math.abs(p.y-y)<=r;
 if(near(left,top))return'nw';if(near(right,top))return'ne';if(near(left,bottom))return'sw';if(near(right,bottom))return'se';
 if(near(right,midY))return'e';if(near(left,midY))return'w';
 if(p.x>=left-r/2&&p.x<=right+r/2&&p.y>=top-r/2&&p.y<=bottom+r/2)return'move';
 return null;
}
/** Applies a move or resize drag to the original source. Resizing keeps the opposite edge fixed. */
export function dragTextBox(original:TextData,handle:TextHandle,dx:number,dy:number):TextData{
 if(handle==='move')return{...original,x:Math.round(original.x+dx),y:Math.round(original.y+dy)};
 let {x,y,width,height}=original;
 if(handle==='nw'||handle==='sw'||handle==='w'){const right=x+width;width=Math.max(TEXT_MIN_BOX,Math.round(width-dx));x=right-width;}
 if(handle==='ne'||handle==='se'||handle==='e')width=Math.max(TEXT_MIN_BOX,Math.round(width+dx));
 if(handle==='nw'||handle==='ne'){const bottom=y+height;height=Math.max(TEXT_MIN_BOX,Math.round(height-dy));y=bottom-height;}
 if(handle==='sw'||handle==='se')height=Math.max(TEXT_MIN_BOX,Math.round(height+dy));
 return{...original,x,y,width,height};
}
export const textHandleCursor=(handle:TextHandle|null)=>handle==='move'?'move':handle==='nw'||handle==='se'?'nwse-resize':handle==='ne'||handle==='sw'?'nesw-resize':handle==='e'||handle==='w'?'ew-resize':'text';
/** A layer name from the first line of text, like other editors. */
export function textLayerName(text:string){const first=text.split('\n').find(line=>line.trim())?.trim()??'Text';return first.length>32?first.slice(0,31)+'…':first;}
/** Draws a text box outline on the overlay canvas: dashed while drafting, with handles when selected. */
export function drawTextBoxOverlay(canvas:HTMLCanvasElement|null,box:TextBox,zoom:number,withHandles:boolean){
 const c=canvas?.getContext('2d');if(!canvas||!c)return;
 const z=Math.max(.1,zoom),size=8/z,half=size/2;
 c.save();c.lineWidth=1.5/z;c.setLineDash([5/z,3/z]);c.strokeStyle='rgba(16,75,88,.95)';c.strokeRect(box.x,box.y,box.width,box.height);
 c.setLineDash([]);c.lineWidth=1/z;c.strokeStyle='rgba(255,255,255,.9)';c.strokeRect(box.x-1/z,box.y-1/z,box.width+2/z,box.height+2/z);
 if(withHandles){
  const midY=box.y+box.height/2;
  for(const [x,y] of [[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height],[box.x,midY],[box.x+box.width,midY]]){
   c.beginPath();c.rect(x-half,y-half,size,size);c.fillStyle='#f7ffff';c.fill();c.strokeStyle='#147f91';c.lineWidth=1.5/z;c.stroke();
  }
 }
 c.restore();
}
