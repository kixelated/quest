import type { Enrollment, ProjectPreview } from "./github/service";
import { Difficulty, Marker } from "./layout";
import { title } from "./board/model";

export function projectURL(owner: string, name: string) {
	return `/projects/github/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function ProjectsPage(props: { projects: Enrollment[]; installation: string | null; error?: string }) {
	return (
		<section class="wrap docs projects">
			<h1>Project setup</h1>
			<p class="intro">
				Choose a public open-source repository you maintain. Keep its issues, reviews, CI, and merge protections
				on GitHub.
			</p>
			{props.error && <p role="alert">{props.error}</p>}
			<section class="ql-panel panel">
				<h2>Install the GitHub App</h2>
				<p>
					Give the App access to the repository you select. Installation alone does not enable contributions.
				</p>
				{props.installation ? (
					<p>
						<a class="button quiet" href={props.installation}>
							Install or configure the App
						</a>
					</p>
				) : (
					<p class="muted">The operator has not configured the GitHub App yet.</p>
				)}
			</section>
			<section class="ql-panel panel">
				<h2>Select a repository</h2>
				<p>
					We verify your linked GitHub account has current maintain or admin authority, then read Quest files
					on the default branch.
				</p>
				<form method="get" action="/projects/select" class="project-select">
					<label for="repository">GitHub owner/repository</label>
					<input id="repository" name="repository" placeholder="your-org/your-project" required />
					<button class="button primary">Review project</button>
				</form>
				<p class="note-small">
					No Quest files yet? <a href="/setup">Follow the existing setup guide</a>, then return here. Setup is
					a separate choice and never changes your repository automatically.
				</p>
				<p class="note-small">
					Using Google or a passkey? <a href="/account">Link your GitHub account</a> first. Funding a quest
					does not grant maintainer permissions.
				</p>
			</section>
			{props.projects.length > 0 && (
				<section>
					<h2>Your enrolled projects</h2>
					<ul>
						{props.projects.map((project) => (
							<li>
								<a href={projectURL(project.owner, project.name)}>
									{project.owner}/{project.name}
								</a>{" "}
								· {project.state === "enabled" ? "Contributions enabled" : "Contributions paused"}
								<form method="post" action={projectURL(project.owner, project.name)}>
									<input type="hidden" name="id" value={project.id} />
									{project.state === "enabled" && (
										<button class="button quiet" name="state" value="paused">
											Pause contributions
										</button>
									)}
									<button class="button quiet" name="state" value="disconnected">
										Disconnect project
									</button>
								</form>
							</li>
						))}
					</ul>
				</section>
			)}
		</section>
	);
}

export function ProjectSetupPage(props: { preview: ProjectPreview; error?: string }) {
	const { preview } = props;
	const repo = preview.repository;
	const href = `https://github.com/${repo.owner}/${repo.name}`;
	const action = projectURL(repo.owner, repo.name);
	return (
		<section class="wrap docs projects">
			<p>
				<a href="/projects">Project setup</a>
			</p>
			<h1>
				{repo.owner}/{repo.name}
			</h1>
			{props.error && <p role="alert">{props.error}</p>}
			<section class="ql-panel panel">
				<h2>
					{preview.state === "enabled"
						? "Contributions enabled"
						: preview.state === "paused"
							? "Contributions paused"
							: "Enable contributions"}
				</h2>
				<p>
					Opting in makes ready quests on the default branch eligible for funded implementation. There is no
					second approval flag per quest. Your normal GitHub review rules, CI, and merge protections still
					apply.
				</p>
				{preview.licenseError ? (
					<p class="muted" role="alert">
						{preview.licenseError}
					</p>
				) : (
					<p class="muted">
						GitHub detects {preview.license?.name} ({preview.license?.spdx_id}), an OSI-approved license.
					</p>
				)}

				<form method="post" action={action}>
					<input type="hidden" name="id" value={repo.id} />
					<input type="hidden" name="state" value="enabled" />
					<button
						class="button primary"
						disabled={preview.licenseError !== null || preview.state === "enabled"}
					>
						{preview.state === "enabled"
							? "Contributions enabled"
							: preview.state === "paused"
								? "Resume contributions"
								: "Enable contributions"}
					</button>
				</form>
				{preview.state && (
					<>
						<p class="note-small">
							Pause stops new work. Disconnect removes this project's opt-in; it does not uninstall the
							App or change existing GitHub contributions.
						</p>
						{preview.state === "enabled" && (
							<form method="post" action={action}>
								<input type="hidden" name="id" value={repo.id} />
								<input type="hidden" name="state" value="paused" />
								<p>
									<button class="button quiet">Pause contributions</button>
								</p>
							</form>
						)}
						<form method="post" action={action}>
							<input type="hidden" name="id" value={repo.id} />
							<input type="hidden" name="state" value="disconnected" />
							<button class="button quiet">Disconnect project</button>
						</form>
					</>
				)}
			</section>
			<section>
				<h2>Ready quests</h2>
				<p class="muted">
					From <a href={`${href}/tree/${preview.commit}`}>{preview.branch}</a> at {preview.commit.slice(0, 7)}
					. This preview does not start work.
				</p>
				{preview.quests.length ? (
					<ul class="log">
						{preview.quests.map((quest) => {
							const heading = title(quest.title);
							return (
								<li class="entry">
									<Marker status="available" />
									<a
										class="entry-title"
										href={`${href}/blob/${preview.commit}/${quest.path.split("/").map(encodeURIComponent).join("/")}`}
									>
										{heading.name}
									</a>
									<span class="entry-meta">
										Ready{heading.size && <Difficulty size={heading.size} />}
									</span>
								</li>
							);
						})}
					</ul>
				) : (
					<p>No ready quests on the default branch yet. Update and merge your plans on GitHub.</p>
				)}
			</section>
		</section>
	);
}
