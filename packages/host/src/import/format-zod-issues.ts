// ─── Zod Issue Formatter ───────────────────────────────────────────
// Converts Zod validation issues into a human-readable error string.
// Uses a minimal structural type to avoid a direct dependency on "zod".

/** Minimal shape of a Zod issue (path + message). */
interface ZodIssueLike {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * Formats an array of Zod issues into a single, human-readable string.
 *
 * Each issue is rendered as `path: message`, joined by "; ".
 * Root-level issues (empty path) use `(root)` as the path label.
 *
 * @example
 * formatZodIssues([{ path: ["meta", "slug"], message: "Required" }])
 * // => "Validation failed: meta.slug: Required"
 */
export function formatZodIssues(issues: readonly ZodIssueLike[]): string {
  const details = issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });

  return `Validation failed: ${details.join("; ")}`;
}
