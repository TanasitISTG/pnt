import { Check, Edit, RotateCcw, Trash2, X } from "lucide-react";

import { type TermCategory, type TermStatus } from "@/lib/glossary.schemas";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface EditState {
  termId: string;
  source: string;
  target: string;
  category: "character" | "place" | "skill" | "item" | "other";
  note: string;
  originalTarget: string;
}

export interface GlossaryTerm {
  id: string;
  source: string;
  target: string;
  category: TermCategory;
  note: string | null;
  status: TermStatus;
}

const CATEGORY_COLORS: Record<string, string> = {
  character: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  place: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  skill: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  item: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  other: "bg-muted text-muted-foreground border-border",
};

export const EDIT_CATEGORY_ITEMS: Record<string, string> = {
  character: "Character",
  place: "Place",
  skill: "Skill",
  item: "Item",
  other: "Other",
};

export function CategoryBadge({ category }: { category: string }) {
  const colorClass = CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
  return (
    <Badge variant="outline" className={`capitalize font-medium text-xs ${colorClass}`}>
      {category}
    </Badge>
  );
}

interface GlossaryTableProps {
  terms: GlossaryTerm[];
  editState: EditState | null;
  setEditState: React.Dispatch<React.SetStateAction<EditState | null>>;
  editErrors: Record<string, string>;
  setEditErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onEdit: (term: GlossaryTerm) => void;
  onSaveEdit: () => void;
  onDelete: (termId: string) => void;
  onApprove: (termId: string) => void;
  savingEdit: boolean;
  previewingReplace: boolean;
  approvingTerm: boolean;
}

export function GlossaryTable({
  terms,
  editState,
  setEditState,
  editErrors,
  setEditErrors,
  onEdit,
  onSaveEdit,
  onDelete,
  onApprove,
  savingEdit,
  previewingReplace,
  approvingTerm,
}: GlossaryTableProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/3">Source Term</TableHead>
            <TableHead className="w-1/3">Target Translation</TableHead>
            <TableHead className="w-28">Category</TableHead>
            <TableHead>Note</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {terms.map((term) => {
            const isEditing = editState?.termId === term.id;

            if (isEditing) {
              return (
                <TableRow key={term.id} className="bg-muted/40">
                  <TableCell>
                    <Input
                      value={editState.source}
                      onChange={(e) => setEditState((s) => s && { ...s, source: e.target.value })}
                      placeholder="Source"
                      size={1}
                    />
                    {editErrors.source && (
                      <span className="text-caption text-destructive block mt-1">
                        {editErrors.source}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={editState.target}
                      onChange={(e) => setEditState((s) => s && { ...s, target: e.target.value })}
                      placeholder="Target"
                      size={1}
                    />
                    {editErrors.target && (
                      <span className="text-caption text-destructive block mt-1">
                        {editErrors.target}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={editState.category}
                      onValueChange={(val) =>
                        setEditState((s) => s && { ...s, category: val as TermCategory })
                      }
                      items={EDIT_CATEGORY_ITEMS}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="character">Character</SelectItem>
                        <SelectItem value="place">Place</SelectItem>
                        <SelectItem value="skill">Skill</SelectItem>
                        <SelectItem value="item">Item</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={editState.note}
                      onChange={(e) => setEditState((s) => s && { ...s, note: e.target.value })}
                      placeholder="Note (optional)"
                      size={1}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-emerald-600 dark:text-emerald-400"
                        onClick={onSaveEdit}
                        disabled={savingEdit || previewingReplace}
                        aria-label="Save edit"
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground"
                        onClick={() => {
                          setEditState(null);
                          setEditErrors({});
                        }}
                        aria-label="Cancel edit"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            }

            return (
              <TableRow key={term.id}>
                <TableCell className="font-semibold text-foreground">{term.source}</TableCell>
                <TableCell className="font-medium text-foreground">{term.target}</TableCell>
                <TableCell>
                  <CategoryBadge category={term.category} />
                </TableCell>
                <TableCell className="text-caption text-muted-foreground">
                  {term.note || "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {term.status === "rejected" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-500/10"
                        onClick={() => onApprove(term.id)}
                        disabled={approvingTerm}
                        aria-label="Restore term"
                        title="Restore term"
                      >
                        <RotateCcw className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => onEdit(term)}
                      aria-label="Edit term"
                    >
                      <Edit className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => onDelete(term.id)}
                      aria-label="Delete term"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
