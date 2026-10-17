import { BookOpen, ChevronDown, Download, FileText } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useNovelExport } from "./use-novel-export";

export interface NovelExportMenuProps {
  novelId: string;
  className?: string;
}

/**
 * The owner's way out of the app with their work: the novel as TXT or EPUB.
 *
 * It lives beside the chapter workspace because that is where the translated output is, and
 * both formats are built from the same retained translations — the route refuses a novel with
 * none, and the hook turns that refusal into a sentence instead of an empty download. The
 * trigger carries the busy state: the menu can only offer a format the request is not
 * already fetching.
 */
export function NovelExportMenu({ novelId, className }: NovelExportMenuProps) {
  const t = useTranslations("studio");
  const { exporting, handleExportTxt, handleExportEpub } = useNovelExport(novelId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(className)}
            disabled={exporting !== null}
          />
        }
      >
        {exporting ? <Spinner /> : <Download className="size-4" aria-hidden="true" />}
        <span>{t("exportNovel")}</span>
        <ChevronDown className="size-3" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("exportHint")}</DropdownMenuLabel>
          <DropdownMenuItem onClick={handleExportTxt}>
            <FileText aria-hidden="true" />
            {t("exportAsTxt")}
            <DropdownMenuShortcut>.txt</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportEpub}>
            <BookOpen aria-hidden="true" />
            {t("exportAsEpub")}
            <DropdownMenuShortcut>.epub</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
