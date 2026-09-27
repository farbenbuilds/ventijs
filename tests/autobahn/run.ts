import { main } from "./execute.ts";

process.exitCode = await main(process.argv.slice(2));
