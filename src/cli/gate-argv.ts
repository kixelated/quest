/** Skip the global root option wherever Commander permits it. */
function commandIndex(argv: string[], index = 0): number {
	while (argv[index] === "--root" || argv[index]?.startsWith("--root=")) {
		index += argv[index] === "--root" ? 2 : 1;
	}
	return index;
}

/** Stop option parsing before the gated executable, preserving its own flags. */
export function gateBoundary(argv: string[]): string[] {
	const index = commandIndex(argv);
	if (argv[index] !== "gate") return argv;
	const command = commandIndex(argv, index + 1);
	if (!argv[command] || ["--", "-h", "--help", "-V", "--version"].includes(argv[command])) return argv;
	return [...argv.slice(0, command), "--", ...argv.slice(command)];
}

/**
 * An executable gate invocation needs no CLI initialization. Leave help, version,
 * and malformed options to Commander's parser and its existing diagnostics.
 */
export function gateArguments(argv: string[]): string[] | undefined {
	const index = commandIndex(argv);
	if (argv[index] !== "gate") return;
	const command = commandIndex(argv, index + 1);
	for (let i = 0; i < command; i++) {
		if (argv[i] === "gate") continue;
		const option = argv[i];
		const value = option === "--root" ? argv[++i] : option.slice("--root=".length);
		if (!value || (option === "--root" && value.startsWith("-"))) return;
	}
	if (argv[command] === "--") return argv.length > command + 1 ? argv.slice(command + 1) : undefined;
	if (!argv[command] || ["-h", "--help", "-V", "--version"].includes(argv[command])) return;
	return argv.slice(command);
}
