export interface WriteFileOptions {
    overwrite?: boolean;
}

export declare function writeFile(
    filePath: string,
    content: string,
    options?: WriteFileOptions
): Promise<string>;
/** True when the path exists (file or folder). */
export declare function exists(filePath: string): Promise<boolean>;
