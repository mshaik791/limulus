import { createKey, listKeys, revokeKey, type Scope } from "./auth.ts";
import { addEndpoint, listEndpoints, readDeliveries, removeEndpoint } from "./webhooks.ts";

// Manage API keys and webhook endpoints without the HTTP API.
//
//   node src/keys-cli.ts list
//   node src/keys-cli.ts create "design partner acme" [live|test]
//   node src/keys-cli.ts revoke key_...
//   node src/keys-cli.ts hooks
//   node src/keys-cli.ts hook-add https://example.com/limulus
//   node src/keys-cli.ts hook-remove whk_...
//   node src/keys-cli.ts deliveries

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "create": {
    const name = args[0];
    if (!name) {
      console.error('Usage: node src/keys-cli.ts create "name" [live|test]');
      process.exit(2);
    }
    const environment = (args[1] as "live" | "test") ?? "test";
    const { key, record } = createKey(name, undefined, environment);
    console.log(`Created ${record.id} (${record.name})`);
    console.log(`Scopes  ${record.scopes.join(", ")}`);
    console.log(`\n  ${key}\n`);
    console.log("This is the only time the key is shown. Store it now.");
    break;
  }

  case "revoke": {
    const id = args[0];
    if (!id) {
      console.error("Usage: node src/keys-cli.ts revoke key_...");
      process.exit(2);
    }
    console.log(revokeKey(id) ? `Revoked ${id}` : `No active key ${id}`);
    break;
  }

  case "hook-add": {
    const url = args[0];
    if (!url) {
      console.error("Usage: node src/keys-cli.ts hook-add https://example.com/hook");
      process.exit(2);
    }
    const endpoint = addEndpoint(url);
    console.log(`Added ${endpoint.id} -> ${endpoint.url}`);
    console.log(`Events  ${endpoint.events.length}`);
    console.log(`\n  ${endpoint.secret}\n`);
    console.log("Store the secret now. Deliveries are signed with it.");
    break;
  }

  case "hook-remove":
    console.log(removeEndpoint(args[0] ?? "") ? `Removed ${args[0]}` : "No such endpoint");
    break;

  case "hooks": {
    const endpoints = listEndpoints();
    if (endpoints.length === 0) console.log("No webhook endpoints.");
    for (const endpoint of endpoints) {
      console.log(`${endpoint.id}  ${endpoint.url}  (${endpoint.events.length} events)`);
    }
    break;
  }

  case "deliveries": {
    const deliveries = readDeliveries().slice(-20);
    if (deliveries.length === 0) console.log("No deliveries yet.");
    for (const d of deliveries) {
      console.log(
        `${d.at}  ${d.status.padEnd(9)} ${d.event.padEnd(22)} attempts ${d.attempts}${
          d.error ? `  ${d.error}` : ""
        }`,
      );
    }
    break;
  }

  case "list":
  default: {
    const keys = listKeys();
    if (keys.length === 0) {
      console.log("No API keys. Create one:  node src/keys-cli.ts create \"my key\"");
      break;
    }
    for (const key of keys) {
      const state = key.revokedAt ? "revoked" : "active";
      console.log(
        `${key.id}  ${key.prefix}...  ${state.padEnd(8)} ${key.name.padEnd(24)} ${key.scopes.join(",")}${
          key.lastUsedAt ? `  last used ${key.lastUsedAt}` : ""
        }`,
      );
    }
  }
}
