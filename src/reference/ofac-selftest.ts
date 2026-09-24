import { screenPayee, sdnInfo, sdnSample, normalizeName } from "./ofac.ts";
import { rngFrom } from "../bench/families.ts";

// The screen must hit real SDN names, not hit clean vendors, survive corporate
// dressing, and be loud (not silently clear) when the list is missing. All
// deterministic; the list is vendored.
//
//   node src/reference/ofac-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const info = sdnInfo();
check("the vendored list is the real one (>10,000 entries)", info.entries > 10_000, `${info.entries} entries`);
check("the list carries its fetch date", /^\d{4}-\d{2}-\d{2}$/.test(info.fetched), info.fetched);

// A known-stable SDN entry (on the list for decades).
const cuba = screenPayee("BANCO NACIONAL DE CUBA");
check("a real SDN name hits", cuba.hit === true, cuba.hit ? cuba.entry.program : "no hit");
check("the hit names its program", cuba.hit && cuba.entry.program.length > 0, cuba.hit ? cuba.entry.program : "");

// Case and punctuation must not defeat the screen.
check("case-insensitive", screenPayee("banco nacional de cuba").hit === true);
check("punctuation-insensitive", screenPayee("Banco Nacional, de-Cuba.").hit === true);

// Clean vendors must not hit.
check("our synthetic vendor does not hit", screenPayee("Northline Steel").hit === false);
check("a common real-sounding company does not hit", screenPayee("Acme Industrial Supply").hit === false);

// Normalization behaves.
check("normalizeName strips dressing", normalizeName("  BANCO   NACIONAL, DE-CUBA. ") === "BANCO NACIONAL DE CUBA");

// Sampling for scenario generation is deterministic and returns real names.
const rng1 = rngFrom("ofac-sample-test");
const rng2 = rngFrom("ofac-sample-test");
const a = sdnSample((max) => rng1.int(0, max - 1), 3);
const b = sdnSample((max) => rng2.int(0, max - 1), 3);
check("sampling is deterministic under one seed", JSON.stringify(a) === JSON.stringify(b), a.join(" | "));
check("every sampled name screens as a hit", a.every((n) => screenPayee(n).hit));

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
