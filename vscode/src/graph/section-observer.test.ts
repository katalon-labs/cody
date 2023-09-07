import { beforeEach, describe, expect, it, Mock, vi, vitest } from 'vitest'
import { URI } from 'vscode-uri'

import { PreciseContext } from '@sourcegraph/cody-shared/src/codebase-context/messages'

import { vsCodeMocks } from '../testutils/mocks'
import { range } from '../testutils/textDocument'

import { SectionObserver } from './section-observer'

vi.mock('vscode', () => vsCodeMocks)

const document1Uri = URI.file('/document1.ts')
const document2Uri = URI.file('/document2.ts')

interface TestDocument {
    uri: URI
    lineCount: number
    sections: { fuzzyName: string; location: any }[]
}

describe('SectionObserver', () => {
    let testDocuments: {
        document1: TestDocument
        document2: TestDocument
    }

    let visibleTextEditors: Mock
    let onDidChangeVisibleTextEditors: any
    let onDidChangeTextEditorSelection: any
    let onDidChangeTextDocument: any
    let getDocumentSections: Mock
    let getGraphContextFromRange: Mock
    let sectionObserver: SectionObserver
    beforeEach(async () => {
        testDocuments = {
            document1: {
                uri: document1Uri,
                lineCount: 20,
                sections: [
                    { fuzzyName: 'foo', location: { document1Uri, range: range(0, 0, 10, 0) } },
                    { fuzzyName: 'bar', location: { document1Uri, range: range(11, 0, 20, 0) } },
                ],
            },
            document2: {
                uri: document2Uri,
                lineCount: 20,
                sections: [
                    { fuzzyName: 'baz', location: { document2Uri, range: range(0, 0, 10, 0) } },
                    { fuzzyName: 'qux', location: { document2Uri, range: range(11, 0, 20, 0) } },
                ],
            },
        }

        visibleTextEditors = vitest.fn().mockImplementation(() => [{ document: testDocuments.document1 }])
        getDocumentSections = vitest.fn().mockImplementation((document: typeof testDocuments.document1) => {
            const doc = Object.values(testDocuments).find(doc => doc.uri.toString() === document.uri.toString())
            return doc?.sections ?? []
        })

        getGraphContextFromRange = vitest.fn().mockImplementation(
            () =>
                [
                    {
                        symbol: { fuzzyName: 'foo' },
                        definitionSnippet: 'function foo() {}',
                        filePath: document1Uri.toString(),
                        hoverText: [],
                    },
                    {
                        symbol: { fuzzyName: 'bar' },
                        definitionSnippet: 'function bar() {}',
                        filePath: document1Uri.toString(),
                        hoverText: [],
                    },
                ] satisfies PreciseContext[]
        )

        sectionObserver = new SectionObserver(
            {
                onDidChangeVisibleTextEditors: (_onDidChangeVisibleTextEditors: any) =>
                    (onDidChangeVisibleTextEditors = _onDidChangeVisibleTextEditors),
                onDidChangeTextEditorSelection: (_onDidChangeTextEditorSelection: any) =>
                    (onDidChangeTextEditorSelection = _onDidChangeTextEditorSelection),
                get visibleTextEditors(): any {
                    return visibleTextEditors()
                },
            },
            {
                onDidChangeTextDocument: (_onDidChangeTextDocument: any) =>
                    (onDidChangeTextDocument = _onDidChangeTextDocument),
            },
            getDocumentSections,
            getGraphContextFromRange
        )
        // The section observer loads the document asynchronously, so we wait
        // for it to finish loading.
        await nextTick()
    })

    it('loads visible documents when it loads', () => {
        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            ├─ foo
            └─ bar"
        `)
    })

    it('loads a new document when it becomes visible', async () => {
        visibleTextEditors.mockImplementation(() => [
            { document: testDocuments.document1 },
            { document: testDocuments.document2 },
        ])
        await onDidChangeVisibleTextEditors()

        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document2.ts
            ├─ baz
            └─ qux
          file:///document1.ts
            ├─ foo
            └─ bar"
        `)
    })

    it('unloads documents that are no longer visible', async () => {
        visibleTextEditors.mockImplementation(() => [{ document: testDocuments.document2 }])
        await onDidChangeVisibleTextEditors()

        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document2.ts
            ├─ baz
            └─ qux"
        `)
    })

    it('reloads the sections when two new lines are added', async () => {
        testDocuments.document1.lineCount = 23
        testDocuments.document1.sections = [
            { fuzzyName: 'foo', location: { document1Uri, range: range(2, 0, 12, 0) } },
            { fuzzyName: 'baz', location: { document1Uri, range: range(13, 0, 22, 0) } },
        ]
        await onDidChangeTextDocument({
            document: testDocuments.document1,
            contentChanges: [],
        })

        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            ├─ foo
            └─ baz"
        `)
    })

    it('loads context for sections when the cursor moves', async () => {
        const promise = onDidChangeTextEditorSelection({
            textEditor: { document: testDocuments.document1 },
            selections: [{ active: { line: 15, character: 0 } }],
        })

        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            ├─ foo
            └─ bar (loading)"
        `)

        await promise

        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            ├─ foo
            └─ bar (2 snippets)"
        `)
    })

    it('does not unload hydrated section when the document changes', async () => {
        await onDidChangeTextEditorSelection({
            textEditor: { document: testDocuments.document1 },
            selections: [{ active: { line: 1, character: 0 } }],
        })
        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            ├─ foo (2 snippets)
            └─ bar"
        `)

        testDocuments.document1.lineCount = 23
        testDocuments.document1.sections = [
            { fuzzyName: 'foo', location: { document1Uri, range: range(0, 0, 12, 0) } },
            { fuzzyName: 'baz', location: { document1Uri, range: range(13, 0, 22, 0) } },
        ]
        await onDidChangeTextDocument({
            document: testDocuments.document1,
            contentChanges: [],
        })

        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            ├─ foo (2 snippets, dirty)
            └─ baz"
        `)
    })

    it('reloads sections when the document is changed', async () => {
        await onDidChangeTextEditorSelection({
            textEditor: { document: testDocuments.document1 },
            selections: [{ active: { line: 1, character: 0 } }],
        })
        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            ├─ foo (2 snippets)
            └─ bar"
        `)

        testDocuments.document1.lineCount = 10
        testDocuments.document1.sections = [{ fuzzyName: 'foo', location: { document1Uri, range: range(0, 0, 10, 0) } }]
        await onDidChangeTextDocument({
            document: testDocuments.document1,
            contentChanges: [],
        })

        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            └─ foo (2 snippets, dirty)"
        `)

        getGraphContextFromRange.mockImplementation(() => [
            {
                symbol: { fuzzyName: 'foo' },
                definitionSnippet: 'function foo() {}',
                filePath: document1Uri.toString(),
                hoverText: [],
            },
        ])
        await onDidChangeTextEditorSelection({
            textEditor: { document: testDocuments.document1 },
            selections: [{ active: { line: 1, character: 0 } }],
        })

        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            └─ foo (1 snippets)"
        `)
    })

    it('reloads sections when the section was significantly changed', async () => {
        await onDidChangeTextEditorSelection({
            textEditor: { document: testDocuments.document1 },
            selections: [{ active: { line: 1, character: 0 } }],
        })
        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            ├─ foo (2 snippets)
            └─ bar"
        `)

        await onDidChangeTextDocument({
            document: testDocuments.document1,
            contentChanges: [
                {
                    range: range(1, 0, 1, 1),
                    text: 'foo\n',
                },
            ],
        })

        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            ├─ foo (2 snippets, dirty)
            └─ bar"
        `)

        getGraphContextFromRange.mockImplementation(() => [
            {
                symbol: { fuzzyName: 'foo' },
                definitionSnippet: 'function foo() {}',
                filePath: document1Uri.toString(),
                hoverText: [],
            },
        ])
        await onDidChangeTextEditorSelection({
            textEditor: { document: testDocuments.document1 },
            selections: [{ active: { line: 1, character: 0 } }],
        })

        expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
          "file:///document1.ts
            ├─ foo (1 snippets)
            └─ bar"
        `)
    })

    describe('getCachedContextAtPosition', () => {
        it('returns the cached context snippets', async () => {
            await onDidChangeTextEditorSelection({
                textEditor: { document: testDocuments.document1 },
                selections: [{ active: { line: 15, character: 0 } }],
            })

            expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
              "file:///document1.ts
                ├─ foo
                └─ bar (2 snippets)"
            `)

            expect(
                sectionObserver.getContextAtPosition(testDocuments.document1 as any, { line: 15, character: 0 } as any)
            ).toMatchInlineSnapshot(`
              [
                {
                  "content": "function foo() {}",
                  "fileName": "file:/document1.ts",
                  "symbol": "foo",
                },
                {
                  "content": "function bar() {}",
                  "fileName": "file:/document1.ts",
                  "symbol": "bar",
                },
              ]
            `)
        })

        it('updates section ranges when the document is reloaded', async () => {
            const updatedRange = range(1, 0, 22, 0)
            // Change the document so that the bar section now starts on line 2
            testDocuments.document1.lineCount = 23
            testDocuments.document1.sections = [
                { fuzzyName: 'bar', location: { document1Uri, range: range(1, 0, 22, 0) } },
            ]
            await onDidChangeTextDocument({
                document: testDocuments.document1,
                contentChanges: [],
            })

            expect(sectionObserver.debugPrint()).toMatchInlineSnapshot(`
              "file:///document1.ts
                └─ bar"
            `)

            // Expect a hover to preload the updated section range
            await onDidChangeTextEditorSelection({
                textEditor: { document: testDocuments.document1 },
                selections: [{ active: { line: 2, character: 0 } }],
            })
            expect(getGraphContextFromRange).toHaveBeenCalledWith(expect.anything(), updatedRange)
        })
    })
})

function nextTick() {
    return new Promise(resolve => process.nextTick(resolve))
}