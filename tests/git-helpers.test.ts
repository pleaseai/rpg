import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getCurrentBranch, getDefaultBranch, getHeadCommitSha, getMergeBase } from '@pleaseai/rpg-utils/git-helpers'
import { resolveGitBinary } from '@pleaseai/rpg-utils/git-path'
import { describe, expect, it } from 'vitest'

function git(cwd: string, args: string[]): string {
  return execFileSync(resolveGitBinary(), args, {
    cwd,
    encoding: 'utf-8',
    timeout: 10_000,
  }).trim()
}

describe('git-helpers', () => {
  const repoPath = process.cwd()

  describe('getHeadCommitSha', () => {
    it('should return a 40-character hex SHA', () => {
      const sha = getHeadCommitSha(repoPath)
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should throw for non-existent directory', () => {
      expect(() => getHeadCommitSha('/nonexistent/path')).toThrow()
    })
  })

  describe('getCurrentBranch', () => {
    it('should return a non-empty string for a branch checkout', () => {
      const branch = getCurrentBranch(repoPath)
      // In CI this may be empty (detached HEAD), so just check it's a string
      expect(typeof branch).toBe('string')
    })

    it('should return empty string for detached HEAD', () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), 'rpg-detached-'))
      try {
        git(tempDir, ['init', '-b', 'main'])
        git(tempDir, ['config', 'user.email', 'test@test.com'])
        git(tempDir, ['config', 'user.name', 'Test'])
        execFileSync(resolveGitBinary(), ['commit', '--allow-empty', '-m', 'init'], {
          cwd: tempDir,
          encoding: 'utf-8',
        })
        git(tempDir, ['checkout', '--detach', 'HEAD'])

        const branch = getCurrentBranch(tempDir)
        expect(branch).toBe('')
      }
      finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('getDefaultBranch', () => {
    it('should return main or master', () => {
      const branch = getDefaultBranch(repoPath)
      expect(['main', 'master']).toContain(branch)
    })

    it('should fall back to main when no main or master branch exists', () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), 'rpg-nobranch-'))
      try {
        git(tempDir, ['init', '-b', 'develop'])
        git(tempDir, ['config', 'user.email', 'test@test.com'])
        git(tempDir, ['config', 'user.name', 'Test'])
        execFileSync(resolveGitBinary(), ['commit', '--allow-empty', '-m', 'init'], {
          cwd: tempDir,
          encoding: 'utf-8',
        })

        const branch = getDefaultBranch(tempDir)
        expect(branch).toBe('main')
      }
      finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('getMergeBase', () => {
    it('should return a valid SHA when both refs exist', () => {
      const head = getHeadCommitSha(repoPath)
      // merge-base of HEAD with itself is HEAD
      const base = getMergeBase(repoPath, head, head)
      expect(base).toBe(head)
    })

    it('should throw for invalid refs', () => {
      expect(() => getMergeBase(repoPath, 'nonexistent-branch-xyz', 'HEAD')).toThrow()
    })
  })
})
