export interface TelegramDriveConfig {
  bots: { id: string; alias?: string; display?: string; token: string }[];
  channels: { id: string; alias?: string; display?: string }[];
  chunkSizeBytes?: number;
  concurrency?: number;
  rate?: { perBotChatPerMinute?: number; globalPerSecond?: number };
  dbPath?: string;
  workDir?: string;
  configPath?: string;
  baseDir?: string;
}

export interface Folder { id: string; name: string; parent_id: string | null; created_at: string; status: string; }
export interface FileRecord { id: string; name: string; size: number; sha256: string; status: string; folder_id: string | null; num_chunks: number; created_at: string; [key: string]: any; }
export interface UploadResult { fileId: string; name: string; size: number; chunks: number; }
export interface DownloadResult { outPath: string; size: number; sha256: string; }

export class TelegramDrive {
  constructor(config: string | TelegramDriveConfig, driveKey?: string, options?: { quiet?: boolean; });
  config: TelegramDriveConfig;
  db: any;
  folders: {
    list(parent?: string | null, recursive?: boolean): Promise<Folder[]>;
    create(name: string, options?: { parent?: string | null; parentId?: string | null }): Promise<Folder>;
    get(id: string): Promise<Folder | null>;
    rename(id: string, name: string): Promise<Folder | null>;
    delete(id: string): Promise<boolean>;
  };
  files: {
    upload(filePath: string, options?: { folderId?: string | null; folder?: string | null; fresh?: boolean; cleanupOnFail?: boolean; onProgress?: (info: any) => void }): Promise<UploadResult>;
    download(fileId: string, outPath?: string | null, options?: { onProgress?: (info: any) => void }): Promise<DownloadResult>;
    list(options?: { folderId?: string | null; folder?: string | null; all?: boolean; recursive?: boolean }): FileRecord[];
    get(fileId: string): Promise<FileRecord | null>;
    move(fileId: string, folderId: string | null | "root" | "null" | "none"): Promise<FileRecord | null>;
    verify(fileId: string, options?: { onProgress?: (info: any) => void }): Promise<DownloadResult & { verified: boolean }>;
    delete(fileId: string): Promise<boolean>;
  };
  cleanupFailed(): Promise<string[]>;
  backup(outPath?: string | null): Promise<string>;
  exportBundle(outPath: string): Promise<string>;
  importBundle(inPath: string): Promise<number>;
  portable(outDir?: string): Promise<{ dir: string; dbDest: string; bundleDest: string }>;
  doctor(): Promise<any>;
  close(): void;
}

export function createDrive(config: string | TelegramDriveConfig, driveKey?: string, options?: { quiet?: boolean }): TelegramDrive;
export function createTelegramDrive(config: string | TelegramDriveConfig, driveKey?: string, options?: { quiet?: boolean }): TelegramDrive;
export default TelegramDrive;
