import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { CoverUpload } from "@/components/cover-upload";
import { coverMimeSchema, createNovelSchema } from "@/lib/novel.schemas";

type NovelFormData = z.infer<typeof createNovelSchema> & {
  removeCover?: boolean;
};

interface NovelFormProps {
  defaultValues?: Partial<NovelFormData> & { id?: string; hasCover?: boolean };
  onSubmit: (data: NovelFormData) => Promise<void>;
  submitLabel: string;
  pending?: boolean;
}

export function NovelForm({
  defaultValues,
  onSubmit,
  submitLabel,
  pending = false,
}: NovelFormProps) {
  const [form, setForm] = useState<NovelFormData>({
    title: defaultValues?.title || "",
    originalTitle: defaultValues?.originalTitle || "",
    author: defaultValues?.author || "",
    description: defaultValues?.description || "",
    sourceLang: defaultValues?.sourceLang || "en",
    targetLang: defaultValues?.targetLang || "th",
    customPrompt: defaultValues?.customPrompt || "",
    cover: null,
    coverMime: null,
    removeCover: false,
  });

  const [errors, setErrors] = useState<Partial<Record<keyof NovelFormData, string>>>({});

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setErrors({});

    const result = createNovelSchema.partial().safeParse(form);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof NovelFormData, string>> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0] !== undefined) {
          fieldErrors[String(issue.path[0]) as keyof NovelFormData] = issue.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }

    await onSubmit(form);
  };

  const handleSelectChange = (field: "sourceLang" | "targetLang", value: string | null) => {
    if (!value) return;
    setForm((prev) => ({ ...prev, [field]: value as any }));
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 max-w-2xl bg-card border border-border rounded-xl p-6"
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6">
        <div className="flex flex-col gap-4 flex-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. Solo Leveling"
              required
            />
            {errors.title && <span className="text-caption text-destructive">{errors.title}</span>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="originalTitle">Original Title</Label>
            <Input
              id="originalTitle"
              value={form.originalTitle || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, originalTitle: e.target.value }))}
              placeholder="e.g. 나 혼자만 레벨업"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="author">Author</Label>
            <Input
              id="author"
              value={form.author || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, author: e.target.value }))}
              placeholder="e.g. Chugong"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 shrink-0">
          <Label>Cover Image</Label>
          <CoverUpload
            existingNovelId={defaultValues?.id}
            hasExistingCover={defaultValues?.hasCover}
            cover={defaultValues?.cover}
            onChange={(base64, mimeType) => {
              const validatedMime =
                mimeType && coverMimeSchema.safeParse(mimeType).success
                  ? (mimeType as z.infer<typeof coverMimeSchema>)
                  : null;
              setForm((prev) => ({
                ...prev,
                cover: base64,
                coverMime: validatedMime,
                removeCover: false,
              }));
            }}
            onRemoveCover={() =>
              setForm((prev) => ({
                ...prev,
                cover: null,
                coverMime: null,
                removeCover: true,
              }))
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sourceLang">Source Language</Label>
          <Select
            value={form.sourceLang}
            onValueChange={(value) => handleSelectChange("sourceLang", value)}
          >
            <SelectTrigger id="sourceLang" className="w-full h-10 px-3">
              <SelectValue placeholder="Select source language" />
            </SelectTrigger>
            <SelectContent className="min-w-36">
              <SelectItem value="en">English (EN)</SelectItem>
              <SelectItem value="zh">Chinese (ZH)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="targetLang">Target Language</Label>
          <Select
            value={form.targetLang}
            onValueChange={(value) => handleSelectChange("targetLang", value)}
          >
            <SelectTrigger id="targetLang" className="w-full h-10 px-3">
              <SelectValue placeholder="Select target language" />
            </SelectTrigger>
            <SelectContent className="min-w-36">
              <SelectItem value="th">Thai (TH)</SelectItem>
              <SelectItem value="en">English (EN)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={form.description || ""}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          placeholder="Enter a brief description of the novel..."
          rows={4}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customPrompt">Custom AI Prompt Override</Label>
        <Textarea
          id="customPrompt"
          value={form.customPrompt || ""}
          onChange={(e) => setForm((prev) => ({ ...prev, customPrompt: e.target.value }))}
          placeholder="Optional: Custom instructions for the AI translator. E.g. 'Use formal language for elder characters...'"
          rows={4}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
