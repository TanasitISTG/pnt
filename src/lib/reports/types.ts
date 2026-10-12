/**
 * The shapes a report takes on the way to a screen.
 *
 * A *report* is one member's claim; a *case* is the workload an operator works, being
 * every open report on the same novel, so one decision covers the pile. These types are
 * importable from the browser, so the queue and the dialogs read the same fields the
 * service returns.
 */

export interface ReportCaseEntry {
  id: string;
  reporterUserId: string;
  reporterEmail: string | null;
  reason: string;
  details: string | null;
  createdAt: Date;
}

export interface ReportCaseNovel {
  /** Null once the reported novel has been deleted. */
  novelId: string | null;
  title: string;
  publishedAt: Date | null;
  coverUrl: string | null;
  coverSrcSet: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
}

export interface ReportCase {
  caseKey: string;
  target: ReportCaseNovel;
  openCount: number;
  reasons: string[];
  firstReportedAt: Date;
  lastReportedAt: Date;
  entries: ReportCaseEntry[];
  /** True when the case holds more open reports than `entries` carries. */
  truncated: boolean;
}

export interface ReportCasePage {
  cases: ReportCase[];
  rowCount: number;
  page: number;
  pageSize: number;
}

export interface ReportHistoryRow {
  id: string;
  caseKey: string;
  novelId: string | null;
  novelTitle: string | null;
  reason: string;
  details: string | null;
  reporterEmail: string | null;
  status: string;
  resolutionNote: string | null;
  resolvedByEmail: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface ReportHistoryPage {
  rows: ReportHistoryRow[];
  rowCount: number;
  page: number;
  pageSize: number;
}

/** What the reporter's own novel page asks: is there an open report from me already? */
export interface MyNovelReport {
  id: string;
  status: string;
  createdAt: Date;
}
