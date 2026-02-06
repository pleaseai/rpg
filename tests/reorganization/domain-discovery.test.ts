import type { FileFeatureGroup } from '../../src/encoder/reorganization'
import type { LLMResponse } from '../../src/utils/llm'
import { describe, expect, it, vi } from 'vitest'
import { DomainDiscovery } from '../../src/encoder/reorganization/domain-discovery'

function createMockLLMClient(responseContent: string) {
  return {
    complete: vi.fn().mockResolvedValue({
      content: responseContent,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      model: 'test-model',
    } satisfies LLMResponse),
    completeJSON: vi.fn(),
    getProvider: vi.fn().mockReturnValue('google'),
    getModel: vi.fn().mockReturnValue('test-model'),
  }
}

const sampleFileGroups: FileFeatureGroup[] = [
  {
    groupLabel: 'src/auth',
    fileFeatures: [
      {
        fileId: 'auth/login.ts:file',
        filePath: 'src/auth/login.ts',
        description: 'authenticate user credentials',
        keywords: ['auth', 'login'],
      },
      {
        fileId: 'auth/token.ts:file',
        filePath: 'src/auth/token.ts',
        description: 'manage JWT tokens',
        keywords: ['auth', 'token'],
      },
    ],
  },
  {
    groupLabel: 'src/db',
    fileFeatures: [
      {
        fileId: 'db/query.ts:file',
        filePath: 'src/db/query.ts',
        description: 'execute database queries',
        keywords: ['db', 'query'],
      },
    ],
  },
  {
    groupLabel: 'src/api',
    fileFeatures: [
      {
        fileId: 'api/routes.ts:file',
        filePath: 'src/api/routes.ts',
        description: 'define API routes',
        keywords: ['api', 'routes'],
      },
    ],
  },
]

describe('domainDiscovery', () => {
  it('returns correct PascalCase functional areas', async () => {
    const mockClient = createMockLLMClient(
      '<solution>\n["Authentication", "DataAccess", "ApiManagement"]\n</solution>',
    )

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(sampleFileGroups)

    expect(result.functionalAreas).toEqual(['Authentication', 'DataAccess', 'ApiManagement'])
    expect(mockClient.complete).toHaveBeenCalledOnce()
  })

  it('normalizes non-PascalCase names', async () => {
    const mockClient = createMockLLMClient(
      '<solution>\n["data processing", "user_authentication", "apiManagement"]\n</solution>',
    )

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(sampleFileGroups)

    expect(result.functionalAreas).toEqual([
      'DataProcessing',
      'UserAuthentication',
      'ApiManagement',
    ])
  })

  it('deduplicates functional areas', async () => {
    const mockClient = createMockLLMClient(
      '<solution>\n["Authentication", "Authentication", "DataAccess"]\n</solution>',
    )

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(sampleFileGroups)

    expect(result.functionalAreas).toEqual(['Authentication', 'DataAccess'])
  })

  it('handles single functional area', async () => {
    const mockClient = createMockLLMClient('<solution>\n["CoreEngine"]\n</solution>')

    const singleGroup: FileFeatureGroup[] = [
      {
        groupLabel: 'src',
        fileFeatures: [
          {
            fileId: 'src/main.ts:file',
            filePath: 'src/main.ts',
            description: 'application entry point',
            keywords: ['main'],
          },
        ],
      },
    ]

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(singleGroup)

    expect(result.functionalAreas).toEqual(['CoreEngine'])
  })

  it('retries on malformed response (no solution tags)', async () => {
    const mockClient = createMockLLMClient('Just some text without tags')
    // Second call returns valid response
    mockClient.complete
      .mockResolvedValueOnce({
        content: 'Just some text without tags',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: 'test-model',
      })
      .mockResolvedValueOnce({
        content: '<solution>\n["Authentication"]\n</solution>',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: 'test-model',
      })

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(sampleFileGroups)

    expect(result.functionalAreas).toEqual(['Authentication'])
    expect(mockClient.complete).toHaveBeenCalledTimes(2)
  })

  it('throws when LLM returns no valid areas', async () => {
    const mockClient = createMockLLMClient('<solution>\n[]\n</solution>')

    const discovery = new DomainDiscovery(mockClient as any)
    await expect(discovery.discover(sampleFileGroups)).rejects.toThrow('no valid functional areas')
  })

  it('throws when LLM call fails', async () => {
    const mockClient = createMockLLMClient('')
    mockClient.complete.mockRejectedValue(new Error('API rate limit'))

    const discovery = new DomainDiscovery(mockClient as any)
    await expect(discovery.discover(sampleFileGroups)).rejects.toThrow(
      'Domain Discovery LLM call failed',
    )
  })

  it('sanitizes non-alphanumeric characters in area names', async () => {
    const mockClient = createMockLLMClient(
      '<solution>\n["Data/Processing", "user.name", "___"]\n</solution>',
    )

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(sampleFileGroups)

    // "Data/Processing" → "DataProcessing", "user.name" → "UserName", "___" → empty → filtered
    expect(result.functionalAreas).toEqual(['DataProcessing', 'UserName'])
  })

  it('filters out empty strings from areas', async () => {
    const mockClient = createMockLLMClient(
      '<solution>\n["Authentication", "", "  ", "DataAccess"]\n</solution>',
    )

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(sampleFileGroups)

    expect(result.functionalAreas).toEqual(['Authentication', 'DataAccess'])
  })
})
