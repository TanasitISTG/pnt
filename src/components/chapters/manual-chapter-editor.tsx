import { useCallback, useMemo, useReducer, useRef } from "react";
import type { RefObject, SyntheticEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createChapter } from "@/lib/content/chapter.functions";
import { createChapterSchema, type CreateChapterInput } from "@/lib/content/novel.schemas";

export interface FetchedChapterDraft {
  number: string;
  title: string;
  content: string;
  sourceUrl: string;
}

type ManualField = "number" | "title" | "rawContent";
type FieldErrors = Partial<Record<ManualField, string>>;

interface ManualDraftState {
  numberDraft: string;
  numberEdited: boolean;
  minimumNextNumber: number;
  title: string;
  content: string;
  sourceUrl: string | null;
  fieldErrors: FieldErrors;
  submitError: string | null;
}

type ManualDraftAction =
  | { type: "editNumber"; value: string }
  | { type: "editTitle"; value: string }
  | { type: "editContent"; value: string }
  | { type: "acceptFetched"; chapter: FetchedChapterDraft }
  | { type: "reset" }
  | { type: "startSubmission" }
  | { type: "validationFailed"; errors: FieldErrors }
  | { type: "submissionFailed"; error: string }
  | { type: "submissionSucceeded"; minimumNextNumber: number };

const initialDraft: ManualDraftState = {
  numberDraft: "",
  numberEdited: false,
  minimumNextNumber: 0,
  title: "",
  content: "",
  sourceUrl: null,
  fieldErrors: {},
  submitError: null,
};

function manualDraftReducer(state: ManualDraftState, action: ManualDraftAction): ManualDraftState {
  switch (action.type) {
    case "editNumber":
      return {
        ...state,
        numberDraft: action.value,
        numberEdited: true,
        fieldErrors: { ...state.fieldErrors, number: undefined },
        submitError: null,
      };
    case "editTitle":
      return {
        ...state,
        title: action.value,
        fieldErrors: { ...state.fieldErrors, title: undefined },
        submitError: null,
      };
    case "editContent":
      return {
        ...state,
        content: action.value,
        fieldErrors: { ...state.fieldErrors, rawContent: undefined },
        submitError: null,
      };
    case "acceptFetched":
      return {
        ...state,
        numberDraft: action.chapter.number,
        numberEdited: true,
        title: action.chapter.title,
        content: action.chapter.content,
        sourceUrl: action.chapter.sourceUrl,
        fieldErrors: {},
        submitError: null,
      };
    case "reset":
      return initialDraft;
    case "startSubmission":
      return { ...state, fieldErrors: {}, submitError: null };
    case "validationFailed":
      return { ...state, fieldErrors: action.errors };
    case "submissionFailed":
      return { ...state, submitError: action.error };
    case "submissionSucceeded":
      return {
        ...initialDraft,
        minimumNextNumber: action.minimumNextNumber,
      };
  }
}

export interface ManualChapterEditorController {
  number: string;
  title: string;
  content: string;
  sourceUrl: string | null;
  fieldErrors: FieldErrors;
  submitError: string | null;
  addingChapter: boolean;
  numberRef: RefObject<HTMLInputElement | null>;
  titleRef: RefObject<HTMLInputElement | null>;
  contentRef: RefObject<HTMLTextAreaElement | null>;
  acceptFetchedChapter: (chapter: FetchedChapterDraft) => void;
  resetManualDraft: () => void;
  editNumber: (value: string) => void;
  editTitle: (value: string) => void;
  editContent: (value: string) => void;
  addChapter: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
}

export function useManualChapterEditor({
  novelId,
  chapters,
  invalidateChapters,
}: {
  novelId: string;
  chapters: Array<{ number: string }>;
  invalidateChapters: () => void;
}): ManualChapterEditorController {
  const autoNextNumber = useMemo(() => {
    if (chapters.length === 0) return 1;
    const maxNumber = Math.max(...chapters.map((chapter) => Number(chapter.number || 0)), 0);
    return Math.floor(maxNumber) + 1;
  }, [chapters]);
  const [state, dispatch] = useReducer(manualDraftReducer, initialDraft);
  const numberRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const number = state.numberEdited
    ? state.numberDraft
    : Math.max(autoNextNumber, state.minimumNextNumber).toString();

  const { mutateAsync, isPending: addingChapter } = useMutation({
    mutationFn: (input: CreateChapterInput) => createChapter({ data: input }),
    onSuccess: (_result, input) => {
      invalidateChapters();
      dispatch({
        type: "submissionSucceeded",
        minimumNextNumber: Math.floor(input.number) + 1,
      });
      toast.success("Chapter added successfully");
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to add chapter";
      dispatch({ type: "submissionFailed", error: message });
      toast.error(message);
    },
  });

  const acceptFetchedChapter = useCallback((chapter: FetchedChapterDraft) => {
    dispatch({ type: "acceptFetched", chapter });
  }, []);

  const addChapter = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    dispatch({ type: "startSubmission" });

    const result = createChapterSchema.safeParse({
      novelId,
      number: Number(number),
      title: state.title,
      rawContent: state.content,
    });
    if (!result.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (
          (field === "number" || field === "title" || field === "rawContent") &&
          !fieldErrors[field]
        ) {
          fieldErrors[field] = issue.message;
        }
      }
      dispatch({ type: "validationFailed", errors: fieldErrors });

      const firstInvalidField = (["number", "title", "rawContent"] as const).find(
        (field) => fieldErrors[field],
      );
      const fieldRefs: Record<ManualField, RefObject<HTMLElement | null>> = {
        number: numberRef,
        title: titleRef,
        rawContent: contentRef,
      };
      fieldRefs[firstInvalidField ?? "number"].current?.focus();
      return;
    }

    try {
      await mutateAsync(result.data);
    } catch {
      // The mutation callback has already exposed the safe error.
    }
  };

  return {
    number,
    title: state.title,
    content: state.content,
    sourceUrl: state.sourceUrl,
    fieldErrors: state.fieldErrors,
    submitError: state.submitError,
    addingChapter,
    numberRef,
    titleRef,
    contentRef,
    acceptFetchedChapter,
    resetManualDraft: () => dispatch({ type: "reset" }),
    editNumber: (value) => dispatch({ type: "editNumber", value }),
    editTitle: (value) => dispatch({ type: "editTitle", value }),
    editContent: (value) => dispatch({ type: "editContent", value }),
    addChapter,
  };
}

export function ManualChapterEditor({ controller }: { controller: ManualChapterEditorController }) {
  const {
    number,
    title,
    content,
    sourceUrl,
    fieldErrors,
    submitError,
    addingChapter,
    numberRef,
    titleRef,
    contentRef,
    resetManualDraft,
    editNumber,
    editTitle,
    editContent,
    addChapter,
  } = controller;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold tracking-tight text-foreground">Create one chapter</h3>
        <p className="text-sm text-muted-foreground">
          Paste source text, review the details, then add it to the novel.
        </p>
      </header>

      {sourceUrl ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="min-w-0 text-foreground">
            <span className="font-semibold">Fetched from URL.</span>{" "}
            <span className="text-muted-foreground">
              Review the draft before adding it. Source:{" "}
              <span title={sourceUrl}>{truncateUrl(sourceUrl)}</span>
            </span>
          </p>
          <Button type="button" variant="outline" size="sm" onClick={resetManualDraft}>
            Start fresh
          </Button>
        </div>
      ) : null}

      <form noValidate autoComplete="off" onSubmit={addChapter} className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-2">
            <Label htmlFor="chapNumber">Chapter number *</Label>
            <Input
              ref={numberRef}
              id="chapNumber"
              name="number"
              type="number"
              step="0.01"
              min="0.01"
              autoComplete="off"
              placeholder="e.g. 1"
              value={number}
              aria-invalid={Boolean(fieldErrors.number)}
              aria-describedby={fieldErrors.number ? "chap-number-error" : undefined}
              onChange={(event) => editNumber(event.target.value)}
            />
            {fieldErrors.number ? (
              <span id="chap-number-error" role="alert" className="text-sm text-destructive">
                {fieldErrors.number}
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="chapTitle">Chapter title *</Label>
            <Input
              ref={titleRef}
              id="chapTitle"
              name="title"
              autoComplete="off"
              placeholder="e.g. The Awakening"
              value={title}
              aria-invalid={Boolean(fieldErrors.title)}
              aria-describedby={fieldErrors.title ? "chap-title-error" : undefined}
              onChange={(event) => editTitle(event.target.value)}
            />
            {fieldErrors.title ? (
              <span id="chap-title-error" role="alert" className="text-sm text-destructive">
                {fieldErrors.title}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Label htmlFor="chapContent">Source text *</Label>
            <span className="text-sm text-muted-foreground">
              {content.length.toLocaleString()} characters
            </span>
          </div>
          <Textarea
            ref={contentRef}
            id="chapContent"
            name="rawContent"
            autoComplete="off"
            placeholder="Paste raw chapter text here..."
            value={content}
            aria-invalid={Boolean(fieldErrors.rawContent)}
            aria-describedby={fieldErrors.rawContent ? "chap-content-error" : undefined}
            onChange={(event) => editContent(event.target.value)}
            rows={14}
          />
          {fieldErrors.rawContent ? (
            <span id="chap-content-error" role="alert" className="text-sm text-destructive">
              {fieldErrors.rawContent}
            </span>
          ) : null}
        </div>

        {submitError ? (
          <div
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            {submitError}
          </div>
        ) : null}

        <footer className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button type="submit" disabled={addingChapter}>
            {addingChapter ? "Adding chapter…" : "Add chapter"}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function truncateUrl(url: string): string {
  return url.length > 64 ? `${url.slice(0, 61)}…` : url;
}
