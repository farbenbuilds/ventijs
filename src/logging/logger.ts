// Raw SGR codes only: the logger writes to a TTY or a pipe with no dependency
// and no capability detection, so disabled output costs nothing but a branch.
const RESET = "\u001B[0m";
const BOLD = "\u001B[1m";
const DIM = "\u001B[2m";
const RED = "\u001B[31m";
const GREEN = "\u001B[32m";
const YELLOW = "\u001B[33m";
const CYAN = "\u001B[36m";

const SPLASH = `██╗   ██╗███████╗███╗   ██╗████████╗██╗██╗    ██╗███████╗
██║   ██║██╔════╝████╗  ██║╚══██╔══╝██║██║    ██║██╔════╝
██║   ██║█████╗  ██╔██╗ ██║   ██║   ██║██║ █╗ ██║███████╗
╚██╗ ██╔╝██╔══╝  ██║╚██╗██║   ██║   ██║██║███╗██║╚════██║
 ╚████╔╝ ███████╗██║ ╚████║   ██║   ██║╚███╔███╔╝███████║
  ╚═══╝  ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝ ╚══╝╚══╝ ╚══════╝`;

/// Process-wide on purpose: a host silences the library once, and every writer
/// opens with the same guard so a disabled logger formats nothing.
let isEnabled = true;

/// The one function without the guard: assigning under a guard would make a
/// disabled logger impossible to re-enable.
export function setLoggerEnabled(enabled: boolean): void {
  isEnabled = enabled;
}

function time(): string {
  return new Date().toTimeString().slice(0, 8);
}

function emit(line: string): void {
  process.stdout.write(`${line}\n`);
}

function record(color: string, command: string, status: string): void {
  emit(`${DIM}${time()}${RESET} | ${color}${command}${RESET} : ${status}`);
}

export function info(command: string, status: string): void {
  if (!isEnabled) return;
  record(CYAN, command, status);
}

export function warn(command: string, status: string): void {
  if (!isEnabled) return;
  record(YELLOW, command, status);
}

export function fatal(command: string, status: string): void {
  if (!isEnabled) return;
  record(RED, command, status);
}

export function ready(version: string, timeMs: number, port: number): void {
  if (!isEnabled) return;
  emit(`${CYAN}${SPLASH}${RESET}`);
  emit("");
  emit(`ventiws ${BOLD}${version}${RESET} ready in ${timeMs}`);
  emit("");
  emit(`${GREEN}\u279C${RESET}  Local: localhost:${port}/`);
  emit("");
}
