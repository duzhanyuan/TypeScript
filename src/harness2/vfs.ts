import { compareStrings } from "./utils";
import * as vpath from "./vpath";
import * as io from "./io";

export interface FileSystemResolver {
    getEntries(dir: VirtualDirectory): { files: string[], directories: string[] };
    getContent(file: VirtualFile): string | undefined;
}

export function createResolver(io: io.IO): FileSystemResolver {
    return {
        getEntries(dir) {
            return io.getAccessibleFileSystemEntries(dir.path);
        },
        getContent(file) {
            return io.readFile(file.path);
        }
    };
}

export abstract class VirtualFileSystemEntry {
    private _readOnly = false;
    private _path: string | undefined;

    public readonly fileSystem: VirtualFileSystem;
    public readonly parent: VirtualFileSystemContainer;
    public readonly name: string;

    constructor(parent: VirtualFileSystemContainer | undefined, name: string) {
        if (this instanceof VirtualFileSystem) {
            this.parent = this.fileSystem = this;
        }
        else if (parent) {
            this.parent = parent;
            this.fileSystem = parent.fileSystem;
        }
        else {
            throw new TypeError("Argument not optional: parent");
        }

        this.name = name;
    }

    public get isReadOnly(): boolean {
        return this._readOnly;
    }

    public get path(): string {
        if (!this._path) {
            this._path = this.parent instanceof VirtualFileSystem ? this.name : vpath.combine(this.parent.path, this.name);
        }
        return this._path;
    }

    public get relative(): string {
        return this.fileSystem.currentDirectory
            ? vpath.relative(this.fileSystem.currentDirectory, this.path, this.fileSystem.useCaseSensitiveFileNames)
            : this.path;
    }

    public get exists(): boolean {
        return this.parent.exists
            && this.parent.getFileSystemEntry(this.name) === this;
    }

    public makeReadOnly(): void {
        this._readOnly = true;
    }

    public abstract clone(parent: VirtualFileSystemContainer): VirtualFileSystemEntry;

    protected abstract makeReadOnlyCore(): void;

    protected writePreamble(): void {
        if (this._readOnly) throw new Error("Cannot modify a frozen entry.");
    }
}

export abstract class VirtualFileSystemContainer extends VirtualFileSystemEntry {
    public getFileSystemEntries(recursive?: boolean): ReadonlyArray<VirtualFileSystemEntry> {
        if (recursive) {
            const results: VirtualFileSystemEntry[] = [];
            for (const entry of this.getOwnFileSystemEntries()) {
                if (entry instanceof VirtualFile) {
                    results.push(entry);
                }
                else if (entry instanceof VirtualDirectory) {
                    results.push(entry);
                    for (const child of entry.getFileSystemEntries(/*recursive*/ true)) {
                        results.push(child);
                    }
                }
            }
            return results;
        }
        return this.getOwnFileSystemEntries();
    }

    public getFileSystemEntry(name: string): VirtualFileSystemEntry | undefined {
        for (const entry of this.getFileSystemEntries()) {
            if (this.fileSystem.sameName(entry.name, name)) {
                return entry;
            }
        }
        return undefined;
    }

    public getDirectories(recursive?: boolean): VirtualDirectory[] {
        return this.getFileSystemEntries(recursive).filter(entry => entry instanceof VirtualDirectory) as VirtualDirectory[];
    }

    public getFiles(recursive?: boolean): VirtualFile[] {
        return this.getFileSystemEntries(recursive).filter(entry => entry instanceof VirtualFile) as VirtualFile[];
    }

    public getDirectory(name: string): VirtualDirectory | undefined {
        const entry = this.getFileSystemEntry(name);
        return entry instanceof VirtualDirectory ? entry : undefined;
    }

    public getFile(name: string): VirtualFile | undefined {
        const entry = this.getFileSystemEntry(name);
        return entry instanceof VirtualFile ? entry : undefined;
    }

    protected abstract getOwnFileSystemEntries(): ReadonlyArray<VirtualFileSystemEntry>;
}

export class VirtualFileSystem extends VirtualFileSystemContainer {
    private static builtLocal: VirtualFileSystem | undefined;
    private _root: VirtualDirectory;

    public currentDirectory: string;
    public readonly useCaseSensitiveFileNames: boolean;

    constructor(currentDirectory: string, useCaseSensitiveFileNames: boolean) {
        super(/*parent*/ undefined, "");
        this.currentDirectory = currentDirectory.replace(/\\/g, "/");
        this.useCaseSensitiveFileNames = useCaseSensitiveFileNames;
    }

    private get root() {
        if (this._root === undefined) {
            this._root = new VirtualDirectory(this, "");
            if (this.isReadOnly) this._root.makeReadOnly();
        }
        return this._root;
    }

    public get path() {
        return "";
    }

    public get relative() {
        return "";
    }

    public get exists() {
        return true;
    }

    public static getBuiltLocal(): VirtualFileSystem {
        if (!this.builtLocal) {
            this.builtLocal = new VirtualFileSystem("", io.useCaseSensitiveFileNames());
            this.builtLocal.addDirectory(vpath.resolve(__dirname, "../local"), createResolver(io));
            this.builtLocal.makeReadOnly();
        }
        return this.builtLocal;
    }

    public addDirectory(path: string, resolver?: FileSystemResolver) {
        this.writePreamble();
        const components = vpath.parse(vpath.resolve(this.currentDirectory, path));
        let directory: VirtualDirectory | undefined = this.root;
        for (const component of components) {
            directory = directory.addDirectory(component, resolver);
            if (directory === undefined) {
                break;
            }
        }
        return directory;
    }

    public addFile(path: string, content?: FileSystemResolver["getContent"] | string) {
        this.writePreamble();
        const absolutePath = vpath.resolve(this.currentDirectory, path);
        const fileName = vpath.basename(path);
        const directoryPath = vpath.dirname(absolutePath);
        const directory = this.addDirectory(directoryPath);
        return directory ? directory.addFile(fileName, content) : undefined;
    }

    public addSymlink(path: string, target: VirtualFile): VirtualFileSymlink | undefined;
    public addSymlink(path: string, target: VirtualDirectory): VirtualDirectorySymlink | undefined;
    public addSymlink(path: string, target: string | VirtualFile | VirtualDirectory): VirtualSymlink | undefined;
    public addSymlink(path: string, target: string | VirtualFile | VirtualDirectory) {
        this.writePreamble();
        const directory = this.addDirectory(vpath.dirname(vpath.resolve(this.currentDirectory, path)));
        return directory && directory.addSymlink(vpath.basename(path), target);
    }

    public removeDirectory(path: string): boolean {
        this.writePreamble();
        const dirname = vpath.dirname(path);
        const basename = vpath.basename(path);
        if (!dirname) {
            return this.root.removeDirectory(basename);
        }

        const container = this.traversePath(dirname);
        return container instanceof VirtualDirectory
            && container.removeDirectory(basename);
    }

    public removeFile(path: string): boolean {
        this.writePreamble();
        const dirname = vpath.dirname(path);
        const basename = vpath.basename(path);
        if (!dirname) {
            return this.root.removeFile(basename);
        }

        const container = this.traversePath(dirname);
        return container instanceof VirtualDirectory
            && container.removeFile(basename);
    }

    public directoryExists(path: string) {
        return this.traversePath(path) instanceof VirtualDirectory;
    }

    public fileExists(path: string) {
        return this.traversePath(path) instanceof VirtualFile;
    }

    public sameName(a: string, b: string) {
        return compareStrings(a, b, this.useCaseSensitiveFileNames) === 0;
    }

    public traversePath(path: string, options?: { followSymlinks?: boolean }) {
        const follow = options && options.followSymlinks;
        let directory: VirtualDirectory = this.root;
        for (const component of vpath.parse(vpath.resolve(this.currentDirectory, path))) {
            const entry = directory.getFileSystemEntry(component);
            if (entry instanceof VirtualDirectory) {
                directory = entry;
            }
            else if (entry instanceof VirtualFile) {
                return follow ? this.getTarget(entry) : entry;
            }
            else {
                return undefined;
            }
        }
        return follow ? this.getTarget(directory) : directory;
    }

    public getTarget(entry: VirtualDirectory): VirtualDirectory | undefined;
    public getTarget(entry: VirtualFile): VirtualFile | undefined;
    public getTarget(entry: VirtualFileSystemEntry): VirtualFileSystemEntry | undefined {
        if (entry instanceof VirtualFileSymlink || entry instanceof VirtualDirectorySymlink) {
            return findTarget(this, entry.target);
        }
        return entry;
    }

    /**
     * Reads the directory at the given path and retrieves a list of file names and a list
     * of directory names within it. Suitable for use with ts.matchFiles()
     * @param path  The path to the directory to be read
     */
    public getAccessibleFileSystemEntries(path: string) {
        const entry = this.traversePath(path);
        if (entry instanceof VirtualDirectory) {
            return {
                files: entry.getFiles().map(f => f.name),
                directories: entry.getDirectories().map(d => d.name)
            };
        }
        return { files: [], directories: [] };
    }

    public getAllFileEntries() {
        const fileEntries: VirtualFile[] = [];
        getFilesRecursive(this.root, fileEntries);
        return fileEntries;

        function getFilesRecursive(dir: VirtualDirectory, result: VirtualFile[]) {
            const files = dir.getFiles();
            const dirs = dir.getDirectories();
            for (const file of files) {
                result.push(file);
            }
            for (const subDir of dirs) {
                getFilesRecursive(subDir, result);
            }
        }
    }

    public clone(): VirtualFileSystem {
        const fs = new VirtualFileSystem(this.currentDirectory, this.useCaseSensitiveFileNames);
        fs._root = this.root.clone(fs);
        return fs;
    }

    protected makeReadOnlyCore() {
        this.root.makeReadOnly();
    }

    protected getOwnFileSystemEntries() {
        return this.root.getFileSystemEntries();
    }
}

export class VirtualDirectory extends VirtualFileSystemContainer {
    private _entries: VirtualFileSystemEntry[] | undefined;
    private _resolver: FileSystemResolver | undefined;
    private _shadowRoot: VirtualDirectory | undefined;

    constructor(parent: VirtualFileSystemContainer, name: string, resolver?: FileSystemResolver) {
        super(parent, name);
        this._entries = undefined;
        this._resolver = resolver;
        this._shadowRoot = undefined;
    }

    private get entries(): VirtualFileSystemEntry[] {
        if (!this._entries) {
            const resolver = this._resolver;
            const shadowRoot = this._shadowRoot;
            this._entries = [];
            this._resolver = undefined;
            this._shadowRoot = undefined;
            if (resolver) {
                const { files, directories } = resolver.getEntries(this);
                for (const dir of directories) {
                    const vdir = new VirtualDirectory(this, dir, resolver);
                    if (this.isReadOnly) vdir.makeReadOnly();
                    this._entries.push(vdir);
                }
                for (const file of files) {
                    const vfile = new VirtualFile(this, file, file => resolver.getContent(file));
                    if (this.isReadOnly) vfile.makeReadOnly();
                    this._entries.push(vfile);
                }
            }
            else if (shadowRoot) {
                for (const entry of shadowRoot.entries) {
                    const clone = entry.clone(this);
                    if (this.isReadOnly) clone.makeReadOnly();
                    this._entries.push(clone);
                }
            }
        }
        return this._entries;
    }

    public addDirectory(name: string, resolver?: FileSystemResolver): VirtualDirectory | undefined {
        this.writePreamble();
        let entry = this.getFileSystemEntry(name);
        if (entry === undefined) {
            entry = new VirtualDirectory(this, name, resolver);
            this.entries.push(entry);
        }
        return entry instanceof VirtualDirectory ? entry : undefined;
    }

    public addFile(name: string, content?: FileSystemResolver["getContent"] | string | undefined): VirtualFile | undefined {
        this.writePreamble();
        let entry = this.getFileSystemEntry(name);
        if (entry === undefined) {
            entry = new VirtualFile(this, name, content);
            this.entries.push(entry);
        }
        return entry instanceof VirtualFile ? entry : undefined;
    }

    public addSymlink(name: string, target: VirtualFile): VirtualFileSymlink | undefined;
    public addSymlink(name: string, target: VirtualDirectory): VirtualDirectorySymlink | undefined;
    public addSymlink(name: string, target: string | VirtualFile | VirtualDirectory): VirtualSymlink | undefined;
    public addSymlink(name: string, target: string | VirtualFile | VirtualDirectory): VirtualSymlink | undefined {
        this.writePreamble();

        const targetEntry = typeof target === "string"
            ? this.fileSystem.traversePath(vpath.resolve(this.path, target))
            : target;

        if (targetEntry === undefined) {
            return undefined;
        }

        let entry = this.getFileSystemEntry(name);
        if (entry === undefined) {
            if (targetEntry instanceof VirtualFile) {
                entry = new VirtualFileSymlink(this, name, targetEntry.path);
            }
            else if (targetEntry instanceof VirtualDirectory) {
                entry = new VirtualDirectorySymlink(this, name, targetEntry.path);
            }
            else {
                return undefined;
            }

            this.entries.push(entry);
        }

        if (target instanceof VirtualFile) {
            return entry instanceof VirtualFileSymlink ? entry : undefined;
        }
        else if (target instanceof VirtualDirectory) {
            return entry instanceof VirtualDirectorySymlink ? entry : undefined;
        }

        return entry instanceof VirtualFileSymlink || entry instanceof VirtualDirectorySymlink ? entry : undefined;
    }

    public removeDirectory(name: string): boolean {
        this.writePreamble();
        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            if (this.fileSystem.sameName(name, entry.name) && entry instanceof VirtualDirectory) {
                this.entries.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    public removeFile(name: string): boolean {
        this.writePreamble();
        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            if (this.fileSystem.sameName(name, entry.name) && entry instanceof VirtualFile) {
                this.entries.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    public clone(parent: VirtualFileSystemContainer): VirtualDirectory {
        const clone = new VirtualDirectory(parent, this.name);
        clone._shadowRoot = this;
        return clone;
    }

    protected makeReadOnlyCore(): void {
        for (const entry of this.entries) {
            entry.makeReadOnly();
        }
    }

    protected getOwnFileSystemEntries() {
        return this.entries;
    }
}

export class VirtualDirectorySymlink extends VirtualDirectory {
    private _target: string;

    constructor(parent: VirtualFileSystemContainer, name: string, target: string) {
        super(parent, name);
        this._target = target;
    }

    public get target() {
        return this._target;
    }

    public set target(value: string) {
        this.writePreamble();
        this._target = value;
    }

    public get isBroken(): boolean {
        return this.targetDirectory === undefined;
    }

    public get targetDirectory(): VirtualDirectory | undefined {
        const entry = findTarget(this.fileSystem, this.target);
        return entry instanceof VirtualDirectory ? entry : undefined;
    }

    public addDirectory(name: string, resolver?: FileSystemResolver): VirtualDirectory | undefined {
        const target = this.targetDirectory;
        return target && target.addDirectory(name, resolver);
    }

    public addFile(name: string, content?: FileSystemResolver["getContent"] | string | undefined): VirtualFile | undefined {
        const target = this.targetDirectory;
        return target && target.addFile(name, content);
    }

    public removeDirectory(name: string): boolean {
        const target = this.targetDirectory;
        return target && target.removeDirectory(name) || false;
    }

    public removeFile(name: string): boolean {
        const target = this.targetDirectory;
        return target && target.removeFile(name) || false;
    }

    public clone(parent: VirtualFileSystemContainer): VirtualDirectory {
        return new VirtualDirectorySymlink(parent, this.name, this.target);
    }
}

export class VirtualFile extends VirtualFileSystemEntry {
    private _content: string | undefined;
    private _resolver: FileSystemResolver["getContent"] | undefined;
    private _shadowRoot: VirtualFile | undefined;

    constructor(parent: VirtualDirectory, name: string, content?: FileSystemResolver["getContent"] | string | undefined) {
        super(parent, name);
        this._content = typeof content === "string" ? content : undefined;
        this._resolver = typeof content === "function" ? content : undefined;
        this._shadowRoot = undefined;
    }

    public get content(): string | undefined {
        if (this._content === undefined) {
            const resolver = this._resolver;
            const shadowRoot = this._shadowRoot;
            this._resolver = undefined;
            this._shadowRoot = undefined;
            if (resolver) {
                this._content = resolver(this);
            }
            else if (shadowRoot) {
                this._content = shadowRoot.content;
            }
        }
        return this._content;
    }

    public set content(value: string | undefined) {
        this.writePreamble();
        this._resolver = undefined;
        this._content = value;
    }

    public clone(parent: VirtualDirectory): VirtualFile {
        const clone = new VirtualFile(parent, this.name);
        clone._shadowRoot = this;
        return clone;
    }

    protected makeReadOnlyCore(): void {
    }
}

export class VirtualFileSymlink extends VirtualFile {
    private _target: string;

    constructor(parent: VirtualDirectory, name: string, target: string) {
        super(parent, name);
        this._target = target;
    }

    public get target(): string {
        return this._target;
    }

    public set target(value: string) {
        this.writePreamble();
        this._target = value;
    }

    public get isBroken(): boolean {
        return this.targetFile === undefined;
    }

    public get targetFile(): VirtualFile | undefined {
        const entry = findTarget(this.fileSystem, this.target);
        return entry instanceof VirtualFile ? entry : undefined;
    }

    public get content(): string | undefined {
        const target = this.targetFile;
        return target && target.content;
    }

    public set content(value: string | undefined) {
        const target = this.targetFile;
        if (target) target.content = value;
    }

    public clone(parent: VirtualDirectory) {
        return new VirtualFileSymlink(parent, this.name, this.target);
    }
}

export type VirtualSymlink = VirtualDirectorySymlink | VirtualFileSymlink;

function findTarget(vfs: VirtualFileSystem, target: string, set?: Set<VirtualFileSymlink | VirtualDirectorySymlink>): VirtualFileSystemEntry | undefined {
    const entry = vfs.traversePath(target);
    if (entry instanceof VirtualFileSymlink || entry instanceof VirtualDirectorySymlink) {
        if (!set) set = new Set<VirtualFileSymlink | VirtualDirectorySymlink>();
        if (set.has(entry)) return undefined;
        set.add(entry);
        return findTarget(vfs, entry.target, set);
    }
    return entry;
}