import { Link } from "@tanstack/react-router";
import { ArrowLeft, Network, Plus, Users } from "lucide-react";
import { useTranslations } from "use-intl";

import { QueryErrorState } from "@/components/query-error-state";
import {
  CharacterProfilesTable,
  DirectedRelationshipsTable,
  type RelationshipSearchChange,
  type RelationshipTableActions,
} from "@/components/relationships/relationship-map-table";
import type { RelationshipTablePage } from "@/components/relationships/relationship-table-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  CharacterProfile,
  CharacterRelationship,
  RelationshipMapV1,
} from "@/lib/relationships/schemas";
import type { RelationshipMapSearch } from "@/lib/relationships/query";

interface RelationshipsWorkspaceProps {
  novelId: string;
  novel: { title: string; sourceLang: string; targetLang: string };
  languageLabels: { source: string; target: string };
  map: RelationshipMapV1;
  search: RelationshipMapSearch;
  characterPage: RelationshipTablePage<CharacterProfile> | null;
  relationshipPage: RelationshipTablePage<CharacterRelationship> | null;
  actions: RelationshipTableActions;
  refreshError: unknown | null;
  onRefresh: () => void;
  onSearchChange: RelationshipSearchChange;
  onViewChange: (view: string | null) => void;
  onCharacterAdd: () => void;
  onRelationshipAdd: () => void;
}

export function RelationshipsWorkspace({
  novelId,
  novel,
  languageLabels,
  map,
  search,
  characterPage,
  relationshipPage,
  actions,
  refreshError,
  onRefresh,
  onSearchChange,
  onViewChange,
  onCharacterAdd,
  onRelationshipAdd,
}: RelationshipsWorkspaceProps) {
  const t = useTranslations("relationships");
  const relationshipAddDisabled = map.characters.length < 2;

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            render={<Link to="/{-$locale}/novels/$novelId" params={{ novelId }} />}
            aria-label={t("backToNovel")}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <p className="text-caption text-muted-foreground">{novel.title}</p>
            <h1 className="text-section font-semibold tracking-tight text-foreground">
              {t("title")}
            </h1>
          </div>
          <Badge variant="outline" className="ml-auto uppercase">
            {novel.sourceLang.toUpperCase()} → {novel.targetLang.toUpperCase()}
          </Badge>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {t("description", {
            source: languageLabels.source,
            target: languageLabels.target,
          })}
        </p>
      </header>

      {refreshError ? (
        <QueryErrorState
          title={t("refreshFailed")}
          error={refreshError}
          onRetry={onRefresh}
          className="my-0 min-h-0"
        />
      ) : null}

      <Tabs value={search.view} onValueChange={onViewChange}>
        {/* The icons step aside on a phone: two tab labels and two glyphs do not fit on
            one line at 390px, and the labels are what carry the meaning. */}
        <TabsList aria-label={t("viewsAria")}>
          <TabsTrigger value="characters">
            <Users className="size-4 max-sm:hidden" aria-hidden="true" />
            {t("tabCharacters", { count: map.characters.length })}
          </TabsTrigger>
          <TabsTrigger value="relationships">
            <Network className="size-4 max-sm:hidden" aria-hidden="true" />
            {t("tabRelationships", { count: map.relationships.length })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="characters">
          {search.view === "characters" && characterPage ? (
            <section className="space-y-4" aria-labelledby="characters-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                    <h2
                      id="characters-heading"
                      className="text-card-title font-semibold text-foreground"
                    >
                      {t("charactersTitle")}
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("charactersDescription", { target: languageLabels.target })}
                  </p>
                </div>
                <Button size="sm" onClick={onCharacterAdd} aria-label={t("addCharacterProfile")}>
                  <Plus className="size-4" aria-hidden="true" />
                  {t("addCharacter")}
                </Button>
              </div>
              <CharacterProfilesTable
                page={characterPage}
                search={search}
                onSearchChange={onSearchChange}
                actions={actions}
                onAdd={onCharacterAdd}
              />
            </section>
          ) : null}
        </TabsContent>

        <TabsContent value="relationships">
          {search.view === "relationships" && relationshipPage ? (
            <section className="space-y-4" aria-labelledby="relationships-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Network className="size-4 text-muted-foreground" aria-hidden="true" />
                    <h2
                      id="relationships-heading"
                      className="text-card-title font-semibold text-foreground"
                    >
                      {t("relationshipsTitle")}
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("relationshipsDescription")}
                  </p>
                </div>
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  <Button
                    size="sm"
                    onClick={onRelationshipAdd}
                    aria-label={t("addDirectedRelationship")}
                    disabled={relationshipAddDisabled}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {t("addRelationship")}
                  </Button>
                  {relationshipAddDisabled ? (
                    <p className="text-caption text-muted-foreground">{t("needsCharacters")}</p>
                  ) : null}
                </div>
              </div>
              <DirectedRelationshipsTable
                characters={map.characters}
                page={relationshipPage}
                search={search}
                onSearchChange={onSearchChange}
                actions={actions}
                onAdd={onRelationshipAdd}
              />
            </section>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
