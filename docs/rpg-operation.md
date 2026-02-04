# RPG Operation: Unified Reasoning Substrate

> Based on RPG-Encoder (arXiv:2602.02084)

## Overview

RPG Operation deploys the Repository Planning Graph as a **Unified Representation** providing a queryable index of the codebase. Structurally, the RPG functions as a heterogeneous graph where two views --- Functional View (`E_feature`) and Dependency View (`E_dep`) --- are partitioned by edge type but share a unified node set `V`. This enables seamless context switching during retrieval: an agent can discover code by semantic intent, verify it with exact source, then expand along dependency edges, all within a single coherent substrate.

The operation layer completes the RPG pipeline:

```
Encoding (Code → RPG) → Evolution (Incremental Maintenance) → Operation (Unified Reasoning)
```

## Dual Roles of RPG

RPG reduces information overload by serving two complementary roles:

1. **Knowledge Source**: Stores feature descriptions and metadata for each node, capturing *what* the code does without requiring implementation parsing.
2. **Process Encoder**: Induces a topological order via functional edges (`E_feature`) and dependency edges (`E_dep`), exposing causality and hierarchy essential for architectural comprehension.

## Core Tools

Three tools operate on the RPG's nodes and edges, forming a complete toolkit for repository-level reasoning.

### SearchNode

**Global node-level retrieval** by matching intent against semantic features `f` or filtering metadata `m`.

SearchNode unifies *semantic discovery* and *textual retrieval*. It supports three modes:

| Mode | Description |
|------|-------------|
| `features` | Intent → feature nodes / mapped code entities. Maps behavioral descriptions to concrete code. |
| `snippets` | Keyword/symbol search over the repository. Retrieves code by file paths, qualified entities, or keywords. |
| `auto` | Feature mapping first, followed by snippet search when needed. |

**Parameters:**

```json
{
  "tool_name": "SearchNode",
  "parameters": {
    "mode": "<'features' | 'snippets' | 'auto'>",
    "feature_terms": "<List of behavioral/functionality phrases>",
    "search_scopes": "<List of feature entity paths to restrict the Functionality SubGraph>",
    "search_terms": "<List of file paths, qualified entities (file:Class.method), or keywords>",
    "line_nums": "<[start, end] to extract lines from a specific file>",
    "file_path_or_pattern": "<File path or glob pattern. Default: '**/*.py'>"
  }
}
```

**Returns:**
- Feature search: matched feature nodes mapped to code entities (feature name, code entity, file path, line range)
- Snippet search: matched code snippets, complete files, or located entities

**Key design**: `search_scopes` restricts search to selected feature subtrees, leveraging the grounded hierarchy to improve precision. This prevents the search from returning semantically distant but textually similar matches.

#### Key Techniques and Pseudocode

##### RPG Graph Structure (Prerequisite)

SearchNode operates on the RPG graph `G = (V, E)` where each node `v = (f, m)`:
- `f`: semantic feature --- behavioral description (e.g., *"handles HTTP authentication"*)
- `m`: structural metadata --- code entity attributes (type, path, line range, name)

The node set is partitioned into:
- `V_H` (High-level): abstract functional centroids without direct code anchoring
- `V_L` (Low-level): atomic implementations (files, classes, functions) with full metadata

The hierarchy is **grounded** via the Artifact Grounding phase (Phase 3 of Encoding), where each `V_H` node's metadata `m` is populated through bottom-up LCA propagation, tying abstract features to directory scopes.

##### Feature Search: Intent → Code Mapping

The core mechanism matches natural-language behavioral intent against the semantic features `f` stored in RPG nodes. This is a **graph-internal** search.

```
FUNCTION FeatureSearch(G, feature_terms, search_scopes):
    // Step 1: Determine search space
    IF search_scopes is provided:
        // Restrict to subtree(s) rooted at specified feature paths
        // Leverages grounded hierarchy from Artifact Grounding (Phase 3)
        candidates ← ∅
        FOR scope IN search_scopes:
            root ← FindNodeByFeaturePath(G, scope)
            candidates ← candidates ∪ GetSubtree(G, root, E_feature)
    ELSE:
        candidates ← V   // All nodes in graph

    // Step 2: Match intent against semantic features
    results ← []
    FOR v = (f, m) IN candidates:
        score ← SemanticMatch(feature_terms, f)
        IF score > threshold:
            results.append((v, score))

    // Step 3: Map feature nodes to code entities
    // V_H nodes → resolve to grounded V_L descendants
    output ← []
    FOR (v, score) IN RankByScore(results):
        IF v ∈ V_H:
            // High-level node: resolve to Low-level code entities
            code_entities ← GetLeafDescendants(G, v, E_feature)
            output.append({
                feature: v.f,
                code_entities: code_entities,
                paths: [e.m.path FOR e IN code_entities]
            })
        ELSE:  // v ∈ V_L
            output.append({
                feature: v.f,
                code_entity: v,
                path: v.m.path,
                line_range: v.m.line_range
            })

    RETURN output
```

**Key Technique 1 --- Scope-restricted Subtree Pruning**

`search_scopes` restricts the search space to specific subtrees of the Functional Hierarchy. For example, if `search_scopes = ["Data Preprocessing"]`, only nodes within that subtree become search candidates. This is made possible by the Artifact Grounding phase (Phase 3), which assigns directory scopes to each `V_H` node via the LCA mechanism.

```
// Scope restriction via grounded hierarchy
"Data Preprocessing"  →  sklearn/preprocessing/
    ├── "Normalization"    →  sklearn/preprocessing/_data.py
    │       ├── StandardScaler (V_L)
    │       └── MinMaxScaler  (V_L)
    └── "Encoding"         →  sklearn/preprocessing/_encoders.py
            ├── OneHotEncoder (V_L)
            └── LabelEncoder  (V_L)

search_scopes = ["Data Preprocessing / Normalization"]
→ Candidates pruned to: {StandardScaler, MinMaxScaler}
```

**Key Technique 2 --- Semantic Feature Matching**

The paper does not prescribe a specific algorithm for `SemanticMatch`. Each node's semantic feature `f` is a behavioral description extracted by an LLM during encoding. The matching computes a semantic similarity between the user's intent and each node's feature:

```
// Abstract definition as described in the paper
SemanticMatch(intent, feature_f):
    // intent: "expression serialization" (user's search intent)
    // feature_f: "Serializes symbolic expressions to string format" (node's semantic description)
    → semantic similarity score
```

**Key Technique 3 --- V_H → V_L Resolution**

When a feature search returns a High-level node (`V_H`), that node itself holds no code. It must be resolved to its descendant Low-level nodes (`V_L`) by traversing `E_feature` edges downward to obtain concrete code entities.

##### Snippet Search: Symbol/Keyword → Code Retrieval

Snippet search retrieves concrete identifiers from **metadata `m`** and **raw source code**. Unlike feature search, this operates at the code level rather than the graph's semantic features.

```
FUNCTION SnippetSearch(G, search_terms, file_pattern, line_nums):
    results ← []

    FOR term IN search_terms:
        IF IsQualifiedEntity(term):  // e.g., "file.py:ClassName.method"
            // Parse qualified name and search metadata m
            (file, entity) ← ParseQualifiedName(term)
            node ← FindByMetadata(G, file=file, entity_name=entity)
            IF node:
                results.append(node)

        ELSE IF IsFilePath(term):
            // Direct file path lookup in graph metadata
            nodes ← {v ∈ V_L | v.m.path matches term}
            results.extend(nodes)

        ELSE:
            // Keyword search over entity names and code
            // Search metadata m.name, m.path
            matches ← {v ∈ V_L | term IN v.m.name OR term IN v.m.path}
            results.extend(matches)

    // Apply file pattern filter
    IF file_pattern:
        results ← {v ∈ results | v.m.path matches file_pattern}

    // Extract specific line range if requested
    IF line_nums:
        FOR v IN results:
            v.preview ← ExtractLines(v.m.path, line_nums[0], line_nums[1])

    RETURN results
```

##### Auto Mode: Unified Orchestration

`auto` mode chains both searches sequentially:

```
FUNCTION AutoSearch(G, feature_terms, search_terms, search_scopes, ...):
    // Phase 1: Feature mapping (semantic discovery)
    feature_results ← FeatureSearch(G, feature_terms, search_scopes)

    // Phase 2: Snippet search (if needed)
    IF feature_results is insufficient OR search_terms provided:
        // Augment with high-signal identifiers from Phase 1
        enriched_terms ← search_terms
        FOR r IN feature_results:
            enriched_terms ← enriched_terms ∪ {r.path, r.code_entity.m.name}

        snippet_results ← SnippetSearch(G, enriched_terms, ...)
    ELSE:
        snippet_results ← ∅

    RETURN Deduplicate(feature_results ∪ snippet_results)
```

**Key Technique 4 --- Feature-first, Snippet-second Strategy**

The core principle of `auto` mode is to **prioritize semantic grounding**. Feature search first establishes semantic anchors, then injects high-signal identifiers (file paths, entity names) derived from those results into the subsequent snippet search to improve precision. This strategy reduces noise from blind keyword search and prevents Redundant Search (T5) errors observed in the paper's error analysis.

### FetchNode

**Node-level data retrieval** for precision context and verification.

Given a node `v`, FetchNode extracts the attribute tuple `(f, m)` and raw source code, providing ground truth for inspection. This tool acts as a **verification step** after discovery --- ensuring the agent reasons on faithful code snippets rather than speculative guesses.

**Parameters:**

```json
{
  "tool_name": "FetchNode",
  "parameters": {
    "code_entities": "<List of validated code entities in the repository>",
    "feature_entities": "<List of validated feature paths in the repository>"
  }
}
```

**Returns:**
- Entity type (file/class/method/feature)
- Feature paths and code content (with source context/preview)
- Start/end lines and mapped feature information

**Feature path traversal**: FetchNode computes the complete feature path by traversing functional edges upward from the node to the root, producing paths like `Data Preprocessing / Normalization / StandardScaler`.

### ExploreRPG

**Cross-view traversal** along edges `E` for topological navigation.

While `E_dep` is constructed via static AST analysis, its integration with the semantic hierarchy in `V_H` provides a robust topological skeleton that guides the agent through complex execution flows without the noise of unstructured search.

**Parameters:**

```json
{
  "tool_name": "ExploreRPG",
  "parameters": {
    "start_code_entities": "<List of code entities (file paths, classes, functions)>",
    "start_feature_entities": "<List of feature paths>",
    "direction": "<'upstream' (dependencies) | 'downstream' (dependents) | 'both'>",
    "traversal_depth": "<Maximum traversal depth. Default: 2. Use -1 for unlimited.>",
    "entity_type_filter": "<'directory' | 'file' | 'class' | 'function' | 'method'>",
    "dependency_type_filter": "<'composes' | 'contains' | 'inherits' | 'invokes' | 'imports'>"
  }
}
```

**Returns:**
- Connected nodes and edges (code or feature view)
- Hints for invalid or fuzzy matches

**Edge types for traversal:**

| Edge Type | Direction | Use Case |
|-----------|-----------|----------|
| `invokes` | downstream | Trace call chains from a function |
| `imports` | upstream | Find module dependencies |
| `inherits` | upstream/downstream | Discover class hierarchies |
| `contains` | downstream | Navigate from file to classes/functions |
| `composes` | downstream | Explore composition relationships |

## Canonical Tool Orchestration

The tools follow a structured pipeline that prioritizes semantic grounding before reading large contexts:

```
1. Semantic Discovery     →  SearchNode (features/auto)
2. Precision Verification →  FetchNode
3. Local Expansion        →  ExploreRPG
4. Pinpoint Retrieval     →  SearchNode (snippets) [optional]
```

### Step 1: Semantic Discovery (SearchNode)

Convert the natural-language intent into concrete behavioral terms and retrieve candidate feature nodes and mapped code entities. Supply `search_scopes` to restrict discovery to the most relevant functional subtrees when available.

### Step 2: Precision Verification (FetchNode)

For top candidates, fetch exact code context (file path + line range + preview) and confirm semantic compatibility. Candidates that cannot be verified are discarded.

### Step 3: Local Expansion (ExploreRPG)

From verified anchors, traverse dependency edges (e.g., `invokes`, `imports`) to:
- Locate the root cause
- Map the impact surface
- Identify integration points

### Step 4: Pinpoint Retrieval (optional)

If the target remains ambiguous, run snippet search with high-signal identifiers obtained from previous steps (exact symbols, file paths, error strings), optionally extracting specific line ranges.

### Fallback Rules

- **Low recall from semantic discovery**: Fall back to `snippets` mode to bootstrap concrete anchors, then return to FetchNode and ExploreRPG.
- **Too many snippet matches**: Tighten constraints by adding (1) feature scopes, (2) file path patterns, or (3) symbol-qualified queries.

This policy minimizes wasted context and reduces hallucination risk: SearchNode provides intent-to-code grounding, FetchNode ensures the agent reasons on exact source, and ExploreRPG reveals topological structure that cannot be reliably inferred from local snippets alone.

## Agent Behavior: "Search-then-Zoom" Pattern

Empirical analysis across multiple LLMs reveals a universal **"Search-then-Zoom"** behavioral pattern:

1. Agents prioritize **broad topology traversal** (ExploreRPG, SearchNode) to establish a global map
2. Then narrow to **fine-grained analysis** (FetchNode) for localized implementation

This pattern is more pronounced in stronger reasoning models (e.g., Claude-4.5-Sonnet), which leverage RPG's structural context to support extended interaction horizons.

Tool usage distribution across models shows:
- **SearchNode** serves as a foundational tool for locating initial entry points
- **ExploreRPG** plays a critical role in the reasoning loop, especially for high-performing models
- Capable agents strategically employ ExploreRPG to leverage topological connections for holistic codebase understanding

## Dual-View Advantage

The dual-view structure of RPG mitigates navigational failures through two complementary access paths:

| View | Access Path | Addresses |
|------|-------------|-----------|
| **Semantic Features** | Broad global retrieval expanding search space | Insufficient Coverage (T3) |
| **Structural Hierarchy** | Guided navigation reducing redundant search | Redundant Search (T5) |

This multi-view navigation ensures agents can accurately localize intent before traversing implementation-level dependencies. Improved localization also reduces downstream errors in Context & Scope, keeping reasoning grounded in correct implementation units.

### Ablation Evidence

Removing either view degrades performance:

| Setting | File Acc@1 | Func Acc@5 | Avg Steps | Cost |
|---------|-----------|-----------|-----------|------|
| **Full RPG** | **69.2%** | **69.4%** | **8.22** | **$0.20** |
| w/o Dependency | 58.4% | 66.3% | 8.53 | $0.27 |
| w/o Feature | 60.9% | 63.4% | 9.23 | $0.30 |

*Results on SWE-bench Live with GPT-4o*

- **Removing features** causes the sharpest decline in function-level accuracy (50.5% → 43.1% Acc@1), as the agent loses intent-based retrieval and falls into trial-and-error loops.
- **Removing dependencies** primarily inflates token cost (+$0.09 on GPT-4.1), as the agent must manually traverse the file system to deduce logical connections.

## Efficiency

RPG-guided navigation concentrates reasoning resources on relevant code regions, reducing redundant API calls:

| Method | Steps (GPT-4.1) | Cost (GPT-4.1) | Efficiency |
|--------|-----------------|-----------------|------------|
| OrcaLoca | 20.22 | $0.46 | 1.48 |
| CoSIL | 19.77 | $0.24 | 3.10 |
| LocAgent | 11.94 | $0.86 | 0.76 |
| **RPG-Encoder** | **6.75** | **$0.18** | **4.63** |

*Efficiency = Acc@5 / Cost. SWE-bench Verified.*

RPG-Encoder achieves the fewest steps, lowest cost, and highest cost-effectiveness across all backbone models.

## Implementation: GraphStore Architecture

This section documents the storage layer that backs the RPG Operation tools.

### Design Decision

The RPG graph operations (node CRUD, edge traversal, feature search, topological sort) do not require graphology's advanced algorithms. We define a `GraphStore` interface and provide two implementations for evaluation:

| | SQLite (bun:sqlite) | SurrealDB (surrealkv) |
|---|---|---|
| **Graph model** | Relational (tables + recursive CTEs) | Native graph (record links + `->` traversal) |
| **Full-text search** | FTS5 with BM25 | Built-in BM25 `@@` operator |
| **Dependencies** | None (Bun built-in) | `surrealdb` + `@surrealdb/node` |
| **Persistence** | Single `.db` file | SurrealKV directory |
| **Git sharing** | `.db` file (git-lfs) | Directory (git-lfs) |

### GraphStore Interface

```typescript
interface GraphStore {
  // Lifecycle
  open(path: string): Promise<void>
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

### SQLite: Feature Search with Scope Restriction

```sql
-- SearchNode features mode with search_scopes
WITH RECURSIVE subtree AS (
    SELECT id FROM nodes WHERE id = :scope_root
    UNION ALL
    SELECT e.target FROM edges e
    JOIN subtree s ON e.source = s.id
    WHERE e.type = 'functional'
)
SELECT n.id, n.feature_description, n.path, rank
FROM nodes_fts
JOIN nodes n ON nodes_fts.rowid = n.rowid
WHERE nodes_fts MATCH :query
  AND n.id IN (SELECT id FROM subtree)
ORDER BY rank;
```

### SQLite: ExploreRPG Traversal

```sql
-- Downstream traversal along dependency edges, depth=3
WITH RECURSIVE traversal AS (
    SELECT target AS node_id, 1 AS depth, dep_type
    FROM edges
    WHERE source = :start AND type = 'dependency'
    UNION ALL
    SELECT e.target, t.depth + 1, e.dep_type
    FROM edges e
    JOIN traversal t ON e.source = t.node_id
    WHERE e.type = 'dependency' AND t.depth < :max_depth
)
SELECT DISTINCT n.*, t.depth, t.dep_type
FROM traversal t
JOIN nodes n ON n.id = t.node_id;
```

### SurrealDB: Feature Search

```surql
-- SearchNode features mode with BM25
SELECT *, search::score(1) AS score
FROM node
WHERE feature_description @1@ $query
ORDER BY score DESC;
```

### SurrealDB: ExploreRPG Traversal

```surql
-- Downstream traversal along dependency edges
SELECT ->dependency.{1,3}->(node AS n).*
FROM ONLY node:start;
```

### SurrealDB: Children / Parent

```surql
-- Get children via functional edges
SELECT <-functional<-node.* FROM ONLY node:parent;

-- Get parent via functional edge
SELECT ->functional->node.* FROM ONLY node:child;
```

### Tool Mapping

| RPG Operation | GraphStore Method | SQLite | SurrealDB |
|---|---|---|---|
| SearchNode `features` | `searchByFeature()` | FTS5 MATCH + rank | `@@ ` BM25 |
| SearchNode `snippets` | `searchByPath()` | FTS5 on path column | `@@` on path field |
| SearchNode `search_scopes` | `searchByFeature(q, scopes)` | Recursive CTE + FTS5 | Graph filter |
| FetchNode | `getNode()` | `SELECT WHERE id=?` | `SELECT FROM node:id` |
| FetchNode path | `getParent()` chain | Recursive CTE upward | `->functional->node` |
| ExploreRPG | `traverse()` | Recursive CTE | `->edge.{1,N}->node` |
| Evolution insert | `addNode()` + `addEdge()` | `INSERT` in transaction | `CREATE` in transaction |
| Evolution delete | `removeNode()` | `DELETE CASCADE` | `DELETE node:id` |
| Evolution modify | `updateNode()` | `UPDATE` | `UPDATE node:id` |

## References

- RPG-Encoder: arXiv:2602.02084
- RPG-ZeroRepo: arXiv:2509.16198
