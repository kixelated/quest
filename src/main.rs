use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::Result;
use clap::{Parser, Subcommand};

/// The quest tree, the interlinked Markdown plans under quest/: validate its
/// structure, report what blocks a quest, name a quest branch and its trunk, and
/// print the guide and skills agents follow.
#[derive(Parser)]
#[command(version, about)]
struct Cli {
	/// Repository root holding the quest/ directory.
	#[arg(long, default_value = ".", global = true)]
	root: PathBuf,

	#[command(subcommand)]
	command: Command,
}

#[derive(Subcommand)]
enum Command {
	/// Report every structural mistake in the tree; exit non-zero if any.
	Check,

	/// Print what blocks a quest, or list every ready quest.
	///
	/// Exits 0 either way: the blocker list on stdout is the result, so no
	/// output means ready and a caller tests that rather than parsing prose. A
	/// non-zero exit means the command itself failed.
	Ready {
		/// Quest to explain. Omit to list every ready quest in tree order.
		path: Option<PathBuf>,

		/// Read the tree from this remote's default branch. Fetch and run
		/// `git remote set-head <remote> --auto` first; this reads cached refs.
		#[arg(long, default_value = "origin")]
		remote: String,

		/// Read only the working tree, including uncommitted plans.
		#[arg(long, conflicts_with = "remote")]
		local: bool,
	},

	/// Print the quest branch and the remote's default branch, one per line.
	///
	/// Every quest targets that shared trunk, including a questline README's
	/// remaining work. Questlines have no shared feature branch.
	Branch {
		/// Quest or questline to locate on the fetched default branch.
		path: PathBuf,

		/// Remote whose default branch is the shared development trunk.
		#[arg(long, default_value = "origin")]
		remote: String,
	},

	/// Print the quest guide: the format, workflow, and rules agents follow.
	Guide,

	/// Print a skill's instructions, or list the skills with no name.
	///
	/// A repository installs only a stub per skill, which runs this, so the
	/// pinned binary decides what every agent follows.
	Skill {
		/// Skill to print.
		name: Option<String>,

		/// Print the stub SKILL.md a repository installs instead.
		#[arg(long, requires = "name")]
		stub: bool,
	},

	/// Install skill stubs, a quest root, and agent pointers for this repository.
	Init,

	/// Remove Quest stubs and markers installed by `quest init`.
	Uninstall,
}

fn main() -> Result<ExitCode> {
	let cli = Cli::parse();
	match cli.command {
		Command::Check => {
			let findings = quest::check(&cli.root)?;
			if findings.is_empty() {
				let total = quest::collect(&cli.root)?.len();
				println!("quest: {total} documents ok");
				return Ok(ExitCode::SUCCESS);
			}
			for finding in &findings {
				eprintln!("quest: {finding}");
			}
			Ok(ExitCode::FAILURE)
		}
		Command::Ready {
			path: Some(path),
			remote,
			local,
		} => {
			let remote = (!local).then_some(remote.as_str());
			let blockers = quest::ready::blockers(&cli.root, &path, remote)?;
			for blocker in &blockers {
				print!("{blocker}");
			}
			if !blockers.is_empty() {
				// Blocked is not a verdict on the whole plan: the piece of it
				// that does not need the blocker is split into its own quest.
				eprintln!(
					"quest: {} is blocked; split any independently landable piece into its own quest (`quest guide`, Creation) rather than starting this one as it stands",
					path.display()
				);
			}
			Ok(ExitCode::SUCCESS)
		}
		Command::Ready {
			path: None,
			remote,
			local,
		} => {
			let remote = (!local).then_some(remote.as_str());
			for path in quest::ready::quests(&cli.root, remote)? {
				println!("{}", path.display());
			}
			Ok(ExitCode::SUCCESS)
		}
		Command::Branch { path, remote } => {
			for branch in quest::branch::chain(&cli.root, &path, &remote)? {
				println!("{branch}");
			}
			Ok(ExitCode::SUCCESS)
		}
		Command::Guide => {
			print!("{}", quest::skills::GUIDE);
			Ok(ExitCode::SUCCESS)
		}
		Command::Skill { name: None, .. } => {
			for skill in quest::skills::all() {
				println!("{} - {}", skill.name, skill.description());
			}
			Ok(ExitCode::SUCCESS)
		}
		Command::Skill { name: Some(name), stub } => {
			let Some(skill) = quest::skills::get(&name) else {
				let names: Vec<_> = quest::skills::all().map(|skill| skill.name).collect();
				anyhow::bail!("no skill named {name} (have: {})", names.join(", "));
			};
			if stub {
				print!("{}", skill.stub());
			} else {
				print!("{}", skill.body());
			}
			Ok(ExitCode::SUCCESS)
		}
		Command::Init => {
			for path in quest::setup::init(&cli.root)? {
				println!("{}", path.display());
			}
			Ok(ExitCode::SUCCESS)
		}
		Command::Uninstall => {
			for path in quest::setup::uninstall(&cli.root)? {
				println!("{}", path.display());
			}
			Ok(ExitCode::SUCCESS)
		}
	}
}
