// Private, in-memory drafts survive conversation changes during this visit.
// Do not persist source text to browser storage on a shared device.
export const emptyStudioDraft = () => ({ prompt: "", documentExport: false, revisionArtifact: null });
export const hasStudioDraft = (draft) => Boolean(draft?.prompt || draft?.documentExport || draft?.revisionArtifact);
export function createStudioDrafts() {
  const drafts = new Map();
  return {
    save(id, draft) {
      if (!id) return;
      if (hasStudioDraft(draft)) drafts.set(id, { ...draft });
      else drafts.delete(id);
    },
    read: (id) => ({ ...(drafts.get(id) || emptyStudioDraft()) }),
    hasAny: () => drafts.size > 0,
  };
}
