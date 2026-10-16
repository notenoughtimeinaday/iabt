// Keep uploaded object references across retries, including failed Asset writes.
export async function uploadBatch(entries, { upload, createAsset, onUploaded }) {
  const completed = [];
  let pending = [];
  let error = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    try {
      if (!entry.uploaded) entry.uploaded = await upload(entry.file);
      if (!entry.asset) entry.asset = await createAsset(entry.file, entry.uploaded);
      completed.push(entry);
    } catch (failure) {
      error = failure;
      pending = entries.slice(index);
      break;
    }
  }
  try {
    if (completed.length) await onUploaded?.(completed.map((entry) => entry.asset));
  } catch (failure) {
    // The server writes succeeded, but the parent has not acknowledged them.
    // Retrying these entries only repeats synchronization, never upload/create.
    pending = [...completed, ...pending];
    error = failure;
  }
  return { uploaded: completed.map((entry) => entry.asset), pending, error };
}

// A synchronous planning guard, also used before React has rerendered. Reject
// stale polls instead of replacing files saved while those polls were running.
export function createAttachmentTracker() {
  let epoch = 0;
  let sequence = 0;
  let state = { scopeId: "", conversationId: "", rows: [], ready: false, loading: false, error: "", busy: false, pending: 0, revision: 0 };
  const matches = (scopeId, conversationId) => state.scopeId === scopeId && state.conversationId === conversationId;
  return {
    snapshot: () => ({ ...state, rows: [...state.rows] }),
    switchScope(scopeId, conversationId, rows = null) {
      epoch += 1;
      state = { scopeId, conversationId, rows: rows || [], ready: rows !== null, loading: false, error: "", busy: false, pending: 0, revision: 0 };
    },
    beginLoad(scopeId, conversationId) {
      // Conversation subscriptions and the production desk poll can overlap.
      // A new poll must not supersede a still-running read on a slow connection.
      if (!matches(scopeId, conversationId) || state.loading) return null;
      state.loading = true;
      return { epoch, sequence: ++sequence, revision: state.revision };
    },
    finishLoad(token, rows, error = "") {
      if (!token || token.epoch !== epoch || token.sequence !== sequence) return false;
      state.loading = false;
      if (token.revision !== state.revision) return false;
      if (error) {
        state.ready = false;
        state.error = error;
      } else {
        state.rows = rows;
        state.ready = true;
        state.error = "";
      }
      return true;
    },
    mergeUploaded(scopeId, conversationId, rows) {
      if (!matches(scopeId, conversationId)) return false;
      state.rows = [...new Map([...rows, ...state.rows].map((row) => [row.id, row])).values()];
      state.revision += 1;
      return true;
    },
    remove(scopeId, conversationId, id) {
      if (!matches(scopeId, conversationId)) return false;
      state.rows = state.rows.filter((row) => row.id !== id);
      state.revision += 1;
      return true;
    },
    setUploadStatus(scopeId, conversationId, { busy, pending }) {
      if (!matches(scopeId, conversationId)) return false;
      state.busy = busy;
      state.pending = pending;
      return true;
    },
    planningError() {
      if (state.busy) return "Wait for your attachments to finish uploading and saving before sending your request.";
      if (state.pending) return "Some attachments did not finish saving. Retry them or discard the unfinished attachments before sending your request.";
      if (state.error) return "Your saved attachments could not be checked. Refresh the attachment list before sending your request.";
      // Once verified, retain the saved snapshot during background refreshes.
      // A failed refresh invalidates ready above and still blocks submission.
      if (!state.ready) return "Wait for your saved attachments to finish loading before sending your request.";
      return "";
    }
  };
}
