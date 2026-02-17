import type { CallSite, InheritanceRelation } from '@pleaseai/rpg-encoder'
import { SymbolResolver } from '@pleaseai/rpg-encoder'
import { describe, expect, it } from 'vitest'

describe('SymbolResolver', () => {
  describe('buildSymbolTable', () => {
    it('builds symbol table from files with entities', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/utils.ts',
          parseResult: {
            language: 'typescript',
            entities: [
              { name: 'formatDate', type: 'function' },
              { name: 'parseJson', type: 'function' },
            ],
            imports: [],
            errors: [],
          },
          entities: [
            { name: 'formatDate', type: 'function' },
            { name: 'parseJson', type: 'function' },
          ],
        },
      ]

      resolver.buildSymbolTable(files)
      // Should not throw
      expect(resolver).toBeDefined()
    })

    it('builds symbol table with import statements', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/main.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'main', type: 'function' }],
            imports: [{ module: './utils', names: ['formatDate', 'parseJson'] }],
            errors: [],
          },
          entities: [{ name: 'main', type: 'function' }],
        },
      ]

      resolver.buildSymbolTable(files)
      expect(resolver).toBeDefined()
    })

    it('handles multiple files with exports and imports', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/utils.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'helper', type: 'function' }],
            imports: [],
            errors: [],
          },
          entities: [{ name: 'helper', type: 'function' }],
        },
        {
          filePath: 'src/main.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'app', type: 'class' }],
            imports: [{ module: './utils', names: ['helper'] }],
            errors: [],
          },
          entities: [{ name: 'app', type: 'class' }],
        },
      ]

      resolver.buildSymbolTable(files)
      expect(resolver).toBeDefined()
    })
  })

  describe('resolveCall', () => {
    it('resolves call to imported symbol', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/utils.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'formatDate', type: 'function' }],
            imports: [],
            errors: [],
          },
          entities: [{ name: 'formatDate', type: 'function' }],
        },
        {
          filePath: 'src/main.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'main', type: 'function' }],
            imports: [{ module: './utils', names: ['formatDate'] }],
            errors: [],
          },
          entities: [{ name: 'main', type: 'function' }],
        },
      ]

      resolver.buildSymbolTable(files)

      const call: CallSite = {
        callerFile: 'src/main.ts',
        calleeSymbol: 'formatDate',
      }

      const knownFiles = new Set(['src/utils.ts', 'src/main.ts'])
      const resolved = resolver.resolveCall(call, knownFiles)

      expect(resolved).toBeDefined()
      expect(resolved?.sourceFile).toBe('src/main.ts')
      expect(resolved?.targetFile).toBe('src/utils.ts')
      expect(resolved?.targetSymbol).toBe('formatDate')
    })

    it('resolves call to symbol in same file', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/main.ts',
          parseResult: {
            language: 'typescript',
            entities: [
              { name: 'helper', type: 'function' },
              { name: 'main', type: 'function' },
            ],
            imports: [],
            errors: [],
          },
          entities: [
            { name: 'helper', type: 'function' },
            { name: 'main', type: 'function' },
          ],
        },
      ]

      resolver.buildSymbolTable(files)

      const call: CallSite = {
        callerFile: 'src/main.ts',
        calleeSymbol: 'helper',
      }

      const knownFiles = new Set(['src/main.ts'])
      const resolved = resolver.resolveCall(call, knownFiles)

      expect(resolved).toBeDefined()
      expect(resolved?.sourceFile).toBe('src/main.ts')
      expect(resolved?.targetFile).toBe('src/main.ts')
      expect(resolved?.targetSymbol).toBe('helper')
    })

    it('returns null for unresolvable symbol', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/main.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'main', type: 'function' }],
            imports: [],
            errors: [],
          },
          entities: [{ name: 'main', type: 'function' }],
        },
      ]

      resolver.buildSymbolTable(files)

      const call: CallSite = {
        callerFile: 'src/main.ts',
        calleeSymbol: 'unknownFunction',
      }

      const knownFiles = new Set(['src/main.ts'])
      const resolved = resolver.resolveCall(call, knownFiles)

      expect(resolved).toBeNull()
    })

    it('includes optional line number in resolved call', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/utils.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'foo', type: 'function' }],
            imports: [],
            errors: [],
          },
          entities: [{ name: 'foo', type: 'function' }],
        },
        {
          filePath: 'src/main.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'main', type: 'function' }],
            imports: [{ module: './utils', names: ['foo'] }],
            errors: [],
          },
          entities: [{ name: 'main', type: 'function' }],
        },
      ]

      resolver.buildSymbolTable(files)

      const call: CallSite = {
        callerFile: 'src/main.ts',
        calleeSymbol: 'foo',
        line: 42,
      }

      const knownFiles = new Set(['src/utils.ts', 'src/main.ts'])
      const resolved = resolver.resolveCall(call, knownFiles)

      expect(resolved?.line).toBe(42)
    })

    it('includes caller entity in resolved call', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/utils.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'helper', type: 'function' }],
            imports: [],
            errors: [],
          },
          entities: [{ name: 'helper', type: 'function' }],
        },
        {
          filePath: 'src/app.ts',
          parseResult: {
            language: 'typescript',
            entities: [
              { name: 'App', type: 'class' },
              { name: 'App.method', type: 'method' },
            ],
            imports: [{ module: './utils', names: ['helper'] }],
            errors: [],
          },
          entities: [
            { name: 'App', type: 'class' },
            { name: 'App.method', type: 'method' },
          ],
        },
      ]

      resolver.buildSymbolTable(files)

      const call: CallSite = {
        callerFile: 'src/app.ts',
        callerEntity: 'App.method',
        calleeSymbol: 'helper',
      }

      const knownFiles = new Set(['src/utils.ts', 'src/app.ts'])
      const resolved = resolver.resolveCall(call, knownFiles)

      expect(resolved?.sourceEntity).toBe('App.method')
    })
  })

  describe('resolveInheritance', () => {
    it('resolves inheritance to imported parent class', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/base.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'BaseClass', type: 'class' }],
            imports: [],
            errors: [],
          },
          entities: [{ name: 'BaseClass', type: 'class' }],
        },
        {
          filePath: 'src/derived.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'DerivedClass', type: 'class' }],
            imports: [{ module: './base', names: ['BaseClass'] }],
            errors: [],
          },
          entities: [{ name: 'DerivedClass', type: 'class' }],
        },
      ]

      resolver.buildSymbolTable(files)

      const relation: InheritanceRelation = {
        childFile: 'src/derived.ts',
        childClass: 'DerivedClass',
        parentClass: 'BaseClass',
        kind: 'inherit',
      }

      const knownFiles = new Set(['src/base.ts', 'src/derived.ts'])
      const resolved = resolver.resolveInheritance(relation, knownFiles)

      expect(resolved).toBeDefined()
      expect(resolved?.childFile).toBe('src/derived.ts')
      expect(resolved?.childClass).toBe('DerivedClass')
      expect(resolved?.parentFile).toBe('src/base.ts')
      expect(resolved?.parentClass).toBe('BaseClass')
      expect(resolved?.kind).toBe('inherit')
    })

    it('resolves inheritance to parent in same file', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/classes.ts',
          parseResult: {
            language: 'typescript',
            entities: [
              { name: 'BaseClass', type: 'class' },
              { name: 'DerivedClass', type: 'class' },
            ],
            imports: [],
            errors: [],
          },
          entities: [
            { name: 'BaseClass', type: 'class' },
            { name: 'DerivedClass', type: 'class' },
          ],
        },
      ]

      resolver.buildSymbolTable(files)

      const relation: InheritanceRelation = {
        childFile: 'src/classes.ts',
        childClass: 'DerivedClass',
        parentClass: 'BaseClass',
        kind: 'inherit',
      }

      const knownFiles = new Set(['src/classes.ts'])
      const resolved = resolver.resolveInheritance(relation, knownFiles)

      expect(resolved).toBeDefined()
      expect(resolved?.parentFile).toBe('src/classes.ts')
    })

    it('returns null for unresolvable parent class', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/derived.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'DerivedClass', type: 'class' }],
            imports: [],
            errors: [],
          },
          entities: [{ name: 'DerivedClass', type: 'class' }],
        },
      ]

      resolver.buildSymbolTable(files)

      const relation: InheritanceRelation = {
        childFile: 'src/derived.ts',
        childClass: 'DerivedClass',
        parentClass: 'UnknownBase',
        kind: 'inherit',
      }

      const knownFiles = new Set(['src/derived.ts'])
      const resolved = resolver.resolveInheritance(relation, knownFiles)

      expect(resolved).toBeNull()
    })

    it('preserves implement kind in resolved inheritance', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/interface.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'MyInterface', type: 'interface' }],
            imports: [],
            errors: [],
          },
          entities: [{ name: 'MyInterface', type: 'interface' }],
        },
        {
          filePath: 'src/impl.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'MyClass', type: 'class' }],
            imports: [{ module: './interface', names: ['MyInterface'] }],
            errors: [],
          },
          entities: [{ name: 'MyClass', type: 'class' }],
        },
      ]

      resolver.buildSymbolTable(files)

      const relation: InheritanceRelation = {
        childFile: 'src/impl.ts',
        childClass: 'MyClass',
        parentClass: 'MyInterface',
        kind: 'implement',
      }

      const knownFiles = new Set(['src/interface.ts', 'src/impl.ts'])
      const resolved = resolver.resolveInheritance(relation, knownFiles)

      expect(resolved?.kind).toBe('implement')
    })
  })

  describe('resolveAllCalls', () => {
    it('batch resolves multiple calls', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/utils.ts',
          parseResult: {
            language: 'typescript',
            entities: [
              { name: 'foo', type: 'function' },
              { name: 'bar', type: 'function' },
            ],
            imports: [],
            errors: [],
          },
          entities: [
            { name: 'foo', type: 'function' },
            { name: 'bar', type: 'function' },
          ],
        },
        {
          filePath: 'src/main.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'main', type: 'function' }],
            imports: [{ module: './utils', names: ['foo', 'bar'] }],
            errors: [],
          },
          entities: [{ name: 'main', type: 'function' }],
        },
      ]

      resolver.buildSymbolTable(files)

      const calls: CallSite[] = [
        { callerFile: 'src/main.ts', calleeSymbol: 'foo' },
        { callerFile: 'src/main.ts', calleeSymbol: 'bar' },
      ]

      const knownFiles = new Set(['src/utils.ts', 'src/main.ts'])
      const resolved = resolver.resolveAllCalls(calls, knownFiles)

      expect(resolved).toHaveLength(2)
      expect(resolved[0].targetFile).toBe('src/utils.ts')
      expect(resolved[1].targetFile).toBe('src/utils.ts')
    })

    it('skips unresolvable calls', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/main.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'main', type: 'function' }],
            imports: [],
            errors: [],
          },
          entities: [{ name: 'main', type: 'function' }],
        },
      ]

      resolver.buildSymbolTable(files)

      const calls: CallSite[] = [
        { callerFile: 'src/main.ts', calleeSymbol: 'foo' },
        { callerFile: 'src/main.ts', calleeSymbol: 'bar' },
      ]

      const knownFiles = new Set(['src/main.ts'])
      const resolved = resolver.resolveAllCalls(calls, knownFiles)

      expect(resolved).toHaveLength(0)
    })
  })

  describe('resolveAllInheritances', () => {
    it('batch resolves multiple inheritance relations', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/base.ts',
          parseResult: {
            language: 'typescript',
            entities: [
              { name: 'BaseA', type: 'class' },
              { name: 'BaseB', type: 'class' },
            ],
            imports: [],
            errors: [],
          },
          entities: [
            { name: 'BaseA', type: 'class' },
            { name: 'BaseB', type: 'class' },
          ],
        },
        {
          filePath: 'src/derived.ts',
          parseResult: {
            language: 'typescript',
            entities: [
              { name: 'DerivedA', type: 'class' },
              { name: 'DerivedB', type: 'class' },
            ],
            imports: [{ module: './base', names: ['BaseA', 'BaseB'] }],
            errors: [],
          },
          entities: [
            { name: 'DerivedA', type: 'class' },
            { name: 'DerivedB', type: 'class' },
          ],
        },
      ]

      resolver.buildSymbolTable(files)

      const relations: InheritanceRelation[] = [
        {
          childFile: 'src/derived.ts',
          childClass: 'DerivedA',
          parentClass: 'BaseA',
          kind: 'inherit',
        },
        {
          childFile: 'src/derived.ts',
          childClass: 'DerivedB',
          parentClass: 'BaseB',
          kind: 'inherit',
        },
      ]

      const knownFiles = new Set(['src/base.ts', 'src/derived.ts'])
      const resolved = resolver.resolveAllInheritances(relations, knownFiles)

      expect(resolved).toHaveLength(2)
      expect(resolved[0].parentFile).toBe('src/base.ts')
      expect(resolved[1].parentFile).toBe('src/base.ts')
    })

    it('skips unresolvable inheritances', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/derived.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'DerivedA', type: 'class' }],
            imports: [],
            errors: [],
          },
          entities: [{ name: 'DerivedA', type: 'class' }],
        },
      ]

      resolver.buildSymbolTable(files)

      const relations: InheritanceRelation[] = [
        {
          childFile: 'src/derived.ts',
          childClass: 'DerivedA',
          parentClass: 'UnknownBase',
          kind: 'inherit',
        },
      ]

      const knownFiles = new Set(['src/derived.ts'])
      const resolved = resolver.resolveAllInheritances(relations, knownFiles)

      expect(resolved).toHaveLength(0)
    })
  })

  describe('fuzzy matching fallback', () => {
    it('attempts case-insensitive matching when exact match fails', () => {
      const resolver = new SymbolResolver()

      const files = [
        {
          filePath: 'src/utils.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'formatDate', type: 'function' }],
            imports: [],
            errors: [],
          },
          entities: [{ name: 'formatDate', type: 'function' }],
        },
        {
          filePath: 'src/main.ts',
          parseResult: {
            language: 'typescript',
            entities: [{ name: 'main', type: 'function' }],
            imports: [{ module: './utils', names: ['formatDate'] }],
            errors: [],
          },
          entities: [{ name: 'main', type: 'function' }],
        },
      ]

      resolver.buildSymbolTable(files)

      // Request with different case - should still match via fuzzy matching
      const call: CallSite = {
        callerFile: 'src/main.ts',
        calleeSymbol: 'FormatDate', // Different case
      }

      const knownFiles = new Set(['src/utils.ts', 'src/main.ts'])
      const resolved = resolver.resolveCall(call, knownFiles)

      // Fuzzy matching should resolve via case-insensitive lookup
      expect(resolved).toBeDefined()
      expect(resolved?.targetFile).toBe('src/utils.ts')
      expect(resolved?.targetSymbol).toBe('FormatDate') // Original symbol preserved
    })
  })
})
