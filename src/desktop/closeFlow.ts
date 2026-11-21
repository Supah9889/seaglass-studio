export type CloseChoice = 'save' | 'discard' | 'cancel';
export type CloseDecision = 'close' | 'stay';

export function closeChoiceFromDialogResult(result: string | null): CloseChoice | null {
  if (result === 'Save') return 'save';
  if (result === 'Discard') return 'discard';
  if (result === 'Cancel') return 'cancel';
  return null;
}

/** Resolve an unsaved-work prompt without ever treating a failed or canceled save as success. */
export async function decideUnsavedClose(
  choice: CloseChoice | null,
  actions: { save: () => Promise<boolean>; discard: () => Promise<void> },
): Promise<CloseDecision> {
  if (choice !== 'save' && choice !== 'discard') return 'stay';
  try {
    if (choice === 'discard') {
      await actions.discard();
      return 'close';
    }
    return await actions.save() ? 'close' : 'stay';
  } catch {
    return 'stay';
  }
}
