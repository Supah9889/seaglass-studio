import {describe,expect,it,vi} from 'vitest';
import {dragTextBox,drawText,hitTestTextBox,layoutText,normalizeTextData,sameTextData,textBounds,textBoxFromGesture,textLayerName,wrapText,type TextData} from './text';

// Every character is 10 px wide, so widths are easy to reason about.
const measure=(text:string)=>Array.from(text).length*10;
const base:TextData={text:'Hello',x:10,y:20,width:100,height:30,fontFamily:'Arial, Helvetica, sans-serif',fontSize:20,color:'#112233',align:'left',lineHeight:1.25};

describe('text wrapping',()=>{
 it('keeps explicit line breaks and empty lines',()=>{
  expect(wrapText('a\n\nb',100,measure)).toEqual(['a','','b']);
  expect(wrapText('',100,measure)).toEqual(['']);
 });
 it('wraps after spaces like a pre-wrap textarea',()=>{
  expect(wrapText('one two three',80,measure)).toEqual(['one two ','three']);
 });
 it('lets trailing spaces hang instead of forcing a new line',()=>{
  expect(wrapText('abcd    ',40,measure)).toEqual(['abcd    ']);
 });
 it('breaks a word wider than the box between characters',()=>{
  expect(wrapText('abcdefghij',40,measure)).toEqual(['abcd','efgh','ij']);
  expect(wrapText('hi abcdefgh',40,measure)).toEqual(['hi ','abcd','efgh']);
 });
 it('breaks a very long word with one measurement per character',()=>{
  let calls=0;const counting=(t:string)=>{calls++;return measure(t);};
  const lines=wrapText('x'.repeat(10_000),100,counting);
  expect(lines).toHaveLength(1000);expect(lines.every(line=>line.length===10)).toBe(true);
  expect(calls).toBeLessThan(10_100);
 });
 it('handles characters outside the Basic Multilingual Plane as single characters',()=>{
  expect(wrapText('😀😀😀',20,measure)).toEqual(['😀😀','😀']);
 });
});

describe('text layout',()=>{
 it('places each line in the middle of its line box',()=>{
  const {lines,contentHeight}=layoutText({...base,text:'a\nb'},measure);
  expect(lines).toEqual([{text:'a',x:10,y:32.5},{text:'b',x:10,y:57.5}]);
  expect(contentHeight).toBe(50);
 });
 it('anchors centered and right-aligned text to the box',()=>{
  expect(layoutText({...base,align:'center'},measure).lines[0].x).toBe(60);
  expect(layoutText({...base,align:'right'},measure).lines[0].x).toBe(110);
 });
 it('grows the displayed box to fit its text but never shrinks it',()=>{
  expect(textBounds(base,measure).height).toBe(30);
  expect(textBounds({...base,text:'a\nb\nc'},measure).height).toBe(75);
 });
 it('draws every non-blank line with the source style and clears the old pixels',()=>{
  const ctx={clearRect:vi.fn(),save:vi.fn(),restore:vi.fn(),fillText:vi.fn(),measureText:(t:string)=>({width:measure(t)}),font:'',fillStyle:'',textAlign:'start',textBaseline:'alphabetic'};
  drawText(ctx as never,200,100,{...base,text:'a\n \nb',align:'center'});
  expect(ctx.clearRect).toHaveBeenCalledWith(0,0,200,100);
  expect(ctx.fillText.mock.calls).toEqual([['a',60,32.5],['b',60,82.5]]);
  expect(ctx.font).toBe('20px Arial, Helvetica, sans-serif');
  expect(ctx.fillStyle).toBe('#112233');
  expect(ctx.textAlign).toBe('center');
  expect(ctx.textBaseline).toBe('middle');
 });
});

describe('text boxes',()=>{
 it('creates a default-width box for a click and keeps it inside the canvas',()=>{
  expect(textBoxFromGesture({x:100,y:50},{x:101,y:50},1000,800,40,1)).toEqual({x:100,y:50,width:400,height:50});
  expect(textBoxFromGesture({x:900,y:50},{x:900,y:50},1000,800,40,1).width).toBe(100);
 });
 it('uses the dragged rectangle in any direction',()=>{
  expect(textBoxFromGesture({x:300,y:200},{x:100,y:100},1000,800,20,1)).toEqual({x:100,y:100,width:200,height:100});
 });
 it('treats a small drag at high zoom as a click',()=>{
  expect(textBoxFromGesture({x:10,y:10},{x:10.3,y:10},1000,800,20,8).width).toBe(200);
 });
 it('hit-tests corners, side handles and the body with zoom-independent tolerance',()=>{
  const box={x:100,y:100,width:200,height:50};
  expect(hitTestTextBox(box,{x:100,y:100},1)).toBe('nw');
  expect(hitTestTextBox(box,{x:300,y:150},1)).toBe('se');
  expect(hitTestTextBox(box,{x:300,y:125},1)).toBe('e');
  expect(hitTestTextBox(box,{x:200,y:125},1)).toBe('move');
  expect(hitTestTextBox(box,{x:400,y:125},1)).toBeNull();
  expect(hitTestTextBox(box,{x:101,y:101},.1)).toBe('nw');
 });
 it('moves by whole pixels and resizes while keeping the opposite edge fixed',()=>{
  expect(dragTextBox(base,'move',5.4,-3.6)).toMatchObject({x:15,y:16,width:100,height:30});
  expect(dragTextBox(base,'w',20,0)).toMatchObject({x:30,width:80});
  expect(dragTextBox(base,'se',-30,10)).toMatchObject({x:10,y:20,width:70,height:40});
  expect(dragTextBox(base,'nw',500,500)).toMatchObject({width:8,height:8,x:102,y:42});
 });
});

describe('text source validation',()=>{
 it('accepts valid source and fills the default line height',()=>{
  const {lineHeight:_,...older}=base;
  expect(normalizeTextData(older,500,400)).toEqual(base);
 });
 it('rejects malformed source',()=>{
  for(const bad of [null,'text',{...base,text:5},{...base,x:Number.NaN},{...base,color:'red'},{...base,align:'justify'},{...base,fontFamily:'Arial; } body{'},{...base,text:'x'.repeat(10_001)}])
   expect(normalizeTextData(bad,500,400)).toBeNull();
 });
 it('clamps sizes and positions to safe ranges',()=>{
  const n=normalizeTextData({...base,fontSize:9999,width:1,x:1e9},500,400)!;
  expect(n.fontSize).toBe(512);expect(n.width).toBe(8);expect(n.x).toBe(500+16384);
 });
 it('compares every source field',()=>{
  expect(sameTextData(base,{...base})).toBe(true);
  expect(sameTextData(base,{...base,align:'right'})).toBe(false);
  expect(sameTextData(undefined,undefined)).toBe(true);
  expect(sameTextData(base,undefined)).toBe(false);
 });
 it('names layers from the first non-blank line',()=>{
  expect(textLayerName('\n  Hello world  \nmore')).toBe('Hello world');
  expect(textLayerName('   ')).toBe('Text');
  expect(textLayerName('x'.repeat(40))).toHaveLength(32);
 });
});
