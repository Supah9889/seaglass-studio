import {describe,expect,it,vi} from 'vitest';
import {classifyDroppedFile,confirmDiscardUnsaved} from './dropFiles';

describe('file drop routing and replacement guard',()=>{
  it('routes native project files, supported images, and unsupported files distinctly',()=>{
    expect(classifyDroppedFile({name:'Artwork.SEAGLASS',type:''})).toBe('project');
    expect(classifyDroppedFile({name:'portrait.png',type:'image/png'})).toBe('image');
    expect(classifyDroppedFile({name:'movie.gif',type:'image/gif'})).toBe('unsupported');
  });
  it('uses the existing unsaved-work confirmation contract and cancels safely',()=>{
    const ask=vi.fn(()=>false);expect(confirmDiscardUnsaved(false,ask)).toBe(true);expect(ask).not.toHaveBeenCalled();expect(confirmDiscardUnsaved(true,ask)).toBe(false);expect(ask).toHaveBeenCalledOnce();expect(confirmDiscardUnsaved(true,()=>true)).toBe(true);
  });
});
