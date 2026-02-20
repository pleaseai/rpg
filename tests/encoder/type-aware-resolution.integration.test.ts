import type { EntityNode, InheritanceRelation } from '@pleaseai/rpg-encoder/dependency-graph'
import { CallExtractor } from '@pleaseai/rpg-encoder/call-extractor'
import { TypeInferrer } from '@pleaseai/rpg-encoder/type-inferrer'
import { describe, expect, it } from 'vitest'

/**
 * Integration tests for type-aware call resolution.
 *
 * These tests verify that the TypeInferrer correctly resolves receiver types
 * through the CallExtractor → TypeInferrer pipeline, simulating the
 * dependency-injection.ts Phase 4 behavior without requiring a full RPG.
 */
describe('Type-aware call resolution integration', () => {
  const callExtractor = new CallExtractor()

  describe('self.method() resolves through inheritance chain', () => {
    it('Python: self.method() resolves to current class', () => {
      const code = `
class Dog:
    def speak(self):
        pass
    def run(self):
        self.speak()
`
      const entities: EntityNode[] = [
        { className: 'Dog', methods: ['speak', 'run'] },
      ]
      const inheritances: InheritanceRelation[] = []
      const inferrer = new TypeInferrer(entities, inheritances)

      const calls = callExtractor.extract(code, 'python', 'dog.py')
      const speakCall = calls.find(c => c.calleeSymbol === 'speak' && c.receiverKind === 'self')

      expect(speakCall).toBeDefined()
      const qualifiedName = inferrer.resolveQualifiedCall(speakCall!, code, 'python')
      expect(qualifiedName).toBe('Dog.speak')
    })

    it('Python: self.method() resolves to parent class through MRO', () => {
      const code = `
class Dog(Animal):
    def fetch(self):
        self.move()
`
      const entities: EntityNode[] = [
        { className: 'Animal', methods: ['speak', 'move'] },
        { className: 'Dog', methods: ['fetch'] },
      ]
      const inheritances: InheritanceRelation[] = [
        { childFile: 'dog.py', childClass: 'Dog', parentClass: 'Animal', kind: 'inherit' },
      ]
      const inferrer = new TypeInferrer(entities, inheritances)

      const calls = callExtractor.extract(code, 'python', 'dog.py')
      const moveCall = calls.find(c => c.calleeSymbol === 'move' && c.receiverKind === 'self')

      expect(moveCall).toBeDefined()
      const qualifiedName = inferrer.resolveQualifiedCall(moveCall!, code, 'python')
      expect(qualifiedName).toBe('Animal.move')
    })

    it('TypeScript: this.method() resolves to current class', () => {
      const code = `
class Service {
  process() {}
  run() {
    this.process()
  }
}
`
      const entities: EntityNode[] = [
        { className: 'Service', methods: ['process', 'run'] },
      ]
      const inheritances: InheritanceRelation[] = []
      const inferrer = new TypeInferrer(entities, inheritances)

      const calls = callExtractor.extract(code, 'typescript', 'service.ts')
      const processCall = calls.find(c => c.calleeSymbol === 'process' && c.receiverKind === 'self')

      expect(processCall).toBeDefined()
      const qualifiedName = inferrer.resolveQualifiedCall(processCall!, code, 'typescript')
      expect(qualifiedName).toBe('Service.process')
    })
  })

  describe('var = Foo(); var.method() resolves through type inference', () => {
    it('Python: x = Dog(); x.fetch() resolves Dog.fetch', () => {
      const code = `
x = Dog()
x.fetch()
`
      const entities: EntityNode[] = [
        { className: 'Dog', methods: ['speak', 'fetch'] },
      ]
      const inheritances: InheritanceRelation[] = []
      const inferrer = new TypeInferrer(entities, inheritances)

      const calls = callExtractor.extract(code, 'python', 'main.py')
      const fetchCall = calls.find(c => c.calleeSymbol === 'fetch' && c.receiverKind === 'variable')

      expect(fetchCall).toBeDefined()
      expect(fetchCall?.receiver).toBe('x')
      const qualifiedName = inferrer.resolveQualifiedCall(fetchCall!, code, 'python')
      expect(qualifiedName).toBe('Dog.fetch')
    })

    it('TypeScript: const x = new Service(); x.process() resolves Service.process', () => {
      const code = `
const x = new Service()
x.process()
`
      const entities: EntityNode[] = [
        { className: 'Service', methods: ['process'] },
      ]
      const inheritances: InheritanceRelation[] = []
      const inferrer = new TypeInferrer(entities, inheritances)

      const calls = callExtractor.extract(code, 'typescript', 'main.ts')
      const processCall = calls.find(c => c.calleeSymbol === 'process' && c.receiverKind === 'variable')

      expect(processCall).toBeDefined()
      const qualifiedName = inferrer.resolveQualifiedCall(processCall!, code, 'typescript')
      expect(qualifiedName).toBe('Service.process')
    })
  })

  describe('super().method() resolves to parent class', () => {
    it('Python: super method call skips current class to parent', () => {
      const code = `
class Dog(Animal):
    def speak(self):
        super().speak()
`
      const entities: EntityNode[] = [
        { className: 'Animal', methods: ['speak'] },
        { className: 'Dog', methods: ['speak'] },
      ]
      const inheritances: InheritanceRelation[] = [
        { childFile: 'dog.py', childClass: 'Dog', parentClass: 'Animal', kind: 'inherit' },
      ]
      const inferrer = new TypeInferrer(entities, inheritances)

      const calls = callExtractor.extract(code, 'python', 'dog.py')
      // super() returns a call, and then .speak() is called on it
      // The receiver of speak is super(), classified as super
      const superSpeakCall = calls.find(c => c.calleeSymbol === 'speak' && c.receiverKind === 'super')

      expect(superSpeakCall).toBeDefined()
      const qualifiedName = inferrer.resolveQualifiedCall(superSpeakCall!, code, 'python')
      expect(qualifiedName).toBe('Animal.speak')
    })

    it('TypeScript: super.method() skips current class to parent', () => {
      const code = `
class Child extends Parent {
  greet() {
    super.parentMethod()
  }
}
`
      const entities: EntityNode[] = [
        { className: 'Parent', methods: ['parentMethod'] },
        { className: 'Child', methods: ['greet'] },
      ]
      const inheritances: InheritanceRelation[] = [
        { childFile: 'child.ts', childClass: 'Child', parentClass: 'Parent', kind: 'inherit' },
      ]
      const inferrer = new TypeInferrer(entities, inheritances)

      const calls = callExtractor.extract(code, 'typescript', 'child.ts')
      const parentMethodCall = calls.find(c => c.calleeSymbol === 'parentMethod' && c.receiverKind === 'super')

      expect(parentMethodCall).toBeDefined()
      const qualifiedName = inferrer.resolveQualifiedCall(parentMethodCall!, code, 'typescript')
      expect(qualifiedName).toBe('Parent.parentMethod')
    })
  })

  describe('common method names rejected by fuzzy fallback', () => {
    it('get/set/add/remove are not resolved via fuzzy fallback', () => {
      const entities: EntityNode[] = [
        { className: 'Repository', methods: ['get', 'set', 'add', 'remove'] },
      ]
      const inheritances: InheritanceRelation[] = []
      const inferrer = new TypeInferrer(entities, inheritances)

      for (const method of ['get', 'set', 'add', 'remove']) {
        const callSite = {
          callerFile: 'f.py',
          calleeSymbol: method,
          receiverKind: 'variable' as const,
          receiver: 'unknown_var',
        }
        // Fuzzy fallback should reject these common names
        expect(inferrer.resolveQualifiedCall(callSite, '', 'python')).toBeNull()
      }
    })

    it('unique non-common method resolved via fuzzy fallback', () => {
      const entities: EntityNode[] = [
        { className: 'Cat', methods: ['purr'] },
      ]
      const inheritances: InheritanceRelation[] = []
      const inferrer = new TypeInferrer(entities, inheritances)

      const callSite = {
        callerFile: 'f.py',
        calleeSymbol: 'purr',
        receiverKind: 'variable' as const,
        receiver: 'unknown_cat',
      }
      expect(inferrer.resolveQualifiedCall(callSite, '', 'python')).toBe('Cat.purr')
    })
  })

  describe('CallExtractor receiver extraction end-to-end', () => {
    it('Python: extracts receiver info correctly for all call types', () => {
      const code = `
class MyClass:
    def method(self):
        self.helper()
        other.doWork()
        standalone()
`
      const calls = callExtractor.extract(code, 'python', 'test.py')

      const selfCall = calls.find(c => c.calleeSymbol === 'helper')
      expect(selfCall?.receiverKind).toBe('self')
      expect(selfCall?.receiver).toBe('self')

      const variableCall = calls.find(c => c.calleeSymbol === 'doWork')
      expect(variableCall?.receiverKind).toBe('variable')
      expect(variableCall?.receiver).toBe('other')

      const bareCall = calls.find(c => c.calleeSymbol === 'standalone')
      expect(bareCall?.receiverKind).toBe('none')
      expect(bareCall?.receiver).toBeUndefined()
    })

    it('TypeScript: extracts receiver info correctly for all call types', () => {
      const code = `
class MyClass {
  method() {
    this.helper()
    other.doWork()
    standalone()
  }
}
`
      const calls = callExtractor.extract(code, 'typescript', 'test.ts')

      const selfCall = calls.find(c => c.calleeSymbol === 'helper')
      expect(selfCall?.receiverKind).toBe('self')
      expect(selfCall?.receiver).toBe('this')

      const variableCall = calls.find(c => c.calleeSymbol === 'doWork')
      expect(variableCall?.receiverKind).toBe('variable')
      expect(variableCall?.receiver).toBe('other')

      const bareCall = calls.find(c => c.calleeSymbol === 'standalone')
      expect(bareCall?.receiverKind).toBe('none')
    })
  })
})
