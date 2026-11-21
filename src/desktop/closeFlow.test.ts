import {describe,expect,it,vi} from 'vitest';
import {closeChoiceFromDialogResult,decideUnsavedClose} from './closeFlow';

describe('unsaved desktop close decision',()=>{
  it('maps the actual custom dialog button labels to close choices',()=>{
    expect(closeChoiceFromDialogResult('Save')).toBe('save');
    expect(closeChoiceFromDialogResult('Discard')).toBe('discard');
    expect(closeChoiceFromDialogResult('Cancel')).toBe('cancel');
    expect(closeChoiceFromDialogResult(null)).toBeNull();
  });

  it('allows discard without saving',async()=>{
    const save=vi.fn(async()=>true);
    const discard=vi.fn(async()=>{});
    await expect(decideUnsavedClose('discard',{save,discard})).resolves.toBe('close');
    expect(save).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledOnce();
  });

  it('keeps the window open for cancel',async()=>{
    const save=vi.fn(async()=>true);
    await expect(decideUnsavedClose('cancel',{save,discard:async()=>{}})).resolves.toBe('stay');
    expect(save).not.toHaveBeenCalled();
  });

  it('closes only after a successful save',async()=>{
    const save=vi.fn(async()=>true);
    await expect(decideUnsavedClose('save',{save,discard:async()=>{}})).resolves.toBe('close');
    expect(save).toHaveBeenCalledOnce();
  });

  it('stays open when Save As is canceled or saving fails',async()=>{
    await expect(decideUnsavedClose('save',{save:async()=>false,discard:async()=>{}})).resolves.toBe('stay');
    await expect(decideUnsavedClose('save',{save:async()=>{throw new Error('disk full')},discard:async()=>{}})).resolves.toBe('stay');
  });

  it('keeps the window open if recovery cannot be cleared on discard',async()=>{
    await expect(decideUnsavedClose('discard',{save:async()=>true,discard:async()=>{throw new Error('storage unavailable')}})).resolves.toBe('stay');
  });

  it('keeps recovery and stays open when Save wrote only an earlier revision',async()=>{
    const discard=vi.fn(async()=>{});
    // saveProject reports false when the picker finished after newer edits.
    await expect(decideUnsavedClose('save',{save:async()=>false,discard})).resolves.toBe('stay');
    expect(discard).not.toHaveBeenCalled();
  });

  it('treats a dismissed prompt as cancel',async()=>{
    await expect(decideUnsavedClose(null,{save:async()=>true,discard:async()=>{}})).resolves.toBe('stay');
  });
});
