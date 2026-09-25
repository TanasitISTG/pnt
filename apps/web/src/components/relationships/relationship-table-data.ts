import type { RelationshipMapSearch } from "@/lib/relationships/query";
import type {
  CharacterProfile,
  CharacterRelationship,
  RelationshipMapV1,
} from "@/lib/relationships/schemas";

export interface RelationshipTablePage<T> {
  rows: T[];
  rowCount: number;
  pageCount: number;
  currentPage: number;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase();
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function paginate<T>(rows: T[], search: RelationshipMapSearch): RelationshipTablePage<T> {
  const rowCount = rows.length;
  const pageCount = Math.max(1, Math.ceil(rowCount / search.pageSize));
  const currentPage = Math.min(Math.max(search.page, 1), pageCount);
  return {
    rows: rows.slice((currentPage - 1) * search.pageSize, currentPage * search.pageSize),
    rowCount,
    pageCount,
    currentPage,
  };
}

export function buildCharacterTablePage(
  map: RelationshipMapV1,
  search: RelationshipMapSearch,
): RelationshipTablePage<CharacterProfile> {
  const query = normalize(search.q);
  const filteredRows = map.characters
    .filter((character) => {
      const active = character.enabled;
      const management = character.locked ? "manual" : "auto";
      if (search.state !== "all" && (search.state === "active") !== active) return false;
      if (search.management !== "all" && search.management !== management) return false;
      if (!query) return true;
      return [
        character.sourceName,
        character.targetName,
        character.aliases.join(" "),
        character.gender,
        character.role,
        character.notes,
        character.evidence,
      ].some((value) => normalize(value).includes(query));
    })
    .toSorted((left, right) => {
      let result = 0;
      if (search.sort === "name") result = compareText(left.sourceName, right.sourceName);
      if (search.sort === "state")
        result = compareText(
          left.enabled ? "active" : "inactive",
          right.enabled ? "active" : "inactive",
        );
      if (search.sort === "management")
        result = compareText(left.locked ? "manual" : "auto", right.locked ? "manual" : "auto");
      if (result === 0) return compareText(left.id, right.id);
      return search.dir === "desc" ? -result : result;
    });

  return paginate(filteredRows, search);
}

export function buildDirectedRelationshipTablePage(
  map: RelationshipMapV1,
  search: RelationshipMapSearch,
): RelationshipTablePage<CharacterRelationship> {
  const charactersById = new Map(map.characters.map((character) => [character.id, character]));
  const characterLabel = (id: string) => charactersById.get(id)?.sourceName ?? "Unknown character";
  const characterSearchLabel = (id: string) => {
    const character = charactersById.get(id);
    return character
      ? `${character.sourceName} ${character.targetName ?? ""}`
      : "Unknown character";
  };
  const isActive = (relationship: CharacterRelationship) =>
    relationship.enabled &&
    Boolean(charactersById.get(relationship.speakerId)?.enabled) &&
    Boolean(charactersById.get(relationship.listenerId)?.enabled);
  const query = normalize(search.q);
  const filteredRows = map.relationships
    .filter((relationship) => {
      const active = isActive(relationship);
      const management = relationship.locked ? "manual" : "auto";
      if (search.state !== "all" && (search.state === "active") !== active) return false;
      if (search.management !== "all" && search.management !== management) return false;
      if (!query) return true;
      return [
        characterSearchLabel(relationship.speakerId),
        characterSearchLabel(relationship.listenerId),
        relationship.relationship,
        relationship.speakerStatus,
        relationship.familiarity,
        relationship.selfPronoun,
        relationship.addresseeTerm,
        relationship.sentenceParticles,
        relationship.register,
        relationship.notes,
        relationship.evidence,
      ].some((value) => normalize(value).includes(query));
    })
    .toSorted((left, right) => {
      let result = 0;
      if (search.sort === "name") {
        result = compareText(characterLabel(left.speakerId), characterLabel(right.speakerId));
        if (result === 0) {
          result = compareText(characterLabel(left.listenerId), characterLabel(right.listenerId));
        }
      }
      if (search.sort === "state") {
        result = compareText(
          isActive(left) ? "active" : "inactive",
          isActive(right) ? "active" : "inactive",
        );
      }
      if (search.sort === "management") {
        result = compareText(left.locked ? "manual" : "auto", right.locked ? "manual" : "auto");
      }
      if (result === 0) return compareText(left.id, right.id);
      return search.dir === "desc" ? -result : result;
    });

  return paginate(filteredRows, search);
}
