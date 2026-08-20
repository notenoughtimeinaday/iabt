import React, { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label = "Name",
  initialValue = "",
  placeholder = "",
  submitLabel = "Save",
  onSubmit,
  busy = false,
  maxLength = 100,
}) {
  const [value, setValue] = useState(initialValue);
  const inputId = useId();

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [initialValue, open]);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    await onSubmit(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!busy) onOpenChange(nextOpen);
    }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <label htmlFor={inputId} className="grid gap-2 text-sm font-medium text-slate-800">
            <span>{label}</span>
            <Input
              id={inputId}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              maxLength={maxLength}
              autoFocus
              autoComplete="off"
              disabled={busy}
            />
            <span className="text-xs font-normal text-slate-500">{value.trim().length}/{maxLength} characters</span>
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !value.trim()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Continue",
  onConfirm,
  busy = false,
}) {
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => {
      if (!busy) onOpenChange(nextOpen);
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
