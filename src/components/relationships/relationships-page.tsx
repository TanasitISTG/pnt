import { getRouteApi, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslations } from "use-intl";

import { QueryErrorState } from "@/components/query-error-state";
import {
  CharacterFormDialog,
  RelationshipFormDialog,
} from "@/components/relationships/relationship-entry-dialogs";
import {
  buildCharacterTablePage,
  buildDirectedRelationshipTablePage,
} from "@/components/relationships/relationship-table-data";
import { useRelationshipsPageController } from "@/components/relationships/use-relationships-page-controller";
import { RelationshipsWorkspace } from "@/components/relationships/relationships-workspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { relationshipMapQueryOptions, type RelationshipMapSearch } from "@/lib/relationships/query";
import { novelQueryOptions } from "@/lib/content/novel/novel.query";
import { languageName } from "@/lib/i18n/language-name";
import { LANG_LABELS, parseLanguagePair } from "@/lib/language-pair";

const relationshipsRoute = getRouteApi("/_protected/novels/$novelId/manage/relationships");

export function RelationshipsPage() {
  const t = useTranslations("relationships");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();
  const { novelId } = relationshipsRoute.useParams();
  const search = relationshipsRoute.useSearch();
  const navigate = relationshipsRoute.useNavigate();
  const novelQuery = useQuery(novelQueryOptions(novelId));
  const novel = novelQuery.data;
  const pair = novel ? parseLanguagePair(`${novel.sourceLang}->${novel.targetLang}`) : null;
  // The pair is data ("zh", "th"), but the words a reader sees for it are interface copy: a
  // Thai owner reading a Chinese-to-Thai map should see จีน, not the English name of the
  // language. `LANG_LABELS` is the English name the analysis prompts use, so it is only the
  // fallback for a code the catalog does not name.
  const languageLabels =
    novel && pair
      ? {
          source: languageName(tRoot, novel.sourceLang) ?? LANG_LABELS[pair].source,
          target: languageName(tRoot, novel.targetLang) ?? LANG_LABELS[pair].target,
        }
      : null;
  const mapQuery = useQuery({
    ...relationshipMapQueryOptions(novelId),
    enabled: pair !== null,
  });
  const {
    actions,
    characterDialog,
    closeCharacterDialog,
    closeDeleteDialog,
    closeRelationshipDialog,
    confirmDelete,
    deleteTarget,
    deleting,
    openCharacterAdd,
    openRelationshipAdd,
    relationshipDialog,
    saveCharacterPending,
    saveRelationshipPending,
    submitCharacter,
    submitRelationship,
  } = useRelationshipsPageController(novelId);

  const updateSearch = useCallback(
    (changes: Partial<RelationshipMapSearch>, replace = true) => {
      navigate({
        search: (previous) => ({ ...previous, ...changes }),
        replace,
      });
    },
    [navigate],
  );

  const map = mapQuery.data;
  const characterPage = useMemo(() => {
    if (!map || search.view !== "characters") return null;
    return buildCharacterTablePage(map, search);
  }, [map, search]);
  const relationshipPage = useMemo(() => {
    if (!map || search.view !== "relationships") return null;
    return buildDirectedRelationshipTablePage(map, search);
  }, [map, search]);
  const activePage = characterPage ?? relationshipPage;

  useEffect(() => {
    if (activePage && activePage.currentPage !== search.page) {
      updateSearch({ page: activePage.currentPage }, true);
    }
  }, [activePage, search.page, updateSearch]);

  const switchView = (view: string | null) => {
    if (view !== "characters" && view !== "relationships") return;
    updateSearch(
      { view, q: "", state: "all", management: "all", sort: "name", dir: "asc", page: 1 },
      true,
    );
  };

  if (!novel) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-card-title font-semibold text-foreground">{t("novelNotFound")}</h2>
        <Button className="mt-4" render={<Link to="/" />}>
          {t("backToLibrary")}
        </Button>
      </div>
    );
  }
  if (!pair || !languageLabels) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-card-title font-semibold text-foreground">{t("mapUnavailable")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("mapUnavailableDescription")}</p>
        <Button
          className="mt-4"
          render={<Link to="/{-$locale}/novels/$novelId" params={{ novelId }} />}
        >
          {t("backToNovel")}
        </Button>
      </div>
    );
  }

  if (mapQuery.isPending && !map) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground" aria-busy="true">
        {t("loading")}
      </div>
    );
  }

  if (mapQuery.isError && !map) {
    return (
      <QueryErrorState
        title={t("loadFailed")}
        error={mapQuery.error}
        onRetry={() => void mapQuery.refetch()}
        className="my-0"
      />
    );
  }

  if (!map) return null;

  return (
    <>
      <RelationshipsWorkspace
        novelId={novelId}
        novel={novel}
        languageLabels={languageLabels}
        map={map}
        search={search}
        characterPage={characterPage}
        relationshipPage={relationshipPage}
        actions={actions}
        refreshError={mapQuery.isRefetchError ? mapQuery.error : null}
        onRefresh={() => void mapQuery.refetch()}
        onSearchChange={updateSearch}
        onViewChange={switchView}
        onCharacterAdd={openCharacterAdd}
        onRelationshipAdd={openRelationshipAdd}
      />

      <CharacterFormDialog
        descriptor={characterDialog}
        targetLanguage={languageLabels.target}
        saving={saveCharacterPending}
        onSubmit={submitCharacter}
        onOpenChange={closeCharacterDialog}
      />
      <RelationshipFormDialog
        descriptor={relationshipDialog}
        characters={map.characters}
        saving={saveRelationshipPending}
        onSubmit={submitRelationship}
        onOpenChange={closeRelationshipDialog}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={closeDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteBody", { label: deleteTarget?.label ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => closeDeleteDialog(false)} disabled={deleting}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
              aria-label={t("deleteConfirmAria")}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
