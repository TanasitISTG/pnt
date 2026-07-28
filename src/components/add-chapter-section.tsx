import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createChapter } from "@/lib/novel.functions";
import { createChapterSchema, type CreateChapterInput } from "@/lib/novel.schemas";
import { ScrapeImportSection } from "@/components/scrape-import-section";

interface AddChapterSectionProps {
  novelId: string;
  chapters: Array<{ number: string }>;
  invalidateChapters: () => void;
}

export function AddChapterSection({
  novelId,
  chapters,
  invalidateChapters,
}: AddChapterSectionProps) {
  const autoNextNumber = useMemo(() => {
    if (chapters.length === 0) return 1;
    const maxNum = Math.max(...chapters.map((c) => Number(c.number || 0)), 0);
    return Math.floor(maxNum) + 1;
  }, [chapters]);

  // Manual chapter form state
  const [chapNumber, setChapNumber] = useState<string>(() => autoNextNumber.toString());
  const [chapTitle, setChapTitle] = useState("");
  const [chapContent, setChapContent] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Sync chapNumber when autoNextNumber prop changes
  useEffect(() => {
    setChapNumber(autoNextNumber.toString());
  }, [autoNextNumber]);

  const handleChapterFetched = (chapter: { number: string; title: string; content: string }) => {
    setChapNumber(chapter.number);
    setChapTitle(chapter.title);
    setChapContent(chapter.content);
    setFormErrors({});
  };

  const { mutateAsync: addChapter, isPending: addingChapter } = useMutation({
    mutationFn: (vars: CreateChapterInput) => createChapter({ data: vars }),
    onSuccess: () => {
      invalidateChapters();
      toast.success("Chapter added successfully");
      setChapTitle("");
      setChapContent("");
      setFormErrors({});
      const nextNum = Number(chapNumber) + 1;
      setChapNumber(isNaN(nextNum) ? "" : nextNum.toString());
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add chapter");
    },
  });

  const handleAddChapter = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setFormErrors({});

    const num = Number(chapNumber);
    const payload = { novelId, number: num, title: chapTitle, rawContent: chapContent };

    const result = createChapterSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0] !== undefined) {
          fieldErrors[String(issue.path[0])] = issue.message;
        }
      });
      setFormErrors(fieldErrors);
      return;
    }

    // onError toasts the failure; swallow the rejection so it isn't unhandled.
    await addChapter(payload).catch(() => {});
  };

  return (
    <>
      <hr className="border-border" />

      {/* Add Chapter Form */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sub font-semibold text-foreground tracking-tight">Add Chapter</h2>
        <Card className="max-w-3xl">
          <CardContent className="p-6">
            <ScrapeImportSection
              novelId={novelId}
              invalidateChapters={invalidateChapters}
              onChapterFetched={handleChapterFetched}
            />

            <form onSubmit={handleAddChapter} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="flex flex-col gap-1.5 sm:col-span-1">
                  <Label htmlFor="chapNumber">Number *</Label>
                  <Input
                    id="chapNumber"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 1"
                    value={chapNumber}
                    onChange={(e) => {
                      setFormErrors((err) => ({ ...err, number: "" }));
                      setChapNumber(e.target.value);
                    }}
                    required
                  />
                  {formErrors.number && (
                    <span className="text-caption text-destructive">{formErrors.number}</span>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-3">
                  <Label htmlFor="chapTitle">Title *</Label>
                  <Input
                    id="chapTitle"
                    placeholder="e.g. The Awakening"
                    value={chapTitle}
                    onChange={(e) => {
                      setFormErrors((err) => ({ ...err, title: "" }));
                      setChapTitle(e.target.value);
                    }}
                    required
                  />
                  {formErrors.title && (
                    <span className="text-caption text-destructive">{formErrors.title}</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-baseline">
                  <Label htmlFor="chapContent">Raw Content *</Label>
                  <span className="text-caption text-muted-foreground">
                    {chapContent.length.toLocaleString()} characters
                  </span>
                </div>
                <Textarea
                  id="chapContent"
                  placeholder="Paste raw chapter text here..."
                  value={chapContent}
                  onChange={(e) => {
                    setFormErrors((err) => ({ ...err, rawContent: "" }));
                    setChapContent(e.target.value);
                  }}
                  rows={8}
                  required
                />
                {formErrors.rawContent && (
                  <span className="text-caption text-destructive">{formErrors.rawContent}</span>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="submit" disabled={addingChapter}>
                  {addingChapter ? "Adding..." : "Add Chapter"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
