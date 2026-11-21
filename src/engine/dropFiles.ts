import {isSupportedImageFile} from './imageImport';

export type DroppedFileKind='project'|'image'|'unsupported';
/** Classifies by explicit project extension, then supported image MIME/extension. */
export function classifyDroppedFile(file:Pick<File,'name'|'type'>):DroppedFileKind{
  if(file.name.toLowerCase().endsWith('.seaglass'))return'project';
  return isSupportedImageFile(file)?'image':'unsupported';
}

/** Shared guard used by project and image replacement workflows. */
export function confirmDiscardUnsaved(hasUnsavedWork:boolean,confirm:()=>boolean){return!hasUnsavedWork||confirm();}
