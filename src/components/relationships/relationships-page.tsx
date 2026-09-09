import { getRouteApi, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";

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
import {
  relationshipMapQueryOptions,
  relationshipNovelQueryOptions,
  type RelationshipMapSearch,
} from "@/lib/relationships/query";
import { LANG_LABELS, parseLanguagePair } from "@/lib/translation/prompts/language";

const relationshipsRoute = getRouteApi("/_protected/novels/$novelId/relationships");

export function RelationshipsPage() {
  const { novelId } = relationshipsRoute.useParams();
  const search = relationshipsRoute.useSearch();
  const navigate = relationshipsRoute.useNavigate();
  const novelQuery = useQuery(relationshipNovelQueryOptions(novelId));
  const novel = novelQuery.data;
  const pair = novel ? parseLanguagePair(`${novel.sourceLang}->${novel.targetLang}`) : null;
  const languageLabels = pair ? LANG_LABELS[pair] : null;
  const mapQuery = useQuery({
    ...relationshipMapQueryOptions(novelId),
    enabled: pair !== null,
  });
  const {
    actions,
    characterErrors,
    characterForm,
    closeCharacterDialog,
    closeDeleteDialog,
    closeRelationshipDialog,
    confirmDelete,
    deleteTarget,
    deleting,
    openCharacterAdd,
    openRelationshipAdd,
    relationshipErrors,
    relationshipForm,
    saveCharacterPending,
    saveRelationshipPending,
    setCharacterForm,
    setRelationshipForm,
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
        <h2 className="text-card-title font-semibold text-foreground">Novel not found</h2>
        <Button className="mt-4" render={<Link to="/" />}>
          Back to Library
        </Button>
      </div>
    );
  }
  if (!pair || !languageLabels) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-card-title font-semibold text-foreground">
          Relationship map unavailable
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This language pair does not support relationship maps.
        </p>
        <Button className="mt-4" render={<Link to="/novels/$novelId" params={{ novelId }} />}>
          Back to novel
        </Button>
      </div>
    );
  }

  if (mapQuery.isPending && !map) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground" aria-busy="true">
        Loading relationship map…
      </div>
    );
  }

  if (mapQuery.isError && !map) {
    return (
      <QueryErrorState
        title="Unable to load relationship map"
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
        form={characterForm}
        targetLanguage={languageLabels.target}
        errors={characterErrors}
        saving={saveCharacterPending}
        onChange={setCharacterForm}
        onSubmit={submitCharacter}
        onOpenChange={closeCharacterDialog}
      />
      <RelationshipFormDialog
        form={relationshipForm}
        characters={map.characters}
        errors={relationshipErrors}
        saving={saveRelationshipPending}
        onChange={setRelationshipForm}
        onSubmit={submitRelationship}
        onOpenChange={closeRelationshipDialog}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={closeDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete relationship entry?</DialogTitle>
            <DialogDescription>
              Delete “{deleteTarget?.label}” permanently from this map? A later source analysis can
              rediscover an unlocked fact, but this stored row and any character-linked rows will be
              removed now.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => closeDeleteDialog(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
              aria-label="Confirm delete relationship entry"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
