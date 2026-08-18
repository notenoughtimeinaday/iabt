import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Pencil, Trash2, Download, FileJson } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import FileUploader from "@/components/FileUploader";
import AssetList from "@/components/AssetList";
import ProjectForm from "@/components/ProjectForm";

const STATUS_LABELS = {
  idea: "Idea", in_progress: "In Progress", review: "Review", complete: "Complete", archived: "Archived",
};

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [project, setProject] = useState(null);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [savingDesc, setSavingDesc] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [p, as] = await Promise.all([
        base44.entities.Project.get(id),
        base44.entities.Asset.filter({ project_id: id }, "-updated_date", 500),
      ]);
      setProject(p);
      setDescription(p.description || "");
      setAssets(as);
    } catch (err) {
      toast({ title: "Creation not found", variant: "destructive" });
      navigate("/");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleStatusChange = async (status) => {
    try {
      await base44.entities.Project.update(id, { status });
      setProject({ ...project, status });
      toast({ title: "Status updated" });
    } catch (err) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const saveDescription = async () => {
    setSavingDesc(true);
    try {
      await base44.entities.Project.update(id, { description });
      setProject({ ...project, description });
      toast({ title: "Description saved" });
    } catch (err) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingDesc(false);
    }
  };

  const handleEditSubmit = async (data) => {
    try {
      await base44.entities.Project.update(id, data);
      setEditOpen(false);
      load();
      toast({ title: "Creation updated" });
    } catch (err) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteProject = async () => {
    if (!confirm(`Delete "${project.title}" and all its files?`)) return;
    try {
      if (assets.length) await base44.entities.Asset.deleteMany({ project_id: id });
      await base44.entities.Project.delete(id);
      toast({ title: "Creation deleted" });
      navigate("/");
    } catch (err) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteAsset = async (asset) => {
    try {
      await base44.entities.Asset.delete(asset.id);
      setAssets(assets.filter((a) => a.id !== asset.id));
      toast({ title: "File removed" });
    } catch (err) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleUpdateAsset = async (assetId, data) => {
    try {
      await base44.entities.Asset.update(assetId, data);
      setAssets(assets.map((a) => (a.id === assetId ? { ...a, ...data } : a)));
      toast({ title: "Updated" });
    } catch (err) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const exportManifest = () => {
    setExporting(true);
    try {
      const manifest = {
        project: {
          title: project.title,
          description: project.description,
          category: project.category,
          status: project.status,
          tags: project.tags,
          created_date: project.created_date,
          updated_date: project.updated_date,
        },
        files: assets.map((a) => ({
          name: a.name,
          kind: a.kind,
          file_type: a.file_type,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
          notes: a.notes,
          url: a.file_url,
        })),
        exported_at: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.title.replace(/[^a-z0-9]/gi, "_")}_manifest.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Manifest exported" });
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>;
  }

  if (!project) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50/50 to-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Button variant="ghost" size="sm" asChild className="mb-6 -ml-2 text-muted-foreground">
          <Link to="/"><ArrowLeft className="h-4 w-4 mr-1" /> All Creations</Link>
        </Button>

        <header className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color || "#6366f1" }} />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{project.category}</span>
              </div>
              <h1 className="font-heading text-3xl sm:text-4xl font-bold tracking-tight">{project.title}</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
              <Button variant="outline" size="sm" onClick={exportManifest} disabled={exporting}><FileJson className="h-4 w-4 mr-1" /> Export</Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={handleDeleteProject}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <section className="rounded-xl border border-border/60 bg-card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-heading text-lg font-semibold">Description</h2>
                <Button variant="ghost" size="sm" onClick={saveDescription} disabled={savingDesc || description === (project.description || "")}>
                  {savingDesc ? "Saving..." : "Save"}
                </Button>
              </div>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe this creation..." rows={5} />
            </section>

            <section className="rounded-xl border border-border/60 bg-card p-5">
              <h2 className="font-heading text-lg font-semibold mb-4">Files</h2>
              <FileUploader projectId={id} onUploaded={load} />
              <div className="mt-5">
                <AssetList assets={assets} onDelete={handleDeleteAsset} onUpdate={handleUpdateAsset} />
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl border border-border/60 bg-card p-5">
              <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Status</h2>
              <Select value={project.status} onValueChange={handleStatusChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </section>

            {project.tags?.length > 0 && (
              <section className="rounded-xl border border-border/60 bg-card p-5">
                <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Tags</h2>
                <div className="flex flex-wrap gap-2">
                  {project.tags.map((t) => (
                    <span key={t} className="px-2.5 py-1 rounded-full bg-muted text-xs font-medium">{t}</span>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-xl border border-border/60 bg-card p-5">
              <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Quick Export</h2>
              <p className="text-xs text-muted-foreground mb-3">Download a JSON manifest of this creation and all its files — ready for AI engines or backup.</p>
              <Button variant="outline" className="w-full" onClick={exportManifest} disabled={exporting}>
                <Download className="h-4 w-4 mr-2" /> Export Manifest
              </Button>
            </section>
          </aside>
        </div>
      </div>

      <ProjectForm open={editOpen} onOpenChange={setEditOpen} onSubmit={handleEditSubmit} initial={project} />
    </div>
  );
}