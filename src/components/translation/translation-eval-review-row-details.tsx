import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { EvalReviewRow } from "@/lib/translation/evaluation/eval.schemas";

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

export function ReviewRowDetails({ row }: { row: EvalReviewRow }) {
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
      <ReviewEvidenceDetails
        missingTerms={missingTerms}
        omittedMissingCount={Math.max(0, missingCount - missingTerms.length)}
        residualExamples={residualExamples}
        omittedResidualCount={Math.max(0, (row.residualSpanCount ?? 0) - residualExamples.length)}
      />
    </>
  );
}
