import {layerAdmissionMessage,canAddDocumentLayer,createDocument,isValidDocumentSize,makeLayer,type DocumentModel,type Layer,DOCUMENT_LAYER_LIMIT_MESSAGE} from './document';

const MIME_TYPES=new Set(['image/png','image/jpeg','image/webp']);
export function isSupportedImageFile(file:Pick<File,'name'|'type'>){
  const extension=file.name.toLowerCase().split('.').pop(),byName=extension==='png'||extension==='jpg'||extension==='jpeg'||extension==='webp',mime=file.type.toLowerCase();
  return mime?MIME_TYPES.has(mime):byName;
}
export function imageLayerName(name:string){return name.replace(/\.(png|jpe?g|webp)$/i,'').trim()||'Imported image';}

async function decode(file:File){
  if(!isSupportedImageFile(file))throw new Error('Choose a PNG, JPEG, or WebP image.');
  let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(file);}catch{throw new Error('This image could not be decoded. It may be damaged or unsupported.');}
  if(!isValidDocumentSize(bitmap.width,bitmap.height)){bitmap.close();throw new RangeError(`Image dimensions (${bitmap.width} x ${bitmap.height}) exceed the 4096 px / 16.7 megapixel limit. The image was not resized.`);}
  return bitmap;
}

/** Decodes locally and retains the bitmap's native pixels and alpha. */
export async function openImageAsDocument(file:File):Promise<DocumentModel>{
  const bitmap=await decode(file);try{const doc=createDocument(bitmap.width,bitmap.height,imageLayerName(file.name));doc.layers[0].canvas.getContext('2d')!.drawImage(bitmap,0,0);return doc;}finally{bitmap.close();}
}

/** Imports at native scale, centered and clipped by the current document bounds. */
export async function importImageAsLayer(file:File,doc:DocumentModel):Promise<{layer:Layer;clipped:boolean}>{
  {const blocked=layerAdmissionMessage(doc);if(blocked)throw new RangeError(blocked);}
  const bitmap=await decode(file);try{{const blocked=layerAdmissionMessage(doc);if(blocked)throw new RangeError(blocked);}const base=imageLayerName(file.name);let name=base,n=2;while(doc.layers.some(layer=>layer.name===name))name=base+' '+n++;const layer=makeLayer(doc.width,doc.height,name),x=Math.round((doc.width-bitmap.width)/2),y=Math.round((doc.height-bitmap.height)/2);layer.canvas.getContext('2d')!.drawImage(bitmap,x,y);return{layer,clipped:bitmap.width>doc.width||bitmap.height>doc.height};}finally{bitmap.close();}
}

/** SeaGlass selection clipboard has priority over browser image paste. */
export function clipboardPastePriority(hasInternalSelection:boolean):'selection'|'system-image'{return hasInternalSelection?'selection':'system-image';}
