import * as VirtualPath from "./vpath";

export interface IO {
    newLine(): string;
    useCaseSensitiveFileNames(): boolean;
    getCurrentDirectory(): string;
    getExecutingFilePath(): string;
    getEnvironmentVariable(name: string): string;
    args(): string[];
    fileExists(path: string): boolean;
    directoryExists(path: string): boolean;
    getAccessibleFileSystemEntries(path: string): FileSystemEntries;
    getDirectories(path: string, options?: { recursive?: boolean, pattern?: RegExp, qualified?: boolean }): string[];
    getFiles(path: string, options?: { recursive?: boolean, pattern?: RegExp, qualified?: boolean }): string[];
    createDirectory(path: string): void;
    readFile(path: string): string | undefined;
    writeFile(path: string, contents: string): void;
    deleteFile(fileName: string): void;
    exit(exitCode?: number): void;
}

export interface FileSystemEntries {
    files: string[];
    directories: string[];
}

function createNodeIO(): IO {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const platform = os.platform();
    const useCaseSensitiveFileNames = isFileSystemCaseSensitive();
    const args = process.argv.slice(2);
    const executingFilePath = path.join(__dirname, "run.js");
    const collator = typeof Intl === "object" ? new Intl.Collator(/*locales*/ undefined, { usage: "sort", sensitivity: useCaseSensitiveFileNames ? "variant" : "accent" }) : undefined;
    return {
        newLine() {
            return "\r\n";
        },
        useCaseSensitiveFileNames() {
            return useCaseSensitiveFileNames;
        },
        getCurrentDirectory() {
            return process.cwd();
        },
        getExecutingFilePath() {
            return executingFilePath;
        },
        getEnvironmentVariable(name) {
            return process.env[name] as string || "";
        },
        args() {
            return args;
        },
        fileExists(name) {
            try {
                return fs.statSync(name).isFile() as boolean;
            }
            catch (e) {
                return false;
            }
        },
        directoryExists(name): boolean {
            try {
                return fs.statSync(name).isDirectory() as boolean;
            }
            catch (e) {
                return false;
            }
        },
        getAccessibleFileSystemEntries,
        getFiles(name, options) {
            return getEntries(name, options, "files");
        },
        getDirectories(name, options) {
            return getEntries(name, options, "directories");
        },
        createDirectory(name) {
            try {
                fs.mkdirSync(name);
            }
            catch (e) { }
        },
        readFile(name) {
            try {
                const buffer = fs.readFileSync(name);
                let len = buffer.length;
                if (len >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
                    // Big endian UTF-16 byte order mark detected. Since big endian is not supported by node.js,
                    // flip all byte pairs and treat as little endian.
                    len &= ~1; // Round down to a multiple of 2
                    for (let i = 0; i < len; i += 2) {
                        const temp = buffer[i];
                        buffer[i] = buffer[i + 1];
                        buffer[i + 1] = temp;
                    }
                    return buffer.toString("utf16le", 2);
                }
                if (len >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
                    // Little endian UTF-16 byte order mark detected
                    return buffer.toString("utf16le", 2);
                }
                if (len >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
                    // UTF-8 byte order mark detected
                    return buffer.toString("utf8", 3);
                }
                // Default is UTF-8 with no byte order mark
                return buffer.toString("utf8");
            }
            catch (e) {
                return undefined;
            }
        },
        writeFile(name, contents) {
            fs.writeFileSync(name, contents, "utf8");
        },
        deleteFile(name) {
            try {
                fs.unlinkSync(name);
            }
            catch (e) { }
        },
        exit(exitCode) {
            process.exit(exitCode);
        }
    };

    function isFileSystemCaseSensitive() {
        if (platform === "win32" || <string>platform === "win64") {
            return false;
        }
        return !fileExists(__filename.toUpperCase())
            || !fileExists(__filename.toLowerCase());
    }

    function compareStrings(a: string, b: string) {
        if (a === b) return 0;
        if (a === undefined || a === null) return -1;
        if (b === undefined || b === null) return +1;
        if (collator) return collator.compare(a, b);
        a = a.toUpperCase();
        b = b.toUpperCase();
        return a < b ? -1 : a > b ? +1 : 0;
    }

    function getAccessibleFileSystemEntries(dirname: string): FileSystemEntries {
        try {
            const entries: string[] = fs.readdirSync(dirname || ".").sort(compareStrings);
            const files: string[] = [];
            const directories: string[] = [];
            for (const entry of entries) {
                if (entry === "." || entry === "..") continue;
                const name = path.join(dirname, entry);
                try {
                    const stat = fs.statSync(name);
                    if (!stat) continue;
                    if (stat.isFile()) {
                        files.push(entry);
                    }
                    else if (stat.isDirectory()) {
                        directories.push(entry);
                    }
                }
                catch (e) { }
            }
            return { files, directories };
        }
        catch (e) {
            return { files: [], directories: [] };
        }
    }

    function getEntries(dirname: string, options: { recursive?: boolean, pattern?: RegExp, qualified?: boolean } | undefined, kind: "files" | "directories"): string[] {
        const recursive = options && options.recursive || false;
        const pattern = options && options.pattern;
        const qualified = options && options.qualified;
        const results: string[] = [];
        getEntriesWorker(dirname, qualified ? dirname : "", recursive, pattern, kind, results);
        if (recursive) results.sort(compareStrings);
        return results;
    }

    function getEntriesWorker(dirname: string, qualifiedname: string, recursive: boolean, pattern: RegExp | undefined, kind: "files" | "directories", results: string[]) {
        const entries = getAccessibleFileSystemEntries(dirname);
        const names = entries[kind];
        for (const name of names) {
            if (pattern && !pattern.test(name)) continue;
            results.push(VirtualPath.combine(qualifiedname, name));
        }
        if (recursive) {
            for (const name of entries.directories) {
                getEntriesWorker(path.join(dirname, name), VirtualPath.combine(qualifiedname, name), /*recursive*/ true, pattern, kind, results);
            }
        }
    }
}

function createIO() {
    return createNodeIO();
}

export const {
    newLine,
    useCaseSensitiveFileNames,
    getCurrentDirectory,
    getExecutingFilePath,
    getEnvironmentVariable,
    args,
    getAccessibleFileSystemEntries,
    directoryExists,
    getDirectories,
    createDirectory,
    fileExists,
    getFiles,
    readFile,
    writeFile,
    deleteFile,
    exit,
} = createIO();