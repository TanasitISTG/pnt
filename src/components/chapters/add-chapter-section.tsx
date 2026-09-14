import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { createChapter } from "@/lib/content/chapter.functions";
import { createChapterSchema, type CreateChapterInput } from "@/lib/content/novel.schemas";
import { ScrapeImportSection } from "@/components/chapters/scrape-import-section";
import { EpubImportSection } from "@/components/chapters/epub-import-section";

type AddChapterMode = "manual" | "url" | "epub";
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
  const [mode, setMode] = useState<AddChapterMode>("manual");
  const [chapNumber, setChapNumber] = useState<string>(() => autoNextNumber.toString());
  const [chapTitle, setChapTitle] = useState("");
  const [chapContent, setChapContent] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const chapterNumberEditedRef = useRef(false);

  // Only follow the chapter list while the number is still generated. A
  // manual number or URL preview is a deliberate draft value.
  useEffect(() => {
    if (!chapterNumberEditedRef.current) {
      setChapNumber(autoNextNumber.toString());
    }
  }, [autoNextNumber]);

  const handleChapterFetched = (chapter: { number: string; title: string; content: string }) => {
    chapterNumberEditedRef.current = true;
    setChapNumber(chapter.number);
    setChapTitle(chapter.title);
    setChapContent(chapter.content);
    setFormErrors({});
    setMode("manual");
  };

  const { mutateAsync: addChapter, isPending: addingChapter } = useMutation({
    mutationFn: (vars: CreateChapterInput) => createChapter({ data: vars }),
    onSuccess: (_result, variables) => {
      invalidateChapters();
      toast.success("Chapter added successfully");
      setChapTitle("");
      setChapContent("");
      setFormErrors({});
      chapterNumberEditedRef.current = false;
      const nextGeneratedNumber = Math.max(autoNextNumber, Math.floor(variables.number) + 1);
      setChapNumber(nextGeneratedNumber.toString());
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

      <div className="flex flex-col gap-4">
        <h2 className="text-sub font-semibold text-foreground tracking-tight">Add Chapter</h2>
        <Card className="max-w-3xl">
          <CardContent className="p-6">
            <Tabs value={mode} onValueChange={(value) => setMode(value as AddChapterMode)}>
              <TabsList className="w-full overflow-x-auto sm:w-fit" aria-label="Add chapter mode">
                <TabsTrigger className="min-h-11 flex-1 sm:flex-none" value="manual">
                  Manual
                </TabsTrigger>
                <TabsTrigger className="min-h-11 flex-1 sm:flex-none" value="url">
                  URL
                </TabsTrigger>
                <TabsTrigger className="min-h-11 flex-1 sm:flex-none" value="epub">
                  EPUB
                </TabsTrigger>
              </TabsList>

              <TabsContent value="manual" keepMounted>
                <form onSubmit={handleAddChapter} className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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
                          chapterNumberEditedRef.current = true;
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
                    <div className="flex items-baseline justify-between">
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
              </TabsContent>

              <TabsContent value="url" keepMounted>
                <ScrapeImportSection
                  novelId={novelId}
                  invalidateChapters={invalidateChapters}
                  onChapterFetched={handleChapterFetched}
                />
              </TabsContent>

              <TabsContent value="epub" keepMounted>
                <EpubImportSection novelId={novelId} invalidateChapters={invalidateChapters} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
