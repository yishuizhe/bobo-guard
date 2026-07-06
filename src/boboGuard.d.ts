export type Severity = 'high' | 'medium' | 'low';

export interface ScanRisk {
  id: string;
  severity: Severity;
  title: string;
  location: string;
  line: number;
  evidence: string;
  advice: string;
}

export interface ScanReport {
  root: string;
  scannedAt: string;
  score: number;
  filesScanned: number;
  bytesScanned: number;
  skipped: {
    files: number;
    directories: number;
    largeFiles: number;
  };
  counts: Record<Severity, number>;
  risks: ScanRisk[];
  gitignoreSuggestions: string[];
}

export type RepoAction = 'keep' | 'improve' | 'private' | 'archive';

export interface RepoRecommendation {
  id: number;
  name: string;
  url: string;
  action: RepoAction;
  label: string;
  reason: string;
  private: boolean;
  archived: boolean;
  language: string | null;
  stars: number;
  updatedAt: string;
}

export interface GitHubAudit {
  scannedAt: string;
  counts: {
    total: number;
    public: number;
    private: number;
    archived: number;
    improve: number;
    makePrivate: number;
    archive: number;
  };
  recommendations: RepoRecommendation[];
}

declare global {
  interface Window {
    boboGuard?: {
      selectDirectory: () => Promise<string | null>;
      scanDirectory: (targetPath: string) => Promise<ScanReport>;
      auditGitHub: () => Promise<GitHubAudit>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
