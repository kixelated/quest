// Check PE machine headers without requiring Unix `file` on a Windows host.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const [binary, target] = process.argv.slice(2);
const machines = { "x86_64-pc-windows-msvc": 0x8664, "aarch64-pc-windows-msvc": 0xaa64 };
assert(Object.hasOwn(machines, target), `unknown Windows target: ${target}`);
const bytes = readFileSync(binary);
assert.equal(bytes.subarray(0, 2).toString(), "MZ", "expected a Windows executable");
const pe = bytes.readUInt32LE(0x3c);
assert.equal(bytes.readUInt32LE(pe), 0x00004550, "expected a PE header");
assert.equal(bytes.readUInt16LE(pe + 4), machines[target], `wrong executable architecture for ${target}`);
console.log(`${binary}: ${target}`);
