import { getRouteApi, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Network, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";

import { QueryErrorState } from "@/components/query-error-state";
import {
  CharacterFormDialog,
  RelationshipFormDialog,
} from "@/components/relationships/relationship-entry-dialogs";
import {
  CharacterProfilesTable,
  DirectedRelationshipsTable,
} from "@/components/relationships/relationship-map-table";
import {
  buildCharacterTablePage,
  buildDirectedRelationshipTablePage,
} from "@/components/relationships/relationship-table-data";
import { useRelationshipsPageController } from "@/components/relationships/use-relationships-page-controller";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  relationshipMapQueryOptions,
  relationshipNovelQueryOptions,
  type RelationshipMapSearch,
} from "@/lib/relationships/query";

const relationshipsRoute = getRouteApi("/_protected/novels/$novelId/relationships");

export function RelationshipsPage() {
  const { novelId } = relationshipsRoute.useParams();
  const search = relationshipsRoute.useSearch();
  const navigate = relationshipsRoute.useNavigate();
  const novelQuery = useQuery(relationshipNovelQueryOptions(novelId));
  const mapQuery = useQuery(relationshipMapQueryOptions(novelId));
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
  const novel = novelQuery.data;
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
    <div className="min-w-0 space-y-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            render={<Link to="/novels/$novelId" params={{ novelId }} />}
            aria-label="Back to novel"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <p className="text-caption text-muted-foreground">{novel.title}</p>
            <h1 className="text-section font-semibold tracking-tight text-foreground">
              Character &amp; Relationships
            </h1>
          </div>
          <Badge variant="outline" className="ml-auto uppercase">
            ZH → TH
          </Badge>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Keep directed speaker and listener choices consistent across Chinese-to-Thai dialogue.
          Automatic analysis runs during the next translation or retranslation; you can also
          populate critical facts manually. Manual changes affect not-yet-started chunks and future
          retranslations, but never cancel a chunk already at the provider.
        </p>
      </header>
      {mapQuery.isRefetchError && map && (
        <QueryErrorState
          title="Unable to refresh relationship map"
          error={mapQuery.error}
          onRetry={() => void mapQuery.refetch()}
          className="my-0 min-h-0"
        />
      )}

      <Tabs value={search.view} onValueChange={switchView}>
        <TabsList aria-label="Relationship map views">
          <TabsTrigger value="characters">
            <Users className="size-4" aria-hidden="true" />
            Characters ({map.characters.length})
          </TabsTrigger>
          <TabsTrigger value="relationships">
            <Network className="size-4" aria-hidden="true" />
            Directed relationships ({map.relationships.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="characters">
          {search.view === "characters" && characterPage && (
            <section className="space-y-4" aria-labelledby="characters-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                    <h2
                      id="characters-heading"
                      className="text-card-title font-semibold text-foreground"
                    >
                      Characters
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Approved glossary mappings win for Thai names. Automatic profiles remain
                    editable until you lock them.
                  </p>
                </div>
                <Button size="sm" onClick={openCharacterAdd} aria-label="Add character profile">
                  <Plus className="size-4" aria-hidden="true" />
                  Add character
                </Button>
              </div>
              <CharacterProfilesTable
                page={characterPage}
                search={search}
                onSearchChange={updateSearch}
                actions={actions}
                onAdd={openCharacterAdd}
              />
            </section>
          )}
        </TabsContent>

        <TabsContent value="relationships">
          {search.view === "relationships" && relationshipPage && (
            <section className="space-y-4" aria-labelledby="relationships-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Network className="size-4 text-muted-foreground" aria-hidden="true" />
                    <h2
                      id="relationships-heading"
                      className="text-card-title font-semibold text-foreground"
                    >
                      Directed relationships
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Speech fields belong to the speaker → listener direction. Reverse pairs are
                    separate facts.
                  </p>
                </div>
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  <Button
                    size="sm"
                    onClick={openRelationshipAdd}
                    aria-label="Add directed relationship"
                    disabled={map.characters.length < 2}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Add relationship
                  </Button>
                  {map.characters.length < 2 && (
                    <p className="text-caption text-muted-foreground">
                      Add at least 2 character profiles first.
                    </p>
                  )}
                </div>
              </div>
              <DirectedRelationshipsTable
                characters={map.characters}
                page={relationshipPage}
                search={search}
                onSearchChange={updateSearch}
                actions={actions}
                onAdd={openRelationshipAdd}
              />
            </section>
          )}
        </TabsContent>
      </Tabs>

      <CharacterFormDialog
        form={characterForm}
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
    </div>
  );
}
