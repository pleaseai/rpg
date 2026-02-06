import type { FileFeatureGroup } from './types'

/**
 * Format file feature groups into a condensed text view for LLM input.
 *
 * For each group label, lists file descriptions — this is the paper's
 * "granularity-based input compression" that allows the complete repository
 * to fit in context.
 */
export function formatFileGroups(fileGroups: FileFeatureGroup[]): string {
  return fileGroups
    .map((group) => {
      const fileList = group.fileFeatures
        .map(f => `  - ${f.filePath}: ${f.description}`)
        .join('\n')
      return `[${group.groupLabel}]\n${fileList}`
    })
    .join('\n\n')
}

/**
 * Domain Discovery prompt — from paper §3.2 Step 1 (Functional Abstraction).
 *
 * Faithfully translated from prompts/domain_discovery.tex.
 */
export function buildDomainDiscoveryPrompt(fileGroups: FileFeatureGroup[]): {
  system: string
  user: string
} {
  const formattedGroups = formatFileGroups(fileGroups)

  const system = `You are an expert software architect and repository analyst.
Your goal is to identify the high-level functional areas of a software repository by analyzing file-level semantic features.

## Guidelines
1. Think from an architecture perspective — identify broad functional domains, not individual files.
2. Each functional area should represent a cohesive set of responsibilities (e.g., "DataProcessing", "UserInterface", "Authentication").
3. Use PascalCase for functional area names (e.g., "GraphStorage", "SemanticAnalysis").
4. Aim for 3-8 functional areas depending on repository size.
5. Avoid creating areas that map 1:1 to directories — the goal is semantic reorganization.
6. Exclude test/docs/vendor directories from the analysis.

## Output Format
Wrap your answer in <solution> tags containing a JSON array of functional area names.

Example:
<solution>
["DataProcessing", "UserInterface", "Authentication", "Configuration"]
</solution>`

  const user = `Analyze the following repository file features and identify the high-level functional areas.

## Repository File Features (grouped by top-level directory)

${formattedGroups}

Identify the functional areas of this repository. Return ONLY the functional area names as a JSON array in <solution> tags.`

  return { system, user }
}

/**
 * Hierarchical Construction prompt — from paper §3.2 Step 2 (Hierarchical Aggregation).
 *
 * Faithfully translated from prompts/hierarchical_construction.tex.
 */
export function buildHierarchicalConstructionPrompt(
  functionalAreas: string[],
  fileGroups: FileFeatureGroup[],
): {
  system: string
  user: string
} {
  const formattedGroups = formatFileGroups(fileGroups)
  const areasStr = functionalAreas.map(a => `- ${a}`).join('\n')

  const system = `You are an expert repository refactoring specialist.
Your goal is to reorganize file groups into a semantic 3-level hierarchy using the discovered functional areas.

## Hierarchy Format
Each path must have EXACTLY 3 levels: <functional_area>/<category>/<subcategory>

## Semantic Naming Rules
1. Category and subcategory names use lowercase verb+object format (e.g., "pipeline orchestration", "task scheduling").
2. Each level represents a single responsibility.
3. Names should be descriptive and semantic, not mirror directory names.

## Assignment Rules
1. Assign each top-level group (directory) to exactly one 3-level path.
2. Multiple groups can share the same path if they serve the same semantic purpose.
3. Only assign groups from the provided list — do not invent new groups.
4. Exclude docs, tests, and vendor directories.
5. Every non-excluded group must be assigned to a path.

## Output Format
Wrap your answer in <solution> tags containing a JSON object mapping 3-level paths to arrays of group labels.

Example:
<solution>
{
  "DataProcessing/pipeline orchestration/task scheduling": ["data_loader", "scheduler"],
  "DataProcessing/data transformation/format conversion": ["converter"],
  "UserInterface/component rendering/layout management": ["ui", "layout"]
}
</solution>`

  const user = `Reorganize the following file groups into a 3-level semantic hierarchy.

## Discovered Functional Areas
${areasStr}

## File Groups (grouped by top-level directory)

${formattedGroups}

Assign each group to a 3-level path (<functional_area>/<category>/<subcategory>). Return ONLY the mapping as a JSON object in <solution> tags.`

  return { system, user }
}

/**
 * Parse content from <solution>...</solution> tags and return as parsed JSON.
 *
 * Both prompts use the paper's <solution> wrapper format.
 */
export function parseSolutionTag<T>(response: string): T {
  const match = response.match(/<solution>\s*([\s\S]*?)\s*<\/solution>/)
  if (!match?.[1]) {
    throw new Error('No <solution> tag found in LLM response')
  }
  return JSON.parse(match[1]) as T
}
