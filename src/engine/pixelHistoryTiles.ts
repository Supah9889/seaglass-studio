/**
 * SG-10: sparse raster undo for brush, pencil and eraser strokes.
 *
 * Before the first write into each 256×256 tile, the recorder copies that tile's original
 * pixels. When the stroke ends, unchanged tiles are discarded and the rest become one history
 * entry. Undo and redo swap tile contents, so each entry stores one copy of only the pixels
 * the stroke could have touched.
 */
export const HISTORY_TILE_SIZE=256;

export type PixelRect={x0:number;y0:number;x1:number;y1:number};
export type HistoryTile={x:number;y:number;width:number;height:number;data:ImageData};
export type TileEntry={kind:'tiles';layerId:string;tiles:HistoryTile[]};
type TileCanvas={width:number;height:number;getContext:(id:'2d',options?:CanvasRenderingContext2DSettings)=>CanvasRenderingContext2D|null};

const context=(canvas:TileCanvas)=>{
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw new Error('Canvas 2D context unavailable for stroke history.');
 return ctx;
};

function makeImageData(data:Uint8ClampedArray,width:number,height:number):ImageData{
 return typeof ImageData==='function'?new ImageData(data as Uint8ClampedArray<ArrayBuffer>,width,height):{data,width,height,colorSpace:'srgb'} as ImageData;
}

/**
 * Read the current pixels of every tile. Canvas readback stalls on the GPU per call, so tiles
 * are read with one getImageData over their bounding box unless that box would be much larger
 * than the tiles themselves (widely scattered tiles), in which case each tile is read alone.
 */
function readTiles(ctx:CanvasRenderingContext2D,tiles:Iterable<HistoryTile>):ImageData[]{
 const list=[...tiles];
 if(list.length<2)return list.map(tile=>ctx.getImageData(tile.x,tile.y,tile.width,tile.height));
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,area=0;
 for(const t of list){x0=Math.min(x0,t.x);y0=Math.min(y0,t.y);x1=Math.max(x1,t.x+t.width);y1=Math.max(y1,t.y+t.height);area+=t.width*t.height;}
 const bw=x1-x0,bh=y1-y0;
 if(bw*bh>area*4)return list.map(tile=>ctx.getImageData(tile.x,tile.y,tile.width,tile.height));
 const box=ctx.getImageData(x0,y0,bw,bh).data;
 return list.map(t=>{
  const data=new Uint8ClampedArray(t.width*t.height*4);
  for(let row=0;row<t.height;row++){const from=((t.y-y0+row)*bw+(t.x-x0))*4;data.set(box.subarray(from,from+t.width*4),row*t.width*4);}
  return makeImageData(data,t.width,t.height);
 });
}

export const tileBytes=(tiles:HistoryTile[])=>tiles.reduce((sum,tile)=>sum+tile.width*tile.height*4,0);

function samePixels(a:Uint8ClampedArray,b:Uint8ClampedArray){
 if(a.length!==b.length)return false;
 for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
 return true;
}

export class StrokeTileRecorder{
 private readonly tiles=new Map<number,HistoryTile>();
 private readonly columns:number;

 constructor(readonly layerId:string,private readonly canvas:TileCanvas,private readonly size=HISTORY_TILE_SIZE){
  this.columns=Math.ceil(canvas.width/size);
 }

 /** Capture every not-yet-captured tile that intersects `rect`. Call before writing into it. */
 touch(rect:PixelRect){
  const {width,height}=this.canvas,size=this.size;
  const x0=Math.max(0,Math.floor(rect.x0)),y0=Math.max(0,Math.floor(rect.y0));
  const x1=Math.min(width,Math.ceil(rect.x1)),y1=Math.min(height,Math.ceil(rect.y1));
  if(x1<=x0||y1<=y0)return;
  const ctx=context(this.canvas);
  for(let ty=Math.floor(y0/size);ty<=Math.floor((y1-1)/size);ty++){
   for(let tx=Math.floor(x0/size);tx<=Math.floor((x1-1)/size);tx++){
    const key=ty*this.columns+tx;
    if(this.tiles.has(key))continue;
    const x=tx*size,y=ty*size,w=Math.min(size,width-x),h=Math.min(size,height-y);
    this.tiles.set(key,{x,y,width:w,height:h,data:ctx.getImageData(x,y,w,h)});
   }
  }
 }

 get capturedBytes(){return tileBytes([...this.tiles.values()]);}

 /** Keep only tiles whose pixels changed; null when the stroke changed nothing. */
 finish():TileEntry|null{
  const ctx=context(this.canvas),changed:HistoryTile[]=[],tiles=[...this.tiles.values()];
  const current=readTiles(ctx,tiles);
  tiles.forEach((tile,i)=>{if(!samePixels(current[i].data,tile.data.data))changed.push(tile);});
  this.tiles.clear();
  return changed.length?{kind:'tiles',layerId:this.layerId,tiles:changed}:null;
 }

 /** Put every captured tile back, undoing a stroke that failed part-way. */
 rollback(){
  const ctx=context(this.canvas);
  for(const tile of this.tiles.values())ctx.putImageData(tile.data,tile.x,tile.y);
  this.tiles.clear();
 }
}

/** Replace each tile's pixels with the stored copy and return the displaced pixels. */
export function swapTiles(canvas:TileCanvas,tiles:HistoryTile[]):HistoryTile[]{
 const ctx=context(canvas);
 // Read everything first so a failure leaves the canvas untouched.
 const current=readTiles(ctx,tiles),displaced=tiles.map((tile,i)=>({...tile,data:current[i]}));
 for(const tile of tiles)ctx.putImageData(tile.data,tile.x,tile.y);
 return displaced;
}

/** Conservative pixel bounds of a stroke segment drawn with the given brush diameter. */
export function segmentBounds(from:{x:number;y:number},to:{x:number;y:number},diameter:number):PixelRect{
 // Half the diameter covers round caps; the extra pixels cover antialiasing and subpixel offsets.
 const margin=Math.ceil(Math.max(1,diameter)/2)+3;
 return {x0:Math.min(from.x,to.x)-margin,y0:Math.min(from.y,to.y)-margin,x1:Math.max(from.x,to.x)+margin,y1:Math.max(from.y,to.y)+margin};
}
