import {restore,snapshot,type DocumentModel,type Snapshot} from './document';
import {captureLayerStructure,restoreLayerStructure,type LayerStructureSnapshot} from './layers';
import {swapTiles,tileBytes,type TileEntry} from './pixelHistoryTiles';
import {renderTextLayer,type TextData} from './text';

type PixelEntry={kind:'pixels';data:Snapshot[]};
type LayerEntry={kind:'layers';data:LayerStructureSnapshot};
/** SG-19: a text layer's previous source; undefined means the layer was raster (after Rasterize). */
type TextEntry={kind:'text';layerId:string;data:TextData|undefined};
type HistoryEntry=PixelEntry|LayerEntry|TileEntry|TextEntry;
const entryPixelBytes=(entry:HistoryEntry)=>entry.kind==='pixels'?entry.data.reduce((n,layer)=>n+layer.data.data.byteLength,0):entry.kind==='tiles'?tileBytes(entry.tiles):0;
export const HISTORY_MAX_ACTIONS=12;
export const HISTORY_MAX_BYTES=128*1024*1024;

/**
 * Bounded mixed history. Pixel actions normally snapshot only the edited layer;
 * layer operations retain metadata and stable canvas references.
 */
export class HistoryManager{
  private undoStack:HistoryEntry[]=[];
  private redoStack:HistoryEntry[]=[];
  clear(){this.undoStack=[];this.redoStack=[];}
  get undoCount(){return this.undoStack.length;}
  get redoCount(){return this.redoStack.length;}
  get pixelBytes(){return [...this.undoStack,...this.redoStack].reduce((sum,entry)=>sum+entryPixelBytes(entry),0);}
  pushPixels(before:Snapshot[],doc:DocumentModel){this.undoStack.push({kind:'pixels',data:before});this.redoStack=[];this.trim(doc);}
  /** SG-10: a sparse brush/pencil/eraser stroke stored as the original pixels of the tiles it changed. */
  pushTiles(entry:TileEntry,doc:DocumentModel){this.undoStack.push(entry);this.redoStack=[];this.trim(doc);}
  /** Records a text layer's source before an edit, move, resize, style change or rasterize. */
  pushText(layerId:string,before:TextData|undefined,doc:DocumentModel){this.undoStack.push({kind:'text',layerId,data:before?{...before}:undefined});this.redoStack=[];this.trim(doc);}
  pushLayerState(before:LayerStructureSnapshot,doc:DocumentModel){this.undoStack.push({kind:'layers',data:before});this.redoStack=[];this.trim(doc);}
  undo(doc:DocumentModel){return this.step(doc,this.undoStack,this.redoStack);}
  redo(doc:DocumentModel){return this.step(doc,this.redoStack,this.undoStack);}
  /** Apply the newest entry of `from` and record its reversal on `to`. */
  private step(doc:DocumentModel,from:HistoryEntry[],to:HistoryEntry[]):boolean{
    const entry=from[from.length-1];if(!entry)return false;
    let reverse:HistoryEntry;
    if(entry.kind==='tiles'){
      const layer=doc.layers.find(item=>item.id===entry.layerId);
      // A stroke whose layer no longer exists cannot be reversed; discard it and continue.
      if(!layer){from.pop();return this.step(doc,from,to);}
      reverse={kind:'tiles',layerId:entry.layerId,tiles:swapTiles(layer.canvas,entry.tiles)};
    }else if(entry.kind==='text'){
      const layer=doc.layers.find(item=>item.id===entry.layerId);
      if(!layer){from.pop();return this.step(doc,from,to);}
      // Re-render before swapping so a failure leaves the layer and both stacks unchanged.
      if(entry.data)renderTextLayer(layer.canvas,entry.data);
      reverse={kind:'text',layerId:entry.layerId,data:layer.text};
      layer.text=entry.data?{...entry.data}:undefined;
    }else if(entry.kind==='pixels'){
      reverse={kind:'pixels',data:snapshot(doc,entry.data.map(item=>item.id))};
      restore(doc,entry.data,true);
    }else{
      reverse={kind:'layers',data:captureLayerStructure(doc)};
      restoreLayerStructure(doc,entry.data);
    }
    from.pop();to.push(reverse);this.trim(doc);return true;
  }
  private trim(doc:DocumentModel){
    const all=()=>[...this.undoStack,...this.redoStack];
    const storedBytes=()=>{const entries=all(),pixel=entries.reduce((sum,e)=>sum+entryPixelBytes(e),0),current=new Set(doc.layers.map(layer=>layer.canvas)),held=new Set<HTMLCanvasElement>();for(const entry of entries)if(entry.kind==='layers')for(const state of entry.data.layers)if(!current.has(state.layer.canvas))held.add(state.layer.canvas);return pixel+Array.from(held).reduce((sum,canvas)=>sum+canvas.width*canvas.height*4,0);};
    while(this.undoStack.length+this.redoStack.length>HISTORY_MAX_ACTIONS||storedBytes()>HISTORY_MAX_BYTES){if(this.undoStack.length)this.undoStack.shift();else if(this.redoStack.length)this.redoStack.shift();else break;}
  }
}
