/**
 * The shapes a report takes on the way to a screen.
 *
 * A *report* is one member's claim; a *case* is the workload an operator works, being
 * every open report on the same target, so one decision covers the pile. These types are
 * importable from the browser, so the queue and the dialogs read the same fields the
 * service returns.
 */

import type { ReportTargetType } from "./reasons";

export interface ReportCaseEntry {
  id: string;
  reporterUserId: string;
  reporterEmail: string | null;
  reason: string;
  details: string | null;
  createdAt: Date;
}

/**
 * What a case is about, whichever of the three targets it is. Novel fields are resolved
 * live where the novel still exists; once it is gone the title recorded at report time
 * stands in. Comment and review cases add the reported words, the chapter a comment lives
 * in, and the rating a review carried.
 */
export interface ReportCaseTarget {
  type: ReportTargetType;
  /** The parent novel, for a novel case or the novel a comment or review belongs to. */
  novelId: string | null;
  /** The novel's title: live when it still exists, else the snapshot taken at report time. */
  title: string;
  publishedAt: Date | null;
  coverUrl: string | null;
  coverSrcSet: string | null;
  /** The novel's owner, the account whose conduct a novel case is about. */
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  /** The reported words for a comment or review; null for a novel. */
  excerpt: string | null;
  /** The author of the reported comment or review. */
  authorId: string | null;
  authorName: string | null;
  authorEmail: string | null;
  /** The reported review's rating. */
  rating: number | null;
  /** Where a reported comment lives. */
  chapterId: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  /** Set when the reported comment or review has already been removed. */
  removedAt: Date | null;
  /** True when the target row itself is gone: a deleted novel, comment, or review. */
  deleted: boolean;
}

export interface ReportCase {
  caseKey: string;
  target: ReportCaseTarget;
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
  targetType: string;
  novelId: string | null;
  novelTitle: string | null;
  /** The reported words, for a comment or review case; null for a novel. */
  excerpt: string | null;
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
