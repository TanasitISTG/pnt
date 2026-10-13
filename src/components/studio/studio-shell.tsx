import type { ReactNode } from "react";

import { NovelContextBar } from "@/components/novels/novel-context-bar";
import { parseLanguagePair } from "@/lib/language-pair";
import { StudioNav } from "./studio-nav";

export interface StudioShellNovel {
  id: string;
  title: string;
  sourceLang: string;
  targetLang: string;
  publishedAt: Date | string | null;
}

export interface StudioShellProps {
  novel: StudioShellNovel;
  publishing: boolean;
  onPublishChange: (publishedAt: Date | null) => void | Promise<void>;
  children: ReactNode;
}

/**
 * The owner's workspace frame: the same context bar every novel surface carries, with the
 * studio's sections under it. The public page used to play this role with a tab strip on
 * top of the reading page; the workspace has its own door now.
 */
export function StudioShell({ novel, publishing, onPublishChange, children }: StudioShellProps) {
  const showRelationships = Boolean(parseLanguagePair(`${novel.sourceLang}->${novel.targetLang}`));

  return (
    <div className="flex flex-col gap-6">
      <NovelContextBar
        novelId={novel.id}
        title={novel.title}
        sourceLang={novel.sourceLang}
        targetLang={novel.targetLang}
        canManage
        publishedAt={novel.publishedAt}
        publishing={publishing}
        onPublishChange={onPublishChange}
        origin="library"
        current="manage"
        showManageLink={false}
        subNav={<StudioNav novelId={novel.id} showRelationships={showRelationships} />}
      />
      {children}
    </div>
  );
}
