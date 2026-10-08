import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, extname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const walk = (folder) => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
  const path = join(folder, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
const functions = walk(join(root, "api"))
  .filter((name) => [".ts", ".js", ".mjs", ".cjs", ".tsx"].includes(extname(name)))
  .map((name) => relative(root, name).replaceAll("\\", "/"));
const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const routes = config.rewrites || [];
const correct = functions.length === 1 && functions[0] === "api/index.ts"
  && Object.keys(config.functions || {}).length === 1
  && Boolean(config.functions?.["api/index.ts"])
  && routes.some((r) => r.source === "/api" && r.destination === "/api/index")
  && routes.some((r) => r.source === "/api/:path*" && r.destination === "/api/index?__api_route=:path*");
if (!correct) {
  console.error(`Invalid Hobby configuration. API functions: ${functions.join(", ")}`);
  process.exit(1);
}
console.log(`Vercel Hobby structure OK: ${functions.length} function (${functions[0]}).`);
