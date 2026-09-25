import { Link } from "@tanstack/react-router";
import { ArrowLeft, Network, Plus, Users } from "lucide-react";

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
  const relationshipAddDisabled = map.characters.length < 2;

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
            {novel.sourceLang.toUpperCase()} → {novel.targetLang.toUpperCase()}
          </Badge>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Keep directed speaker and listener choices consistent across {languageLabels.source}-to-
          {languageLabels.target} dialogue. Automatic analysis runs during the next translation or
          retranslation; you can also populate critical facts manually. Manual changes affect
          not-yet-started chunks and future retranslations, but never cancel a chunk already at the
          provider.
        </p>
      </header>

      {refreshError ? (
        <QueryErrorState
          title="Unable to refresh relationship map"
          error={refreshError}
          onRetry={onRefresh}
          className="my-0 min-h-0"
        />
      ) : null}

      <Tabs value={search.view} onValueChange={onViewChange}>
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
                      Characters
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Approved glossary mappings win for {languageLabels.target} names. Automatic
                    profiles remain editable until you lock them.
                  </p>
                </div>
                <Button size="sm" onClick={onCharacterAdd} aria-label="Add character profile">
                  <Plus className="size-4" aria-hidden="true" />
                  Add character
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
                    onClick={onRelationshipAdd}
                    aria-label="Add directed relationship"
                    disabled={relationshipAddDisabled}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Add relationship
                  </Button>
                  {relationshipAddDisabled ? (
                    <p className="text-caption text-muted-foreground">
                      Add at least 2 character profiles first.
                    </p>
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
