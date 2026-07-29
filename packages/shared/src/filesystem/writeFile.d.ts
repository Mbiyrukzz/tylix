export interface WriteFileOptions {
    overwrite?: boolean;
}

export declare function writeFile(
    filePath: string,
    content: string,
    options?: WriteFileOptions
): Promise<string>;