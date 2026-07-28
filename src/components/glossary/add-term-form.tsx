import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EDIT_CATEGORY_ITEMS } from "@/components/glossary/category-items";
import type { TermCategory } from "@/lib/glossary.schemas";

interface AddTermFormProps {
  newSource: string;
  setNewSource: (value: string) => void;
  newTarget: string;
  setNewTarget: (value: string) => void;
  newCategory: TermCategory;
  setNewCategory: (value: TermCategory) => void;
  newNote: string;
  setNewNote: (value: string) => void;
  addErrors: Record<string, string>;
  setAddErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  addingTerm: boolean;
  onSubmit: (e: React.SyntheticEvent) => void;
}

export function AddTermForm({
  newSource,
  setNewSource,
  newTarget,
  setNewTarget,
  newCategory,
  setNewCategory,
  newNote,
  setNewNote,
  addErrors,
  setAddErrors,
  addingTerm,
  onSubmit,
}: AddTermFormProps) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sub font-semibold text-foreground tracking-tight">Add Glossary Term</h2>
      <Card className="max-w-3xl">
        <CardContent className="p-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="source">Source Term *</Label>
                <Input
                  id="source"
                  placeholder="e.g. Lin Fan"
                  value={newSource}
                  onChange={(e) => {
                    setAddErrors((err) => ({ ...err, source: "" }));
                    setNewSource(e.target.value);
                  }}
                  required
                />
                {addErrors.source && (
                  <span className="text-caption text-destructive">{addErrors.source}</span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="target">Target Translation *</Label>
                <Input
                  id="target"
                  placeholder="e.g. หลินฟาน"
                  value={newTarget}
                  onChange={(e) => {
                    setAddErrors((err) => ({ ...err, target: "" }));
                    setNewTarget(e.target.value);
                  }}
                  required
                />
                {addErrors.target && (
                  <span className="text-caption text-destructive">{addErrors.target}</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={newCategory}
                  onValueChange={(val) => setNewCategory(val as TermCategory)}
                  items={EDIT_CATEGORY_ITEMS}
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="character">Character</SelectItem>
                    <SelectItem value="place">Place</SelectItem>
                    <SelectItem value="skill">Skill</SelectItem>
                    <SelectItem value="item">Item</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="note">Note (Optional)</Label>
                <Input
                  id="note"
                  placeholder="e.g. Main protagonist, Sect disciple"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="submit" disabled={addingTerm}>
                <Plus className="size-4" />
                {addingTerm ? "Adding..." : "Add Term"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
