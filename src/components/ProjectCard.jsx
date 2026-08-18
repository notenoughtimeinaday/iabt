import React from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MoreVertical, Trash2, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const STATUS_LABELS = {
  idea: "Idea",
  in_progress: "In Progress",
  review: "Review",
  complete: "Complete",
  archived: "Archived",
};

const STATUS_COLORS = {
  idea: "bg-slate-100 text-slate-600",
  in_progress: "bg-blue-100 text-blue-700",
  review: "bg-amber-100 text-amber-700",
  complete: "bg-emerald-100 text-emerald-700",
  archived: "bg-slate-100 text-slate-400",
};

export default function ProjectCard({ project, assetCount, onEdit, onDelete }) {
  return (
    <Card className="group relative overflow-hidden border-border/60 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
      <div className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundColor: project.color || "#6366f1" }} />
      <div className="p-5 pt-6">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/projects/${project.id}`} className="flex-1 min-w-0">
            <h3 className="font-heading text-lg font-semibold tracking-tight truncate group-hover:text-foreground/80">
              {project.title}
            </h3>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(project)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(project)} className="text-destructive"><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Link to={`/projects/${project.id}`}>
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
            {project.description || "No description yet."}
          </p>
        </Link>
        <div className="mt-4 flex items-center justify-between">
          <Badge variant="secondary" className={`font-medium ${STATUS_COLORS[project.status] || STATUS_COLORS.idea}`}>
            {STATUS_LABELS[project.status] || "Idea"}
          </Badge>
          <span className="text-xs text-muted-foreground">{assetCount} file{assetCount === 1 ? "" : "s"}</span>
        </div>
      </div>
    </Card>
  );
}