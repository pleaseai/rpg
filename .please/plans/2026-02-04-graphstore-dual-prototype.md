# GraphStore Dual Prototype: SQLite vs SurrealDB

> Replace graphology + JSON with a unified GraphStore interface backed by SQLite or SurrealDB.

## Decision Context

RPG (Repository Planning Graph) is a hierarchical dual-view graph. Current stack:
- graphology (in-memory graph, unused advanced algorithms)
- JSON serialization (no indexing, full-scan search)
- LanceDB (optional vector + BM25 search)

Both SQLite and SurrealDB can replace graphology + JSON. We prototype both behind a common interface, benchmark, then choose.

## GraphStore Interface

```typescript
interface GraphStore {
  // Lifecycle
  open(path: string): Promise<void>    // file-based or mem://
  close(): Promise<void>

  // Node CRUD
  addNode(node: Node): Promise<void>
  getNode(id: string): Promise<Node | null>
  updateNode(id: string, updates: Partial<Node>): Promise<void>
  removeNode(id: string): Promise<void>
  getNodes(filter?: NodeFilter): Promise<Node[]>

  // Edge CRUD
  addEdge(edge: Edge): Promise<void>
  removeEdge(source: string, target: string, type: EdgeType): Promise<void>
  getEdges(filter?: EdgeFilter): Promise<Edge[]>

  // Graph Traversal
  getChildren(nodeId: string): Promise<Node[]>
  getParent(nodeId: string): Promise<Node | null>
  getOutEdges(nodeId: string, type?: EdgeType): Promise<Edge[]>
  getInEdges(nodeId: string, type?: EdgeType): Promise<Edge[]>
  getDependencies(nodeId: string): Promise<Node[]>
  getDependents(nodeId: string): Promise<Node[]>

  // Deep Traversal (ExploreRPG)
  traverse(options: TraverseOptions): Promise<TraverseResult>

  // Search (SearchNode)
  searchByFeature(query: string, scopes?: string[]): Promise<SearchHit[]>
  searchByPath(pattern: string): Promise<Node[]>

  // Topological Sort
  getTopologicalOrder(): Promise<Node[]>

  // Stats
  getStats(): Promise<GraphStats>

  // Serialization (backward compat)
  importJSON(data: SerializedGraph): Promise<void>
  exportJSON(): Promise<SerializedGraph>
}
```

## Phase 1: SQLiteStore

**Dependencies:** None (bun:sqlite built-in)

**Schema:**
```sql
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('high_level', 'low_level')),
    feature_description TEXT NOT NULL,
    feature_keywords TEXT,       -- JSON array
    feature_sub TEXT,            -- JSON array
    entity_type TEXT,
    path TEXT,
    qualified_name TEXT,
    language TEXT,
    line_start INTEGER,
    line_end INTEGER,
    directory_path TEXT,
    source_code TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('functional', 'dependency')),
    level INTEGER,
    sibling_order INTEGER,
    dep_type TEXT,
    is_runtime INTEGER,
    dep_line INTEGER,
    weight REAL,
    UNIQUE(source, target, type)
);

CREATE INDEX idx_edges_source ON edges(source, type);
CREATE INDEX idx_edges_target ON edges(target, type);
CREATE INDEX idx_nodes_type ON nodes(type);
CREATE INDEX idx_nodes_path ON nodes(path);

CREATE VIRTUAL TABLE nodes_fts USING fts5(
    feature_description, feature_keywords, path, qualified_name,
    content='nodes', content_rowid='rowid'
);
-- + FTS5 sync triggers (INSERT/UPDATE/DELETE)
```

**Key Queries:**
- Feature search: `SELECT ... FROM nodes_fts WHERE nodes_fts MATCH ? ORDER BY rank`
- Traversal: Recursive CTE on edges table
- Topological sort: Recursive CTE with sibling_order

## Phase 2: SurrealStore

**Dependencies:** `surrealdb` + `@surrealdb/node`

**Schema:**
```surql
DEFINE TABLE node SCHEMAFULL;
DEFINE FIELD type ON node TYPE string ASSERT $value IN ['high_level', 'low_level'];
DEFINE FIELD feature_description ON node TYPE string;
DEFINE FIELD feature_keywords ON node TYPE option<array<string>>;
DEFINE FIELD feature_sub ON node TYPE option<array<string>>;
DEFINE FIELD entity_type ON node TYPE option<string>;
DEFINE FIELD path ON node TYPE option<string>;
DEFINE FIELD qualified_name ON node TYPE option<string>;
DEFINE FIELD language ON node TYPE option<string>;
DEFINE FIELD line_start ON node TYPE option<int>;
DEFINE FIELD line_end ON node TYPE option<int>;
DEFINE FIELD directory_path ON node TYPE option<string>;
DEFINE FIELD source_code ON node TYPE option<string>;

DEFINE TABLE functional SCHEMAFULL TYPE RELATION FROM node TO node;
DEFINE FIELD level ON functional TYPE option<int>;
DEFINE FIELD sibling_order ON functional TYPE option<int>;
DEFINE FIELD weight ON functional TYPE option<float>;

DEFINE TABLE dependency SCHEMAFULL TYPE RELATION FROM node TO node;
DEFINE FIELD dep_type ON dependency TYPE option<string>;
DEFINE FIELD is_runtime ON dependency TYPE option<bool>;
DEFINE FIELD dep_line ON dependency TYPE option<int>;
DEFINE FIELD weight ON dependency TYPE option<float>;

DEFINE ANALYZER feature_analyzer TOKENIZERS blank, class FILTERS lowercase, ascii, snowball(english);
DEFINE INDEX ft_feature ON node FIELDS feature_description SEARCH ANALYZER feature_analyzer BM25;
DEFINE INDEX ft_path ON node FIELDS path SEARCH ANALYZER feature_analyzer BM25;
```

**Key Queries:**
- Feature search: `SELECT * FROM node WHERE feature_description @@ 'query' ORDER BY score DESC`
- Traversal: `SELECT ->dependency->(node AS n).* FROM node:start`
- Children: `SELECT <-functional<-node.* FROM node:parent`
- Topological sort: `SELECT * FROM node ORDER BY ->functional->node`

## Phase 3: Migrate RPG class

- Constructor accepts `GraphStore` instance (dependency injection)
- All methods delegate to `GraphStore`
- `RepositoryPlanningGraph` becomes a thin facade
- Backward compat: `fromJSON()` / `toJSON()` via `importJSON()` / `exportJSON()`

## Phase 4: Benchmark

Compare on real RPG data (tests/fixtures/sample-rpg.json):

| Metric | Test |
|--------|------|
| Insert throughput | Bulk insert all nodes + edges |
| Point lookup | getNode() x 1000 |
| Feature search | searchByFeature() x 100 queries |
| Traversal (depth=3) | traverse() from random start nodes x 100 |
| Topological sort | getTopologicalOrder() x 10 |
| File size | .db vs surrealkv directory |
| Cold start | open() time from file |

## File Changes

| File | Action |
|------|--------|
| `src/graph/store.ts` | **Create** - GraphStore interface + types |
| `src/graph/sqlite-store.ts` | **Create** - SQLite implementation |
| `src/graph/surreal-store.ts` | **Create** - SurrealDB implementation |
| `src/graph/rpg.ts` | **Modify** - Accept GraphStore, remove graphology |
| `src/graph/index.ts` | **Modify** - Export new types |
| `src/tools/search.ts` | **Modify** - Use GraphStore.searchByFeature() |
| `src/tools/explore.ts` | **Modify** - Use GraphStore.traverse() |
| `tests/store.test.ts` | **Create** - Interface conformance tests |
| `tests/benchmark.test.ts` | **Create** - Performance comparison |
| `package.json` | **Modify** - Add surrealdb, remove graphology |
