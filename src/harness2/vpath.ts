import { compareStrings } from "./utils";

export function normalizeSlashes(path: string): string {
    return path.replace(/\\/g, "/");
}

const rootRegExp = /^\/(\/(.*?\/(.*?\/)?)?)?|^[a-zA-Z]:\/?|^\w+:\/{2}[^/]*\/?/;

function getRootLength(path: string) {
    const match = rootRegExp.exec(path);
    return match ? match[0].length : 0;
}

export function isAbsolute(path: string) {
    return getRootLength(normalizeSlashes(path)) === 0;
}

function getNormalizedParts(normalizedSlashedPath: string, rootLength: number) {
    const parts = normalizedSlashedPath.substr(rootLength).split("/");
    const normalized: string[] = [];
    for (const part of parts) {
        if (part === ".") continue;
        if (part === ".." && normalized.length > 0 && normalized[normalized.length - 1] !== "..") {
            normalized.pop();
        }
        else {
            if (part) normalized.push(part);
        }
    }
    return normalized;
}

export function normalize(path: string): string {
    path = normalizeSlashes(path);
    const rootLength = getRootLength(path);
    const root = path.substr(0, rootLength);
    const normalized = getNormalizedParts(path, rootLength);
    if (normalized.length) {
        const joinedParts = root + normalized.join("/");
        return path.charAt(path.length - 1) === "/" ? joinedParts + "/" : joinedParts;
    }
    else {
        return root;
    }
}

export function combine(path: string, ...paths: string[]) {
    path = normalizeSlashes(path);
    for (const name of paths) {
        path = combinePaths(path, normalizeSlashes(name));
    }
    return path;
}

export function relative(from: string, to: string, ignoreCase: boolean) {
    if (!isAbsolute(from)) throw new Error("Path not absolute: from");
    if (!isAbsolute(to)) throw new Error("Path not absolute: to");

    const fromComponents = parse(from);
    const toComponents = parse(to);

    let start: number;
    for (start = 0; start < fromComponents.length && start < toComponents.length; start++) {
        if (compareStrings(fromComponents[start], toComponents[start], ignoreCase)) {
            break;
        }
    }

    const components = toComponents.slice(start);
    for (; start < fromComponents.length; start++) {
        components.unshift("..");
    }

    return format(components);
}

function combinePaths(path1: string, path2: string) {
    if (path1.length === 0) return path2;
    if (path2.length === 0) return path1;
    if (getRootLength(path2) !== 0) return path2;
    if (path1.charAt(path1.length - 1) === "/") return path1 + path2;
    return path1 + "/" + path2;
}

export function resolve(path: string, ...paths: string[]) {
    return normalize(combine(path, ...paths));
}

export function parse(path: string) {
    path = normalizeSlashes(path);
    const rootLength = getRootLength(path);
    return [path.substr(0, rootLength), ...getNormalizedParts(path, rootLength)];
}

export function format(components: string[]) {
    return components.length ? components[0] + components.slice(1).join("/") : "";
}

export function basename(path: string) {
    path = normalizeSlashes(path);
    return path.substr(Math.max(getRootLength(path), path.lastIndexOf("/") + 1));
}

export function dirname(path: string) {
    path = normalizeSlashes(path);
    return path.substr(0, Math.max(getRootLength(path), path.lastIndexOf("/")));
}