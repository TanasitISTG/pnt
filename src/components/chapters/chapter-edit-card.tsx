import type { Dispatch, SetStateAction } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import type { EditState } from "@/components/chapters/use-chapter-edit";

export interface ChapterEditCardProps {
  chapterTitle: string;
  editState: EditState;
  setEditState: Dispatch<SetStateAction<EditState | null>>;
  editErrors: Record<string, string>;
  setEditErrors: Dispatch<SetStateAction<Record<string, string>>>;
  savingEdit: boolean;
  onSave: () => void;
  onClose: () => void;
}

export function ChapterEditCard({
  chapterTitle,
  editState,
  setEditState,
  editErrors,
  setEditErrors,
  savingEdit,
  onSave,
  onClose,
}: ChapterEditCardProps) {
  return (
    <Card className="border-foreground/20">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-card-title font-semibold text-foreground">Editing: {chapterTitle}</h3>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onClose}
            aria-label="Close editor"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1.5 sm:col-span-1">
              <Label htmlFor="edit-chapNumber">Number *</Label>
              <Input
                id="edit-chapNumber"
                type="number"
                step="0.01"
                min="0"
                value={editState.number}
                onChange={(e) => {
                  setEditErrors((err) => ({ ...err, number: "" }));
                  setEditState((s) => s && { ...s, number: e.target.value });
                }}
              />
              {editErrors.number && (
                <span className="text-caption text-destructive">{editErrors.number}</span>
              )}
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-3">
              <Label htmlFor="edit-chapTitle">Title *</Label>
              <Input
                id="edit-chapTitle"
                value={editState.title}
                onChange={(e) => {
                  setEditErrors((err) => ({ ...err, title: "" }));
                  setEditState((s) => s && { ...s, title: e.target.value });
                }}
              />
              {editErrors.title && (
                <span className="text-caption text-destructive">{editErrors.title}</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-baseline">
              <Label htmlFor="edit-chapContent">Raw Content</Label>
              {!editState.contentLoading && (
                <span className="text-caption text-muted-foreground">
                  {editState.rawContent.length.toLocaleString()} characters
                </span>
              )}
            </div>
            {editState.contentLoading ? (
              <div className="h-36 rounded-md border border-border bg-muted animate-pulse" />
            ) : (
              <Textarea
                id="edit-chapContent"
                value={editState.rawContent}
                onChange={(e) => {
                  setEditErrors((err) => ({ ...err, rawContent: "" }));
                  setEditState((s) => s && { ...s, rawContent: e.target.value });
                }}
                rows={10}
              />
            )}
            {editErrors.rawContent && (
              <span className="text-caption text-destructive">{editErrors.rawContent}</span>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <Button variant="outline" onClick={onClose} disabled={savingEdit}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={savingEdit || editState.contentLoading}>
              <Check className="size-4" />
              {savingEdit ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
