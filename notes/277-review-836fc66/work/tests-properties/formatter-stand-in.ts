// Missing shared/format.ts stand-in: only underscore replacement. No exact formatter/casing claim.
export const humanizeName = (value: string) => value.replace(/_/g, " ");
