import { CallExtractor } from '@pleaseai/rpg-encoder/call-extractor'
import { describe, expect, it } from 'vitest'

describe('CallExtractor', () => {
  const extractor = new CallExtractor()

  describe('direct function calls', () => {
    it('extracts simple function calls', () => {
      const code = `
        function greet() {}
        greet()
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      expect(calls).toHaveLength(1)
      expect(calls[0].calleeSymbol).toBe('greet')
      expect(calls[0].callerFile).toBe('test.ts')
    })

    it('extracts multiple function calls', () => {
      const code = `
        function foo() {}
        function bar() {}
        foo()
        bar()
        foo()
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      expect(calls).toHaveLength(3)
      const symbols = calls.map(c => c.calleeSymbol)
      expect(symbols).toEqual(['foo', 'bar', 'foo'])
    })

    it('returns empty array for code without calls', () => {
      const code = `
        function greet() {
          const x = 5
          const y = 10
        }
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      expect(calls).toHaveLength(0)
    })

    it('includes line numbers for direct calls', () => {
      const code = `function foo() {}
foo()
bar()`
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      expect(calls).toHaveLength(2)
      expect(calls[0].line).toBe(2)
      expect(calls[1].line).toBe(3)
    })
  })

  describe('method calls', () => {
    it('extracts simple method calls', () => {
      const code = `
        const obj = { doSomething() {} }
        obj.doSomething()
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      expect(calls.some(c => c.calleeSymbol === 'doSomething')).toBe(true)
    })

    it('extracts chained method calls', () => {
      const code = `
        const result = obj.method1().method2()
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      const symbols = calls.map(c => c.calleeSymbol)
      expect(symbols).toContain('method1')
      expect(symbols).toContain('method2')
    })

    it('extracts method calls on literals', () => {
      const code = `
        "hello".toUpperCase()
        [1, 2, 3].map(x => x * 2)
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      const symbols = calls.map(c => c.calleeSymbol)
      expect(symbols).toContain('toUpperCase')
      expect(symbols).toContain('map')
    })
  })

  describe('this and super calls', () => {
    it('extracts this.method() calls', () => {
      const code = `
        class MyClass {
          method() {
            this.helper()
          }
          helper() {}
        }
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      expect(calls.some(c => c.calleeSymbol === 'helper')).toBe(true)
    })

    it('extracts super.method() calls', () => {
      const code = `
        class Child extends Parent {
          method() {
            super.parentMethod()
          }
        }
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      expect(calls.some(c => c.calleeSymbol === 'parentMethod')).toBe(true)
    })

    it('tracks this as context in callerEntity', () => {
      const code = `
        class MyClass {
          doWork() {
            this.helper()
          }
          helper() {}
        }
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      const helperCall = calls.find(c => c.calleeSymbol === 'helper')
      expect(helperCall).toBeDefined()
      expect(helperCall?.callerEntity).toBe('MyClass.doWork')
    })
  })

  describe('constructor calls', () => {
    it('extracts constructor calls with new', () => {
      const code = `
        class MyClass {}
        const instance = new MyClass()
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      expect(calls.some(c => c.calleeSymbol === 'MyClass')).toBe(true)
    })

    it('extracts constructor calls from generic types', () => {
      const code = `
        const arr = new Array<number>()
        const map = new Map<string, number>()
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      const symbols = calls.map(c => c.calleeSymbol)
      expect(symbols).toContain('Array')
      expect(symbols).toContain('Map')
    })

    it('distinguishes new calls from regular calls', () => {
      const code = `
        class Foo {}
        function Bar() {}
        const a = new Foo()
        const b = Bar()
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      expect(calls.some(c => c.calleeSymbol === 'Foo')).toBe(true)
      expect(calls.some(c => c.calleeSymbol === 'Bar')).toBe(true)
    })
  })

  describe('complex scenarios', () => {
    it('handles nested function calls', () => {
      const code = `
        function outer() {
          const x = inner(nested())
        }
        function inner(val) {}
        function nested() {}
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      const symbols = calls.map(c => c.calleeSymbol)
      expect(symbols).toContain('inner')
      expect(symbols).toContain('nested')
    })

    it('handles arrow functions', () => {
      const code = `
        const fn = () => helper()
        function helper() {}
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      expect(calls.some(c => c.calleeSymbol === 'helper')).toBe(true)
    })

    it('extracts calls from multiple files identified by filename', () => {
      const code1 = 'foo()'
      const code2 = 'bar()'
      const calls1 = extractor.extract(code1, 'typescript', 'file1.ts')
      const calls2 = extractor.extract(code2, 'typescript', 'file2.ts')
      expect(calls1[0].callerFile).toBe('file1.ts')
      expect(calls2[0].callerFile).toBe('file2.ts')
    })
  })

  describe('JavaScript support', () => {
    it('extracts calls from JavaScript code', () => {
      const code = `
        function greet() {}
        greet()
        obj.method()
      `
      const calls = extractor.extract(code, 'javascript', 'test.js')
      expect(calls.length).toBeGreaterThan(0)
      expect(calls[0].calleeSymbol).toBe('greet')
    })
  })

  describe('Python support', () => {
    it('extracts direct Python calls', () => {
      const code = `def foo():\n    pass\nfoo()`
      const calls = extractor.extract(code, 'python', 'test.py')
      expect(calls.some(c => c.calleeSymbol === 'foo')).toBe(true)
    })

    it('extracts Python method calls', () => {
      const code = `obj.method()`
      const calls = extractor.extract(code, 'python', 'test.py')
      expect(calls.some(c => c.calleeSymbol === 'method')).toBe(true)
    })

    it('extracts Python constructor calls', () => {
      const code = `x = MyClass()`
      const calls = extractor.extract(code, 'python', 'test.py')
      expect(calls.some(c => c.calleeSymbol === 'MyClass')).toBe(true)
    })
  })

  describe('Java support', () => {
    it('extracts Java method invocations', () => {
      const code = `class A { void m() { foo(); } }`
      const calls = extractor.extract(code, 'java', 'test.java')
      expect(calls.some(c => c.calleeSymbol === 'foo')).toBe(true)
    })

    it('extracts Java method calls on objects', () => {
      const code = `class A { void m() { obj.bar(); } }`
      const calls = extractor.extract(code, 'java', 'test.java')
      expect(calls.some(c => c.calleeSymbol === 'bar')).toBe(true)
    })

    it('extracts Java constructor calls', () => {
      const code = `class A { void m() { B b = new B(); } }`
      const calls = extractor.extract(code, 'java', 'test.java')
      expect(calls.some(c => c.calleeSymbol === 'B')).toBe(true)
    })
  })

  describe('Rust support', () => {
    it('extracts Rust function calls', () => {
      const code = `fn main() { foo(); }`
      const calls = extractor.extract(code, 'rust', 'test.rs')
      expect(calls.some(c => c.calleeSymbol === 'foo')).toBe(true)
    })

    it('extracts Rust method calls', () => {
      const code = `fn main() { obj.bar(); }`
      const calls = extractor.extract(code, 'rust', 'test.rs')
      expect(calls.some(c => c.calleeSymbol === 'bar')).toBe(true)
    })

    it('extracts Rust scoped calls (Foo::new)', () => {
      const code = `fn main() { let x = Foo::new(); }`
      const calls = extractor.extract(code, 'rust', 'test.rs')
      expect(calls.some(c => c.calleeSymbol === 'new')).toBe(true)
    })
  })

  describe('Go support', () => {
    it('extracts Go function calls', () => {
      const code = `package main\nfunc main() { foo() }`
      const calls = extractor.extract(code, 'go', 'test.go')
      expect(calls.some(c => c.calleeSymbol === 'foo')).toBe(true)
    })

    it('extracts Go method calls', () => {
      const code = `package main\nfunc main() { obj.Bar() }`
      const calls = extractor.extract(code, 'go', 'test.go')
      expect(calls.some(c => c.calleeSymbol === 'Bar')).toBe(true)
    })
  })

  describe('receiver info preservation', () => {
    describe('TypeScript/JavaScript', () => {
      it('bare function call has receiverKind none', () => {
        const calls = extractor.extract('foo()', 'typescript', 'test.ts')
        const call = calls.find(c => c.calleeSymbol === 'foo')
        expect(call?.receiverKind).toBe('none')
        expect(call?.receiver).toBeUndefined()
      })

      it('this.method() has receiverKind self', () => {
        const code = `class A { m() { this.helper() } helper() {} }`
        const calls = extractor.extract(code, 'typescript', 'test.ts')
        const call = calls.find(c => c.calleeSymbol === 'helper')
        expect(call?.receiver).toBe('this')
        expect(call?.receiverKind).toBe('self')
      })

      it('super.method() has receiverKind super', () => {
        const code = `class Child extends Parent { m() { super.parentMethod() } }`
        const calls = extractor.extract(code, 'typescript', 'test.ts')
        const call = calls.find(c => c.calleeSymbol === 'parentMethod')
        expect(call?.receiver).toBe('super')
        expect(call?.receiverKind).toBe('super')
      })

      it('obj.method() has receiverKind variable', () => {
        const calls = extractor.extract('obj.doSomething()', 'typescript', 'test.ts')
        const call = calls.find(c => c.calleeSymbol === 'doSomething')
        expect(call?.receiver).toBe('obj')
        expect(call?.receiverKind).toBe('variable')
      })

      it('qualifiedName is undefined (filled by TypeInferrer)', () => {
        const calls = extractor.extract('this.helper()', 'typescript', 'test.ts')
        expect(calls[0]?.qualifiedName).toBeUndefined()
      })
    })

    describe('Python', () => {
      it('bare function call has receiverKind none', () => {
        const calls = extractor.extract('foo()', 'python', 'test.py')
        const call = calls.find(c => c.calleeSymbol === 'foo')
        expect(call?.receiverKind).toBe('none')
      })

      it('self.method() has receiverKind self', () => {
        const calls = extractor.extract('self.method()', 'python', 'test.py')
        const call = calls.find(c => c.calleeSymbol === 'method')
        expect(call?.receiver).toBe('self')
        expect(call?.receiverKind).toBe('self')
      })

      it('obj.method() has receiverKind variable', () => {
        const calls = extractor.extract('foo.bar()', 'python', 'test.py')
        const call = calls.find(c => c.calleeSymbol === 'bar')
        expect(call?.receiver).toBe('foo')
        expect(call?.receiverKind).toBe('variable')
      })
    })

    describe('Java', () => {
      it('this.method() has receiverKind self', () => {
        const code = `class A { void m() { this.helper(); } }`
        const calls = extractor.extract(code, 'java', 'test.java')
        const call = calls.find(c => c.calleeSymbol === 'helper')
        expect(call?.receiver).toBe('this')
        expect(call?.receiverKind).toBe('self')
      })

      it('obj.method() has receiverKind variable', () => {
        const code = `class A { void m() { obj.bar(); } }`
        const calls = extractor.extract(code, 'java', 'test.java')
        const call = calls.find(c => c.calleeSymbol === 'bar')
        expect(call?.receiver).toBe('obj')
        expect(call?.receiverKind).toBe('variable')
      })

      it('bare method call has receiverKind none', () => {
        const code = `class A { void m() { foo(); } }`
        const calls = extractor.extract(code, 'java', 'test.java')
        const call = calls.find(c => c.calleeSymbol === 'foo')
        expect(call?.receiverKind).toBe('none')
      })
    })

    describe('Rust', () => {
      it('self.method() has receiverKind self', () => {
        const calls = extractor.extract('fn f() { self.helper(); }', 'rust', 'test.rs')
        const call = calls.find(c => c.calleeSymbol === 'helper')
        expect(call?.receiver).toBe('self')
        expect(call?.receiverKind).toBe('self')
      })

      it('obj.method() has receiverKind variable', () => {
        const calls = extractor.extract('fn f() { obj.bar(); }', 'rust', 'test.rs')
        const call = calls.find(c => c.calleeSymbol === 'bar')
        expect(call?.receiver).toBe('obj')
        expect(call?.receiverKind).toBe('variable')
      })

      it('bare call has receiverKind none', () => {
        const calls = extractor.extract('fn f() { foo(); }', 'rust', 'test.rs')
        const call = calls.find(c => c.calleeSymbol === 'foo')
        expect(call?.receiverKind).toBe('none')
      })
    })

    describe('Go', () => {
      it('selector call has receiverKind variable', () => {
        const calls = extractor.extract('package main\nfunc main() { obj.Bar() }', 'go', 'test.go')
        const call = calls.find(c => c.calleeSymbol === 'Bar')
        expect(call?.receiver).toBe('obj')
        expect(call?.receiverKind).toBe('variable')
      })

      it('bare call has receiverKind none', () => {
        const calls = extractor.extract('package main\nfunc main() { foo() }', 'go', 'test.go')
        const call = calls.find(c => c.calleeSymbol === 'foo')
        expect(call?.receiverKind).toBe('none')
      })
    })
  })

  describe('edge cases', () => {
    it('handles empty code', () => {
      const calls = extractor.extract('', 'typescript', 'test.ts')
      expect(calls).toHaveLength(0)
    })

    it('handles code with only whitespace', () => {
      const calls = extractor.extract('   \n  \n  ', 'typescript', 'test.ts')
      expect(calls).toHaveLength(0)
    })

    it('handles syntax errors gracefully', () => {
      const code = `
        function broken(
        const x = 5
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      // Should not throw, even with syntax errors
      expect(Array.isArray(calls)).toBe(true)
    })

    it('handles comments in code', () => {
      const code = `
        // This is a comment with foo()
        /* Multi-line comment with bar() */
        actualFunction()
      `
      const calls = extractor.extract(code, 'typescript', 'test.ts')
      // Should only find actualFunction, not foo or bar
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls.some(c => c.calleeSymbol === 'actualFunction')).toBe(true)
    })
  })
})
