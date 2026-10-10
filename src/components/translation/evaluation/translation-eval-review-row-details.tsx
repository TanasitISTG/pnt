import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { EvalFinding, EvalReviewRow } from "@/lib/translation/evaluation/eval.schemas";

function warningLabels(row: EvalReviewRow): string[] {
  const warnings: string[] = [];
  if (row.residualScriptLetters > 0) {
    warnings.push(`Residual script: ${row.residualScriptLetters.toLocaleString()} letters`);
  }
  if (row.markerMismatches > 0) {
    warnings.push(
      row.rawParagraphCount !== null && row.translatedParagraphCount !== null
        ? `Paragraph counts differ: ${row.rawParagraphCount} source, ${row.translatedParagraphCount} translated`
        : `Paragraph count difference: ${row.markerMismatches}`,
    );
  }
  if (row.matchedGlossaryTerms > row.adheredGlossaryTerms) {
    warnings.push(
      `Approved glossary adherence: ${row.adheredGlossaryTerms}/${row.matchedGlossaryTerms}`,
    );
  }
  return warnings;
}

function findingTitle(finding: EvalFinding): string {
  if (finding.type === "residual-script") return "Residual source script";
  if (finding.type === "glossary-miss") return "Missing approved glossary term";
  return "Paragraph alignment mismatch";
}

function FindingList({ novelId, row }: { novelId: string; row: EvalReviewRow }) {
  if (!row.findings || row.findings.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3 text-sm">
      <p className="font-medium text-foreground">Correction points</p>
      <ol className="mt-2 flex flex-col gap-3">
        {row.findings.map((finding, index) => {
          const anchor =
            finding.paragraphIndex !== null ? `reader-paragraph-${finding.paragraphIndex}` : null;
          return (
            <li key={`${finding.type}-${finding.paragraphIndex ?? "chapter"}-${index}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium text-foreground">
                  {findingTitle(finding)}
                  {finding.paragraphIndex !== null
                    ? ` · paragraph ${finding.paragraphIndex}`
                    : " · chapter-level"}
                </p>
                {anchor ? (
                  <Link
                    to="/novels/$novelId/chapters/$chapterId"
                    params={{ novelId, chapterId: row.chapterId }}
                    hash={anchor}
                    className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Open paragraph
                  </Link>
                ) : null}
              </div>
              {finding.sourceTerm && finding.targetTerm ? (
                <p className="mt-1 text-muted-foreground">
                  {finding.sourceTerm} → {finding.targetTerm}
                </p>
              ) : null}
              {finding.sourceExcerpt || finding.translationExcerpt ? (
                <dl className="mt-2 grid gap-2 text-muted-foreground sm:grid-cols-2">
                  {finding.sourceExcerpt ? (
                    <div className="min-w-0">
                      <dt className="font-medium text-foreground">Source</dt>
                      <dd className="break-words">{finding.sourceExcerpt}</dd>
                    </div>
                  ) : null}
                  {finding.translationExcerpt ? (
                    <div className="min-w-0">
                      <dt className="font-medium text-foreground">Translation</dt>
                      <dd className="break-words">{finding.translationExcerpt}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ReviewFindingStatus({
  untranslated,
  warnings,
}: {
  untranslated: boolean;
  warnings: string[];
}) {
  if (untranslated) {
    return (
      <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>Not translated — no quality checks performed</span>
      </p>
    );
  }
  if (warnings.length === 0) {
    return (
      <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span>No heuristic issues found in this check</span>
      </p>
    );
  }
  return (
    <ul className="mt-3 flex flex-col gap-1 text-sm text-foreground" aria-label="Findings">
      {warnings.map((warning) => (
        <li key={warning} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="break-words">{warning}</span>
        </li>
      ))}
    </ul>
  );
}

function ReviewMetricSummary({ row, untranslated }: { row: EvalReviewRow; untranslated: boolean }) {
  if (untranslated) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-caption text-muted-foreground">
      {row.rawParagraphCount !== null && row.translatedParagraphCount !== null ? (
        <span>
          Paragraphs {row.rawParagraphCount} source / {row.translatedParagraphCount} translated
        </span>
      ) : null}
      <span>
        Glossary {row.adheredGlossaryTerms}/{row.matchedGlossaryTerms} adhered
      </span>
      {row.evaluated !== null ? <span>{row.evaluated ? "Evaluated" : "Skipped"}</span> : null}
    </div>
  );
}

function ReviewEvidenceDetails({
  missingTerms,
  omittedMissingCount,
  residualExamples,
  omittedResidualCount,
}: {
  missingTerms: string[];
  omittedMissingCount: number;
  residualExamples: string[];
  omittedResidualCount: number;
}) {
  return (
    <>
      {missingTerms.length > 0 ? (
        <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3 text-sm">
          <p className="font-medium text-foreground">Missing approved terms</p>
          <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
            {missingTerms.map((term) => (
              <li key={term} className="break-words">
                {term}
              </li>
            ))}
          </ul>
          {omittedMissingCount > 0 ? (
            <p className="mt-1 text-muted-foreground">and {omittedMissingCount} more</p>
          ) : null}
        </div>
      ) : null}

      {residualExamples.length > 0 ? (
        <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3 text-sm">
          <p className="font-medium text-foreground">Residual examples</p>
          <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
            {residualExamples.map((example, index) => (
              <li key={`${example}-${index}`} className="break-words">
                {example}
              </li>
            ))}
          </ul>
          {omittedResidualCount > 0 ? (
            <p className="mt-1 text-muted-foreground">and {omittedResidualCount} more</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function ReviewRowDetails({ novelId, row }: { novelId: string; row: EvalReviewRow }) {
  const warnings = warningLabels(row);
  const missingTerms =
    row.missingGlossaryTerms?.map((term) => `${term.source} → ${term.target}`) ?? [];
  const missingCount = Math.max(0, row.matchedGlossaryTerms - row.adheredGlossaryTerms);
  const residualExamples = row.residualExamples ?? [];
  const untranslated = row.evaluated === false;

  return (
    <>
      <ReviewFindingStatus untranslated={untranslated} warnings={warnings} />
      <ReviewMetricSummary row={row} untranslated={untranslated} />
      <FindingList novelId={novelId} row={row} />
      {row.findings === null ? (
        <ReviewEvidenceDetails
          missingTerms={missingTerms}
          omittedMissingCount={Math.max(0, missingCount - missingTerms.length)}
          residualExamples={residualExamples}
          omittedResidualCount={Math.max(0, (row.residualSpanCount ?? 0) - residualExamples.length)}
        />
      ) : null}
    </>
  );
}
