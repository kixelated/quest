// Dispatch executable gates before loading the repository CLI and its dependencies.
import { gate } from "./gate";
import { gateArguments } from "./gate-argv";
import type { Output } from "./main";

/** Run the gate directly, or load the CLI parser for other commands and diagnostics. */
export async function main(argv: string[], out: Output): Promise<number> {
	const command = gateArguments(argv);
	if (command === undefined) return (await import("./main")).main(argv, out);
	try {
		return await gate(command);
	} catch (error) {
		out.stderr(`quest: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
}
