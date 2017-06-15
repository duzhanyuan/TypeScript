import * as vpath from "../vpath";
import * as io from "../io";
import { Runner } from "../runner";
import { TextDocument } from "../documents";
import { VirtualFileSystem } from "../vfs";
import { parseTestCase } from "../testCaseParser";

export const enum CompilerTestType {
    Conformance,
    Regressions,
    Test262
}

export class CompilerRunner extends Runner {
    public readonly basePath: string;
    public readonly testSuite: "conformance" | "compiler" | "test262";

    constructor(testSuite: "conformance" | "compiler" | "test262") {
        super(testSuite);
        this.testSuite = testSuite;
        this.basePath = vpath.combine("tests/cases", testSuite);
    }

    // nee. enumerateTestFiles()
    public discover(): string[] {
        return io.getFiles(this.basePath, { recursive: true, pattern: /\.tsx?$/, qualified: true });
    }

    // nee. initializeTests()
    protected describe(file: string): void {
        describe(`compiler tests for ${file}`, () => {
            let compilerTest: CompilerTest | undefined;
            before(() => compilerTest = new CompilerTest(file));
            it("errors", () => compilerTest && compilerTest.testCorrectErrors());
            it("module resolution", () => compilerTest && compilerTest.testModuleResolution());
            it("sourcemap record", () => compilerTest && compilerTest.testSourceMapRecord());
            it("output", () => compilerTest && compilerTest.testJavaScriptOutput());
            it("sourcemap", () => compilerTest && compilerTest.testSourceMapOutput());
            it("types", () => compilerTest && compilerTest.testTypes());
            it("symbols", () => compilerTest && compilerTest.testSymbols());
            after(() => compilerTest = undefined);
        });
    }
}

class CompilerTest {
    private document: TextDocument;
    private documents: TextDocument[];
    private vfs: VirtualFileSystem;
    private basename: string;

    constructor(file: string) {
        this.basename = vpath.basename(file);
        this.document = new TextDocument(file, io.readFile(file) || "");
        const { documents } = parseTestCase(this.document);
        this.documents = documents;
        this.vfs = VirtualFileSystem.getBuiltLocal().clone();
        // TODO: symlinks
        // TODO: currentDirectory
        for (const document of this.documents) {
            this.vfs.addFile(document.file, document.text);
        }
    }

    public testCorrectErrors(): void {
    }

    public testModuleResolution(): void {
    }

    public testSourceMapRecord(): void {
    }

    public testJavaScriptOutput(): void {
    }

    public testSourceMapOutput(): void {
    }

    public testTypes(): void {
    }

    public testSymbols(): void {
    }
}