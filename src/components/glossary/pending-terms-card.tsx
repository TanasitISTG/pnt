import { Check, CheckCheck, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CategoryBadge, type GlossaryTerm } from "@/components/glossary/glossary-table";

interface PendingTermsCardProps {
  terms: GlossaryTerm[];
  approvingAll: boolean;
  rejectingAll: boolean;
  approvingTerm: boolean;
  rejectingTerm: boolean;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onApprove: (termId: string) => void;
  onReject: (termId: string) => void;
}

export function PendingTermsCard({
  terms,
  approvingAll,
  rejectingAll,
  approvingTerm,
  rejectingTerm,
  onApproveAll,
  onRejectAll,
  onApprove,
  onReject,
}: PendingTermsCardProps) {
  if (terms.length === 0) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10">
      <CardContent className="p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-amber-500" />
            <h2 className="text-card-title font-semibold text-foreground">
              AI Auto-Suggested Terms ({terms.length})
            </h2>
          </div>
          <div className="flex items-center flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-amber-500/40 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
              onClick={onApproveAll}
              disabled={approvingAll || rejectingAll}
            >
              <CheckCheck className="size-4" />
              {approvingAll ? "Approving..." : `Approve All (${terms.length})`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={onRejectAll}
              disabled={approvingAll || rejectingAll}
            >
              <X className="size-4" />
              {rejectingAll ? "Rejecting..." : `Reject All (${terms.length})`}
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          These terms were extracted automatically from your recent chapter translations. Approved
          terms will be used in future prompt injections.
        </p>

        <div className="rounded-lg border border-amber-500/20 bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source Term</TableHead>
                <TableHead>Target Translation</TableHead>
                <TableHead className="w-28">Category</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terms.map((term) => (
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-500/10"
                        onClick={() => onApprove(term.id)}
                        disabled={approvingAll || rejectingAll || approvingTerm}
                        aria-label="Approve suggestion"
                        title="Approve suggestion"
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:bg-destructive/10"
                        onClick={() => onReject(term.id)}
                        disabled={approvingAll || rejectingAll || rejectingTerm}
                        aria-label="Reject suggestion"
                        title="Reject suggestion"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
