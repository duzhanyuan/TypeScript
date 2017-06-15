import { VirtualFileSystem, VirtualDirectory, VirtualFile } from "./vfs";
import { TextDocument } from "./documents";
import * as vpath from "./vpath";
import * as _ts from "typescript";

interface EmitResult extends _ts.EmitResult {
    sourceMaps: _ts.SourceMapData[];
}

export class CompilerHost {
    private _setParentNodes: boolean;
    private _sourceFiles = new Map<string, _ts.SourceFile>();
    private _ts: typeof _ts;
    private _newLine: "\r\n" | "\n";

    public readonly vfs: VirtualFileSystem;
    public readonly defaultLibLocation: string;
    public readonly outputs: TextDocument[] = [];
    public readonly traceResults: string[] = [];

    constructor(ts: typeof _ts, vfs: VirtualFileSystem, defaultLibLocation: string, newLine: "\r\n" | "\n", setParentNodes = false) {
        this._ts = ts;
        this.vfs = vfs;
        this.defaultLibLocation = defaultLibLocation;
        this._newLine = newLine;
        this._setParentNodes = setParentNodes;
    }

    public getCurrentDirectory(): string {
        return this.vfs.currentDirectory;
    }

    public useCaseSensitiveFileNames(): boolean {
        return this.vfs.useCaseSensitiveFileNames;
    }

    public getNewLine(): string {
        return this._newLine;
    }

    public getCanonicalFileName(fileName: string): string {
        return this.vfs.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase();
    }

    public fileExists(fileName: string): boolean {
        return this.vfs.traversePath(fileName) instanceof VirtualFile;
    }

    public directoryExists(directoryName: string): boolean {
        return this.vfs.traversePath(directoryName) instanceof VirtualDirectory;
    }

    public getDirectories(path: string): string[] {
        const entry = this.vfs.traversePath(path);
        return entry instanceof VirtualDirectory
            ? entry.getDirectories(/*recursive*/ true).map(dir => dir.relative)
            : [];
    }

    public readFile(path: string): string | undefined {
        const entry = this.vfs.traversePath(path);
        return entry instanceof VirtualFile ? entry.content : undefined;
    }

    public writeFile(fileName: string, content: string, writeByteOrderMark: boolean) {
        if (writeByteOrderMark) content = "\uFEFF" + content;
        const entry = this.vfs.addFile(fileName);
        if (entry) {
            entry.content = content;
            const document = new TextDocument(entry.path, content);
            const index = this.outputs.findIndex(doc => this.vfs.sameName(document.file, doc.file));
            if (index < 0) {
                this.outputs.push(document);
            }
            else {
                this.outputs[index] = document;
            }
        }
    }

    public trace(s: string): void {
        this.traceResults.push(s);
    }

    public realpath(path: string): string | undefined {
        const entry = this.vfs.traversePath(path, { followSymlinks: true });
        return entry && entry.path;
    }

    public getDefaultLibLocation(): string {
        return vpath.resolve(this.vfs.currentDirectory, this.defaultLibLocation);
    }

    public getDefaultLibFileName(options: _ts.CompilerOptions): string {
        return vpath.resolve(this.getDefaultLibLocation(), this._ts.getDefaultLibFileName(options));
    }

    public getSourceFile(fileName: string, languageVersion: _ts.ScriptTarget): _ts.SourceFile | undefined {
        fileName = vpath.resolve(this.vfs.currentDirectory, fileName);
        fileName = this.getCanonicalFileName(fileName);

        const existing = this._sourceFiles.get(fileName);
        if (existing) return existing;

        const content = this.readFile(fileName);
        if (content === undefined) return undefined;

        const parsed = this._ts.createSourceFile(fileName, content, languageVersion, this._setParentNodes);
        this._sourceFiles.set(fileName, parsed);
        return parsed;
    }
}

export class CompilationResult {
    public readonly output: TextDocument[];
    public readonly errors: _ts.Diagnostic[];
    public readonly sourceMaps: _ts.SourceMapData[];
    constructor(output: TextDocument[], errors: _ts.Diagnostic[], sourceMaps: _ts.SourceMapData[]) {
        this.output = output;
        this.errors = errors;
        this.sourceMaps = sourceMaps;
    }
}

export function compileFiles(ts: typeof _ts, vfs: VirtualFileSystem, defaultLibLocation: string, rootFiles: string[]) {
    const options: _ts.CompilerOptions = {};
    const host = new CompilerHost(ts, vfs, defaultLibLocation, "\r\n");
    const program = ts.createProgram(rootFiles, options, <_ts.CompilerHost>host);
    const errors = ts.getPreEmitDiagnostics(program);
    const emitResult = <EmitResult>program.emit();
    return new CompilationResult(host.outputs, errors, emitResult.sourceMaps);
}