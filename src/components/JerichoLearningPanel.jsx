import { useCallback, useRef, useState } from "react";
import { iabtClient } from "@/api/iabtClient";
import { Button } from "@/components/ui/button";

const categories = [
  ["incorrect_output", "The result was incorrect"],
  ["missing_requirement", "A requirement was missing"],
  ["format_mismatch", "The format was wrong"],
  ["unreadable_artifact", "I could not read the output"],
  ["duplicate_work", "Work was repeated"],
  ["account_access", "Account access interrupted the work"]
];
const statusLabels = {
  candidate: "Correction awaiting acceptance",
  observed: "Recorded outcome",
  verified_delivery: "Artifact delivery verified",
  accepted_by_owner: "Accepted by you",
  pending: "Pending", verified: "Verified", attested: "Confirmed by you"
};
const title = (value) => categories.find(([id]) => id === value)?.[1] || String(value || "Outcome").replaceAll("_", " ");
const fieldClass = "w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100";

export default function JerichoLearningPanel() {
  const [snapshot, setSnapshot] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [jobId, setJobId] = useState("");
  const [category, setCategory] = useState("missing_requirement");
  const [resolution, setResolution] = useState({});
  const pendingRequest = useRef(null);
  const reload = useCallback(async () => {
    const [learning, currentJobs] = await Promise.all([
      iabtClient.functions.invoke("get-jericho-learning"),
      iabtClient.entities.GenerationJob.list("-created_date", 50)
    ]);
    setSnapshot(learning.data);
    setJobs(currentJobs);
  }, []);
  const run = async (action, success) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await reload();
      if (success) setNotice(success);
    } catch (failure) {
      setError(failure?.message || "Jericho could not update this record. Refresh to check its status before trying again.");
    } finally {
      setBusy(false);
    }
  };
  const addCorrection = async (event) => {
    event.preventDefault();
    if (!jobId) return;
    const key = `${jobId}:${category}`;
    if (pendingRequest.current?.key !== key) pendingRequest.current = { key, id: crypto.randomUUID() };
    await run(async () => {
      await iabtClient.functions.invoke("record-jericho-correction", {
        job_id: jobId, category, request_id: pendingRequest.current.id
      });
      pendingRequest.current = null;
    }, "Your correction is saved. It remains a candidate until you accept an evidenced result.");
  };

  return (
    <details className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-slate-100" onToggle={(event) => {
      if (event.currentTarget.open && !snapshot && !busy) void run(async () => {});
    }}>
      <summary className="cursor-pointer font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">Jericho learning &amp; teamwork</summary>
      <div className="mt-4 space-y-4" aria-busy={busy}>
        <p className="text-sm text-slate-300">Jericho keeps evidence from your jobs and corrections to guide future work. A delivered file and a correct result are separate checks.</p>
        <div role="status" aria-live="polite" className="text-sm text-cyan-200">{busy ? "Updating learning records…" : notice}</div>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => {})}>Refresh learning</Button>
        {snapshot && <>
          <details className="text-sm">
            <summary className="cursor-pointer text-cyan-200">What Jericho has been taught</summary>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-slate-300">
              {(snapshot.curriculum?.rules || []).map((rule) => <li key={rule.id}>{rule.instruction}</li>)}
            </ul>
            <p className="mt-2 text-xs text-slate-400">Curriculum {snapshot.curriculum?.version}. Learning records do not change model weights or grant permissions.</p>
          </details>
          <form onSubmit={addCorrection} className="space-y-3 border-t border-slate-800 pt-4">
            <h3 className="font-medium">Teach Jericho from a correction</h3>
            <label className="block text-sm">Related job
              <select value={jobId} onChange={(event) => setJobId(event.target.value)} className={`${fieldClass} mt-1`} required disabled={busy}>
                <option value="">Choose one of your recent jobs</option>
                {jobs.map((job) => <option key={job.id} value={job.id}>{job.job_type || job.intent || "Job"} · {job.status} · {job.id.slice(0, 8)}</option>)}
              </select>
            </label>
            <label className="block text-sm">What needs improvement
              <select value={category} onChange={(event) => setCategory(event.target.value)} className={`${fieldClass} mt-1`} disabled={busy}>
                {categories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <Button type="submit" disabled={busy || !jobId}>Save correction</Button>
          </form>
          <section className="space-y-3 border-t border-slate-800 pt-4" aria-label="Recent learning records">
            <h3 className="font-medium">Recent evidence and corrections</h3>
            {!snapshot.lessons?.length && <p className="text-sm text-slate-400">New completed jobs and your explicit corrections will appear here.</p>}
            {(snapshot.lessons || []).slice(0, 8).map((lesson) => {
              const selection = resolution[lesson.id] || { jobId: "", accepted: false };
              const patchSelection = (patch) => setResolution((current) => ({ ...current, [lesson.id]: { ...selection, ...patch } }));
              return <article key={lesson.id} className="space-y-2 rounded-xl border border-slate-800 p-3">
                <p className="text-sm font-medium">{title(lesson.category)}</p>
                <p className="text-xs text-slate-400">{statusLabels[lesson.status] || lesson.status} · Job {lesson.source?.job_id?.slice(0, 8)}</p>
                <p className="text-xs text-slate-400">{lesson.evidence?.length || 0} artifact record(s). {lesson.status === "accepted_by_owner" ? "You confirmed the result; automated functional verification remains separate." : "Functional correctness is not established by delivery alone."}</p>
                {lesson.kind === "user_correction" && lesson.status === "candidate" && <div className="space-y-2">
                  <label className="block text-sm">Result that resolves this correction
                    <select value={selection.jobId} onChange={(event) => patchSelection({ jobId: event.target.value, accepted: false })} className={`${fieldClass} mt-1`} disabled={busy}>
                      <option value="">Choose a completed job</option>
                      {jobs.filter((job) => job.status === "succeeded" && job.job_type === lesson.job_type).map((job) => <option key={job.id} value={job.id}>{job.job_type || "Job"} · {job.id.slice(0, 8)}</option>)}
                    </select>
                  </label>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selection.accepted} disabled={busy || !selection.jobId} onChange={(event) => patchSelection({ accepted: event.target.checked })} className="mt-1" />I reviewed this result and confirm it resolves my correction.</label>
                  <Button type="button" variant="outline" disabled={busy || !selection.jobId || !selection.accepted} onClick={() => void run(() => iabtClient.functions.invoke("resolve-jericho-correction", { lesson_id: lesson.id, job_id: selection.jobId, accepted: true }), "Your acceptance and artifact evidence are recorded.")}>Record my acceptance</Button>
                </div>}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => iabtClient.functions.invoke("propose-jericho-improvement", { lesson_id: lesson.id }), "A proposal and its remaining verification checkpoints are saved.")}>Prepare improvement proposal</Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => iabtClient.functions.invoke("withdraw-jericho-lesson", { lesson_id: lesson.id }), "This lesson and its proposals are excluded from future learning retrieval.")}>Stop using this lesson</Button>
                </div>
              </article>;
            })}
            {(snapshot.lessons?.length || 0) > 8 && <p className="text-xs text-slate-400">Showing the 8 most recent of {snapshot.lessons.length} retrieved learning records.</p>}
          </section>
          <section className="space-y-3 border-t border-slate-800 pt-4" aria-label="Improvement proposals">
            <h3 className="font-medium">Improvement checkpoints</h3>
            {!snapshot.proposals?.length && <p className="text-sm text-slate-400">Prepare a proposal from a lesson to keep its evidence and remaining checks together.</p>}
            {(snapshot.proposals || []).slice(0, 8).map((proposal) => <article key={proposal.id} className="rounded-xl border border-slate-800 p-3 text-sm">
              <p className="font-medium">{title(proposal.category)}</p>
              <ul className="mt-2 space-y-1 text-slate-300">{proposal.checkpoints.map((checkpoint) => <li key={checkpoint.id}>{title(checkpoint.id)}: {statusLabels[checkpoint.status] || checkpoint.status}</li>)}</ul>
              <p className="mt-2 text-xs text-slate-400">This proposal records work to verify. It does not change code or deploy a release.</p>
            </article>)}
          </section>
        </>}
      </div>
    </details>
  );
}
