import type { CSSProperties, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  FolderOpen,
  GitBranch,
  KeyRound,
  Lock,
  Radar,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import boboShield from './assets/bobo-shield.svg'
import type { GitHubAudit, RepoAction, RepoRecommendation, ScanReport, ScanRisk, Severity } from './boboGuard'
import './App.css'

const severityCopy: Record<Severity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const actionOrder: RepoAction[] = ['private', 'archive', 'improve', 'keep']

function App() {
  const [selectedPath, setSelectedPath] = useState('')
  const [scanReport, setScanReport] = useState<ScanReport | null>(null)
  const [githubAudit, setGithubAudit] = useState<GitHubAudit | null>(null)
  const [activeView, setActiveView] = useState<'project' | 'github'>('project')
  const [isScanning, setIsScanning] = useState(false)
  const [isAuditing, setIsAuditing] = useState(false)
  const [notice, setNotice] = useState('Ready')

  const score = scanReport?.score ?? 100
  const displayRisks = useMemo(() => scanReport?.risks.slice(0, 80) ?? [], [scanReport])
  const groupedRepos = useMemo(() => groupRepos(githubAudit?.recommendations ?? []), [githubAudit])

  async function chooseFolder() {
    if (!window.boboGuard) {
      setNotice('Electron bridge is unavailable. Run npm run dev for the desktop app.')
      return null
    }

    const pickedPath = await window.boboGuard.selectDirectory()
    if (pickedPath) {
      setSelectedPath(pickedPath)
      setNotice('Folder selected')
    }
    return pickedPath
  }

  async function scanProject(pathOverride?: string) {
    if (!window.boboGuard) {
      setNotice('Electron bridge is unavailable. Run npm run dev for the desktop app.')
      return
    }

    const target = pathOverride || selectedPath || (await chooseFolder())
    if (!target) {
      return
    }

    setIsScanning(true)
    setNotice('Scanning project')
    setActiveView('project')
    try {
      const report = await window.boboGuard.scanDirectory(target)
      setSelectedPath(report.root)
      setScanReport(report)
      setNotice(report.risks.length === 0 ? 'Project is clean' : `${report.risks.length} project risks found`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Project scan failed')
    } finally {
      setIsScanning(false)
    }
  }

  async function auditGitHub() {
    if (!window.boboGuard) {
      setNotice('Electron bridge is unavailable. Run npm run dev for the desktop app.')
      return
    }

    setIsAuditing(true)
    setNotice('Auditing GitHub')
    setActiveView('github')
    try {
      const audit = await window.boboGuard.auditGitHub()
      setGithubAudit(audit)
      setNotice(`${audit.counts.total} GitHub repositories checked`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'GitHub audit failed')
    } finally {
      setIsAuditing(false)
    }
  }

  async function copyReport() {
    const report = buildMarkdownReport(scanReport, githubAudit)
    await navigator.clipboard.writeText(report)
    setNotice('Report copied')
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <img src={boboShield} className="brand-mark" alt="" />
          <div>
            <h1>Bobo Guard</h1>
            <p>Local-first dev security</p>
          </div>
        </div>

        <div className="status-panel">
          <div className="score-dial" style={{ '--score': `${score * 3.6}deg` } as CSSProperties}>
            <span>{score}</span>
          </div>
          <div>
            <strong>{notice}</strong>
            <p>{selectedPath ? compactPath(selectedPath) : 'No folder selected'}</p>
          </div>
        </div>

        <div className="command-stack" aria-label="Primary actions">
          <button type="button" onClick={chooseFolder}>
            <FolderOpen size={18} />
            Pick Folder
          </button>
          <button type="button" onClick={() => scanProject()} disabled={isScanning}>
            <ScanLine size={18} />
            {isScanning ? 'Scanning' : 'Scan Project'}
          </button>
          <button type="button" onClick={auditGitHub} disabled={isAuditing}>
            <GitBranch size={18} />
            {isAuditing ? 'Auditing' : 'Audit GitHub'}
          </button>
          <button type="button" onClick={copyReport} disabled={!scanReport && !githubAudit}>
            <Clipboard size={18} />
            Copy Report
          </button>
        </div>

        <div className="mini-metrics">
          <Metric label="Files" value={scanReport ? String(scanReport.filesScanned) : '-'} />
          <Metric label="Secrets" value={scanReport ? String(scanReport.counts.high) : '-'} tone="danger" />
          <Metric label="Repos" value={githubAudit ? String(githubAudit.counts.total) : '-'} />
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Developer security workbench</p>
            <h2>Leak checks, repo hygiene, and profile polish in one pass.</h2>
          </div>
          <div className="view-toggle" aria-label="View">
            <button type="button" className={activeView === 'project' ? 'active' : ''} onClick={() => setActiveView('project')}>
              <ShieldCheck size={17} />
              Project
            </button>
            <button type="button" className={activeView === 'github' ? 'active' : ''} onClick={() => setActiveView('github')}>
              <GitBranch size={17} />
              GitHub
            </button>
          </div>
        </header>

        {activeView === 'project' ? (
          <ProjectView report={scanReport} risks={displayRisks} onScan={() => scanProject()} />
        ) : (
          <GitHubView audit={githubAudit} groupedRepos={groupedRepos} onAudit={auditGitHub} />
        )}
      </section>
    </main>
  )
}

function ProjectView({ report, risks, onScan }: { report: ScanReport | null; risks: ScanRisk[]; onScan: () => void }) {
  if (!report) {
    return (
      <div className="empty-state">
        <Radar size={42} />
        <h3>Project scan pending</h3>
        <p>Select a repository folder and run the first local scan.</p>
        <button type="button" onClick={onScan}>
          <ScanLine size={18} />
          Start Scan
        </button>
      </div>
    )
  }

  return (
    <div className="content-grid">
      <section className="panel span-two">
        <PanelTitle icon={<ShieldCheck size={18} />} title="Project Health" />
        <div className="stat-grid">
          <Metric label="Score" value={`${report.score}/100`} tone={report.score >= 80 ? 'good' : 'warn'} />
          <Metric label="Files scanned" value={String(report.filesScanned)} />
          <Metric label="Bytes scanned" value={formatBytes(report.bytesScanned)} />
          <Metric label="Skipped large" value={String(report.skipped.largeFiles)} />
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={<KeyRound size={18} />} title="Risk Mix" />
        <div className="severity-stack">
          <SeverityBar severity="high" count={report.counts.high} total={report.risks.length} />
          <SeverityBar severity="medium" count={report.counts.medium} total={report.risks.length} />
          <SeverityBar severity="low" count={report.counts.low} total={report.risks.length} />
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={<Sparkles size={18} />} title=".gitignore Patch" />
        {report.gitignoreSuggestions.length === 0 ? (
          <p className="quiet">No missing secret ignore rules.</p>
        ) : (
          <div className="ignore-list">
            {report.gitignoreSuggestions.map((item) => (
              <code key={item}>{item}</code>
            ))}
          </div>
        )}
      </section>

      <section className="panel span-two">
        <PanelTitle icon={<AlertTriangle size={18} />} title="Findings" />
        {risks.length === 0 ? (
          <div className="success-line">
            <CheckCircle2 size={20} />
            No obvious secret leaks found in scanned text files.
          </div>
        ) : (
          <div className="finding-list">
            {risks.map((risk) => (
              <article className={`finding ${risk.severity}`} key={risk.id}>
                <span className="severity-pill">{severityCopy[risk.severity]}</span>
                <div>
                  <h3>{risk.title}</h3>
                  <p className="mono-line">
                    {risk.location}:{risk.line} · {risk.evidence}
                  </p>
                  <p>{risk.advice}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function GitHubView({
  audit,
  groupedRepos,
  onAudit,
}: {
  audit: GitHubAudit | null;
  groupedRepos: Record<RepoAction, RepoRecommendation[]>;
  onAudit: () => void;
}) {
  if (!audit) {
    return (
      <div className="empty-state">
        <GitBranch size={42} />
        <h3>GitHub audit pending</h3>
        <p>Use the local Git credential to review repo visibility and polish.</p>
        <button type="button" onClick={onAudit}>
          <GitBranch size={18} />
          Audit GitHub
        </button>
      </div>
    )
  }

  return (
    <div className="content-grid">
      <section className="panel span-two">
        <PanelTitle icon={<GitBranch size={18} />} title="Repository Map" />
        <div className="stat-grid">
          <Metric label="Total" value={String(audit.counts.total)} />
          <Metric label="Public" value={String(audit.counts.public)} />
          <Metric label="Private" value={String(audit.counts.private)} />
          <Metric label="Archived" value={String(audit.counts.archived)} />
        </div>
      </section>

      {actionOrder.map((action) => (
        <section className="panel span-two repo-section" key={action}>
          <PanelTitle icon={iconForAction(action)} title={titleForAction(action)} />
          {groupedRepos[action].length === 0 ? (
            <p className="quiet">Nothing in this lane.</p>
          ) : (
            <div className="repo-list">
              {groupedRepos[action].map((repo) => (
                <article className="repo-row" key={repo.id}>
                  <div>
                    <h3>{repo.name}</h3>
                    <p>{repo.reason}</p>
                    <div className="repo-meta">
                      <span>{repo.language || 'mixed'}</span>
                      <span>{repo.private ? 'private' : 'public'}</span>
                      <span>{repo.stars} stars</span>
                    </div>
                  </div>
                  <button type="button" className="icon-button" title="Open on GitHub" onClick={() => window.boboGuard?.openExternal(repo.url)}>
                    <ExternalLink size={17} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'danger' }) {
  return (
    <div className={`metric ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h3>{title}</h3>
    </div>
  )
}

function SeverityBar({ severity, count, total }: { severity: Severity; count: number; total: number }) {
  const width = total === 0 ? 0 : Math.max(6, Math.round((count / total) * 100))
  return (
    <div className="severity-row">
      <div>
        <span>{severityCopy[severity]}</span>
        <strong>{count}</strong>
      </div>
      <div className="bar-track">
        <span className={severity} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function groupRepos(recommendations: RepoRecommendation[]) {
  const grouped: Record<RepoAction, RepoRecommendation[]> = {
    keep: [],
    improve: [],
    private: [],
    archive: [],
  }
  for (const repo of recommendations) {
    grouped[repo.action].push(repo)
  }
  return grouped
}

function iconForAction(action: RepoAction) {
  if (action === 'private') return <Lock size={18} />
  if (action === 'archive') return <Archive size={18} />
  if (action === 'improve') return <Sparkles size={18} />
  return <CheckCircle2 size={18} />
}

function titleForAction(action: RepoAction) {
  if (action === 'private') return 'Private Candidates'
  if (action === 'archive') return 'Archive Candidates'
  if (action === 'improve') return 'Improve Showcase'
  return 'Keep Active'
}

function compactPath(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : value
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function buildMarkdownReport(scan: ScanReport | null, audit: GitHubAudit | null) {
  const lines = ['# Bobo Guard Report', '']
  if (scan) {
    lines.push(`## Project Scan`, `- Root: ${scan.root}`, `- Score: ${scan.score}/100`, `- Files scanned: ${scan.filesScanned}`, `- Risks: ${scan.risks.length}`, '')
    for (const risk of scan.risks.slice(0, 20)) {
      lines.push(`- [${severityCopy[risk.severity]}] ${risk.title} at ${risk.location}:${risk.line}`)
    }
    lines.push('')
  }
  if (audit) {
    lines.push(`## GitHub Audit`, `- Repositories: ${audit.counts.total}`, `- Public: ${audit.counts.public}`, `- Private: ${audit.counts.private}`, `- Archived: ${audit.counts.archived}`, '')
    for (const repo of audit.recommendations.filter((item) => item.action !== 'keep').slice(0, 20)) {
      lines.push(`- ${repo.label}: ${repo.name} - ${repo.reason}`)
    }
  }
  return lines.join('\n')
}

export default App
