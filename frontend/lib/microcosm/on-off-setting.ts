// A server setting that is on with `1` and off when unset, empty or `0`. Any
// other value is refused, so a typing mistake never leaves it silently off.
export function onOffSetting(
  name: string,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  const value = environment[name]?.trim() ?? "";
  if (value === "1") return true;
  if (value === "" || value === "0") return false;
  throw new Error(`${name} must be 1 or 0.`);
}
