import { execFileSync } from 'node:child_process'
import { createLogger } from '@pleaseai/rpg-utils/logger'
import { resolveGitBinary } from './git-path'

const log = createLogger('git-helpers')

/**
 * Execute a git command and return trimmed stdout.
 */
function git(repoPath: string, args: string[]): string {
  const gitBin = resolveGitBinary()
  return execFileSync(gitBin, args, {
    cwd: repoPath,
    encoding: 'utf-8',
    timeout: 10_000,
  }).trim()
}

/**
 * Get the current HEAD commit SHA.
 */
export function getHeadCommitSha(repoPath: string): string {
  return git(repoPath, ['rev-parse', 'HEAD'])
}

/**
 * Compute the merge-base (common ancestor) of two branches.
 */
export function getMergeBase(repoPath: string, branch1: string, branch2: string): string {
  return git(repoPath, ['merge-base', branch1, branch2])
}

/**
 * Get the current branch name (empty string if detached HEAD).
 * Re-throws non-detached-HEAD errors to avoid masking real failures.
 */
export function getCurrentBranch(repoPath: string): string {
  try {
    return git(repoPath, ['symbolic-ref', '--short', 'HEAD'])
  }
  catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('not a symbolic ref')) {
      return ''
    }
    throw error
  }
}

/**
 * Get the default branch name (main or master).
 */
export function getDefaultBranch(repoPath: string): string {
  resolveGitBinary() // Let "git not found" propagate before entering catch blocks
  try {
    // Check remote HEAD reference
    const ref = git(repoPath, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
    return ref.replace('refs/remotes/origin/', '')
  }
  catch {
    // Fallback: check if main or master exists locally
    try {
      git(repoPath, ['rev-parse', '--verify', 'main'])
      return 'main'
    }
    catch {
      try {
        git(repoPath, ['rev-parse', '--verify', 'master'])
        return 'master'
      }
      catch {
        log.warn('Could not detect default branch (no remote HEAD, no local main/master). Defaulting to "main".')
        return 'main'
      }
    }
  }
}
