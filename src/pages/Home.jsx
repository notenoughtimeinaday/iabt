import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Sparkles, FolderOpen } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import ProjectCard from "@/components/ProjectCard";
import ProjectForm from "@/components/ProjectForm";

export default function Home() {
  const [projects, setProjects] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [ps, as] = await Promise.all([
        base44.entities.Project.list("-updated_date", 200),
        base44.entities.Asset.list("-updated_date", 500),
      ]);
      setProjects(ps);
      setAssets(as);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const assetCountByProject = useMemo(() => {
    const map = {};
    for (const a of assets) map[a.project_id] = (map[a.project_id] || 0) + 1;
    return map;
  }, [assets]);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      const matchesQuery = p.title.toLowerCase().includes(query.toLowerCase()) || (p.description || "").toLowerCase().includes(query.toLowerCase());
      const matchesStatus = statusFilter === "all" || p.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [projects, query, statusFilter]);

  const handleSubmit = async (data) => {
    try {
      if (editing) {
        await base44.entities.Project.update(editing.id, data);
        toast({ title: "Creation updated" });
      } else {
        await base44.entities.Project.create(data);
        toast({ title: "Creation created" });
      }
      setEditing(null);
      load();
    } catch (err) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (project) => {
    if (!confirm(`Delete "${project.title}" and all its files?`)) return;
    try {
      const projectAssets = assets.filter((a) => a.project_id === project.id);
      if (projectAssets.length) await base44.entities.Asset.deleteMany({ project_id: project.id });
      await base44.entities.Project.delete(project.id);
      toast({ title: "Creation deleted" });
      load();
    } catch (err) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const stats = useMemo(() => ({
    total: projects.length,
    active: projects.filter((p) => p.status === "in_progress").length,
    complete: projects.filter((p) => p.status === "complete").length,
    files: assets.length,
  }), [projects, assets]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50/50 to-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
          <div>
            <div className="flex items-center gap-2 text-primary mb-2">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Creative Workspace</span>
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl font-bold tracking-tight">My Creations</h1>
            <p className="text-muted-foreground mt-2">Organize, develop, and export your creative work — all in one place.</p>
          </div>
          <Button onClick={() => { setEditing(null); setFormOpen(true); }} size="lg" className="shadow-sm">
            <Plus className="h-4 w-4 mr-2" /> New Creation
          </Button>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          {[
            { label: "Total Creations", value: stats.total, icon: FolderOpen },
            { label: "In Progress", value: stats.active, icon: Sparkles },
            { label: "Completed", value: stats.complete, icon: Sparkles },
            { label: "Files Stored", value: stats.files, icon: FolderOpen },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border/60 bg-card p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</p>
              <p className="text-2xl font-heading font-semibold mt-1">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search creations..." value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-48"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="idea">Idea</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="review">Review</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-40 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-heading text-lg font-semibold">{query || statusFilter !== "all" ? "No matches found" : "Start your first creation"}</h3>
            <p className="text-muted-foreground text-sm mt-1 mb-4">{query || statusFilter !== "all" ? "Try a different search or filter." : "Create a project to organize your files and ideas."}</p>
            {!query && statusFilter === "all" && (
              <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="h-4 w-4 mr-2" /> New Creation</Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((p) => (
              <ProjectCard key={p.id} project={p} assetCount={assetCountByProject[p.id] || 0} onEdit={(proj) => { setEditing(proj); setFormOpen(true); }} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      <ProjectForm open={formOpen} onOpenChange={setFormOpen} onSubmit={handleSubmit} initial={editing} />
    </div>
  );
}