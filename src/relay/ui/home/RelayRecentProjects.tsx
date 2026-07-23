import type { RelayRecentProject } from './contracts';

export function RelayRecentProjects({ projects, onOpen }: { projects: RelayRecentProject[]; onOpen: (id: string) => void }) {
  return <section className="rh-recent" aria-labelledby="recent-heading"><h2 id="recent-heading">RECENT PROJECTS</h2>
    {projects.length === 0 ? <div className="rh-empty"><strong>No Relay projects yet.</strong><p>Start a new project or connect an existing one.</p></div>
      : <div className="rh-project-table" role="table">{projects.map((project) => <div role="row" key={project.id}>
        <div role="cell"><strong>{project.name}</strong><small>{project.lastActivity}</small></div>
        <span role="cell">{project.state}</span><span role="cell">{project.activeAgents.length} active agents</span>
        <span role="cell">{project.mode}</span><span role="cell">{project.completionStatus}</span>
        <button type="button" onClick={() => onOpen(project.id)}>CONTINUE →</button>
      </div>)}</div>}
  </section>;
}
