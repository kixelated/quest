import { WorkerEntrypoint } from "cloudflare:workers";
import {
	initSync,
	evaluate as evaluateWasm,
	removeClaim as removeClaimWasm,
	isClaimAddition as isClaimAdditionWasm,
} from "../quest-core/quest.js";
import module from "../quest-core/quest_bg.wasm?module";

// Wrangler imports a precompiled module: no filesystem, fetch, or dynamic
// WebAssembly compilation is involved in a request.
initSync({ module });

export interface Document {
	path: string;
	content: string;
}
export interface Snapshot {
	documents: Document[];
	paths: string[];
}
export interface Claim {
	name: string;
	provider: string;
	identity: string;
	location: string;
	date: string;
	text: string;
}
export interface Blocker {
	path: string | null;
	text: string;
	blockers: Blocker[];
}
export interface Evaluation {
	findings: { path: string; line: number | null; message: string }[];
	ready: string[];
	blockers: Blocker[] | null;
	claims: Record<string, Claim>;
}

export function evaluate(snapshot: Snapshot, path?: string): Evaluation {
	return JSON.parse(evaluateWasm(JSON.stringify(snapshot), path)) as Evaluation;
}

export function removeClaim(content: string): string {
	return removeClaimWasm(content);
}

export function isClaimAddition(before: string, after: string): boolean {
	return isClaimAdditionWasm(before, after);
}

// Internal service entrypoint; repository access/authorization stays with the
// calling application. This entrypoint receives already-loaded snapshots.
export class QuestCore extends WorkerEntrypoint {
	evaluate(snapshot: Snapshot, path?: string): Evaluation {
		return evaluate(snapshot, path);
	}
}
