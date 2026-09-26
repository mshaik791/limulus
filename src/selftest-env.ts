import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A selftest seals real records. They belong in a directory of their own, not
// in the data the console shows to a person: a run named "t v0" in a customer's
// test history is a demo ruined. Import this first, before any store loads,
// and every store resolves to a fresh temporary directory. An explicit
// LIMULUS_DATA_DIR wins, so a selftest can still be pointed somewhere.
if (!process.env.LIMULUS_DATA_DIR) process.env.LIMULUS_DATA_DIR = mkdtempSync(join(tmpdir(), "limulus-selftest-"));
