// D-03 (05-CONTEXT.md): scans every commit reachable from `main` -- not only HEAD -- for
// credential-shaped strings, non-loopback hostnames, IPv4 literals, and Coolify/Hetzner
// operational detail, before this repository's history is ever pushed to a public remote.
// Publishing is one-way (`docs/decisions.md` D-02/D-03); this tool exists to make "nothing
// sensitive was ever committed and later removed" a checked fact rather than an unverified
// assumption (CLAUDE.md: mark unverified things UNKNOWN, never record an assumption as a fact).
//
// This is a reporting tool, not a gate. The gate is Task 3's blocking-human checkpoint: a
// person disposes every finding ACCEPT-AS-PUBLIC or REDACT-AND-REWRITE before anything leaves
// the machine. Every finding this module produces carries only a location (commit SHA, path,
// line number in the diff) and a class name -- never the matched text or the source line it
// came from. This is the same "never echo the supplied value back" discipline `scripts/env.ts`'s
// rejection messages already hold (`assertLocalDevelopmentTarget`, `assertBackupDestination`),
// applied to a scanner whose entire input is, by definition, the thing that must not be
// reproduced.
//
// Runtime-built needles, not literals (WR-04 idiom, `tests/guardrails.test.ts`'s own
// `CONNECTION_STRING_SCHEME_PREFIX = ["postgres", "://"].join("")`): this file lives under
// `scripts/`, which is inside the guardrail suite's own source surface, so it is itself subject
// to the D-19/WR-01 connection-string-prefix assertion. A GitHub token prefix or an AWS access
// key prefix spelled as a literal substring in this file's own source would be exactly the kind
// of committed secret-shaped string this tool exists to catch -- so every fixed-string needle
// below is assembled at runtime by concatenation, never written as a contiguous literal.
import { execa } from "execa";
import { DEV_DATABASE_HOST_ALLOWLIST } from "../env";
import { safeErrorMessage } from "../log";

export type FindingClass =
  | "CREDENTIAL"
  | "NON_LOOPBACK_HOST"
  | "IP_LITERAL"
  | "OPERATIONAL_DETAIL"
  | "UNKNOWN_HIGH_ENTROPY";

export interface Finding {
  sha: string;
  path: string;
  lineNumberInDiff: number;
  class: FindingClass;
}

interface AuditSummary {
  commitsScanned: number;
  findings: Finding[];
  findingsByClass: Record<FindingClass, number>;
}

function buildNeedle(...parts: string[]): string {
  return parts.join("");
}

// A PEM private-key header, a GitHub token prefix (four documented spellings), and an AWS
// access-key-id prefix -- each assembled from parts that are individually meaningless, so none
// of the actual needle strings appear contiguously in this file's own source.
const PEM_PRIVATE_KEY_HEADER_NEEDLE = buildNeedle("-----BEGIN ", "PRIVATE KEY");
const GITHUB_TOKEN_PREFIXES: readonly string[] = [
  buildNeedle("gh", "p_"),
  buildNeedle("gh", "o_"),
  buildNeedle("gh", "s_"),
  buildNeedle("github_pat", "_"),
];
const AWS_ACCESS_KEY_PREFIX = buildNeedle("AK", "IA");

// A generic scheme-with-host-and-optional-userinfo matcher -- deliberately not anchored to
// "postgres" specifically, both because a leaked credential in this project's history could be
// for any protocol (mysql, redis, ssh, an internal http admin panel) and because a
// scheme-agnostic character class never spells out any one scheme as a literal substring,
// sidestepping the D-19/WR-01 concern above by construction rather than by string-splitting a
// single hardcoded scheme.
const GENERIC_URI_WITH_HOST_PATTERN =
  /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:([^\s:@/]+)(?::([^\s@/]*))?@)?([^\s/:@]+)(?::(\d+))?/g;

// An SSH-style target: the literal word "ssh" followed, after any number of intervening
// flag/argument tokens (`-i key.pem`, `-p 22`, and the like -- none of which contain an "@"
// themselves), by a `user@host` pair. Anchored on the literal "ssh" token specifically so an
// ordinary email address in a commit message is never mistaken for a connection target. The
// lazy skip-quantifier tries the shortest possible gap first, so `ssh user@host` (no flags)
// still matches on its first attempt.
const SSH_TARGET_PATTERN = /\bssh\s+(?:\S+\s+)*?[\w.-]+@([\w.-]+)/gi;

const CREDENTIAL_KEY_SUBSTRINGS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
];

// Matches a `key = value` / `key: value` / `key="value"` assignment shape. The value class
// excludes whitespace, quotes, commas and semicolons so it stops at the natural end of a typical
// assignment; it deliberately does NOT exclude the colon or slash characters, because a real
// leaked value (a connection string, a JSON Web Token) may itself contain those characters.
const KEY_VALUE_ASSIGNMENT_PATTERN = /([A-Za-z0-9_.-]+)\s*[:=]\s*(['"]?)([^\s'",;]*)\2/g;

// A dotted-quad IPv4 literal, bounded so it cannot be read out of the middle of a longer digit
// run (a component followed immediately by another digit, or preceded immediately by a digit or
// a dot, is never a standalone literal) and so it cannot silently extend past four components.
// This alone does not prove the match is a *valid* IPv4 address -- octet range is checked
// separately in `hasNonPrivateIpLiteral` -- and that separate check is what keeps a genuine
// four-dot-separated version number (e.g. a browser build like `130.0.6723.116`, whose third
// component is far outside 0-255) from ever being reported as an IP literal.
const IP_LITERAL_PATTERN = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\d)(?!\.\d)/g;

const PRIVATE_OR_LOOPBACK_IP_RANGES: ReadonlyArray<(octets: readonly number[]) => boolean> = [
  (o) => o[0] === 127, // 127.0.0.0/8 -- covers 127.0.0.1 and the rest of the loopback block
  (o) => o[0] === 10, // 10.0.0.0/8
  (o) => o[0] === 192 && o[1] === 168, // 192.168.0.0/16
  (o) => o[0] === 172 && o[1] >= 16 && o[1] <= 31, // 172.16.0.0/12
];

const OPERATIONAL_PLATFORM_NEEDLES: readonly string[] = ["coolify", "hetzner"];

/**
 * True when `value` is a placeholder/indirection rather than a real secret -- an empty string,
 * anything containing the word PLACEHOLDER (case-insensitive, matching `.env.example`'s own
 * documented convention -- `tests/guardrails.test.ts` asserts that file contains "PLACEHOLDER"),
 * a shell/env-variable indirection of the form `${SOME_VAR}` (matching `docker-compose.yml`'s
 * `POSTGRES_PASSWORD: ${RECIPE_DEV_DB_PASSWORD}` shape -- the variable NAME is not a secret), or
 * an angle-bracket placeholder convention of the form `<some-placeholder>`.
 */
function isPlaceholderValue(value: string): boolean {
  if (value.length === 0) return true;
  if (value.toUpperCase().includes("PLACEHOLDER")) return true;
  if (/^\$\{[^}]*\}$/.test(value)) return true;
  if (/^<[^>]*>$/.test(value)) return true;
  return false;
}

function isAllowlistedHost(host: string): boolean {
  const normalized = host.replace(/^\[/, "").replace(/\]$/, "");
  return (DEV_DATABASE_HOST_ALLOWLIST as readonly string[])
    .map((allowed) => allowed.replace(/^\[/, "").replace(/\]$/, ""))
    .includes(normalized);
}

function isCredential(line: string): boolean {
  GENERIC_URI_WITH_HOST_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GENERIC_URI_WITH_HOST_PATTERN.exec(line)) !== null) {
    const password = match[2];
    if (password !== undefined && !isPlaceholderValue(password)) {
      return true;
    }
  }

  KEY_VALUE_ASSIGNMENT_PATTERN.lastIndex = 0;
  while ((match = KEY_VALUE_ASSIGNMENT_PATTERN.exec(line)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[3];
    const keyLooksCredentialShaped = CREDENTIAL_KEY_SUBSTRINGS.some((needle) =>
      key.includes(needle),
    );
    if (keyLooksCredentialShaped && !isPlaceholderValue(value)) {
      return true;
    }
  }

  if (line.includes(PEM_PRIVATE_KEY_HEADER_NEEDLE)) return true;
  if (GITHUB_TOKEN_PREFIXES.some((prefix) => line.includes(prefix))) return true;
  if (line.includes(AWS_ACCESS_KEY_PREFIX)) return true;

  return false;
}

function hasNonLoopbackHost(line: string): boolean {
  GENERIC_URI_WITH_HOST_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GENERIC_URI_WITH_HOST_PATTERN.exec(line)) !== null) {
    const host = match[3];
    if (host && !isAllowlistedHost(host)) return true;
  }

  SSH_TARGET_PATTERN.lastIndex = 0;
  while ((match = SSH_TARGET_PATTERN.exec(line)) !== null) {
    const host = match[1];
    if (host && !isAllowlistedHost(host)) return true;
  }

  return false;
}

function hasNonPrivateIpLiteral(line: string): boolean {
  IP_LITERAL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IP_LITERAL_PATTERN.exec(line)) !== null) {
    const octets = [match[1], match[2], match[3], match[4]].map(Number);
    if (octets.some((octet) => octet > 255)) continue; // not a valid IPv4 literal at all
    if (PRIVATE_OR_LOOPBACK_IP_RANGES.some((isPrivate) => isPrivate(octets))) continue;
    return true;
  }
  return false;
}

/** Whether `line` carries something location-shaped alongside a platform-name mention -- a
 * host, an IP, a port, or a filesystem path -- which is what turns a bare mention of the
 * platform's name into operational detail. */
function lineCarriesLocationDetail(line: string): boolean {
  IP_LITERAL_PATTERN.lastIndex = 0;
  if (IP_LITERAL_PATTERN.test(line)) return true;

  GENERIC_URI_WITH_HOST_PATTERN.lastIndex = 0;
  if (GENERIC_URI_WITH_HOST_PATTERN.test(line)) return true;

  if (/:\d{2,5}\b/.test(line)) return true; // a port
  if (/\/[\w.-]+\/[\w.-]+/.test(line)) return true; // a multi-segment filesystem path
  if (/\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(line)) return true; // a dotted hostname-shaped token

  return false;
}

function hasOperationalDetail(line: string): boolean {
  const lower = line.toLowerCase();
  const mentionsPlatform = OPERATIONAL_PLATFORM_NEEDLES.some((needle) => lower.includes(needle));
  if (!mentionsPlatform) return false;
  return lineCarriesLocationDetail(line);
}

// A 32+ character run drawn only from the base64/URL-safe-base64/hex alphabet (optionally
// trailed by base64 padding characters). This is deliberately the "cannot classify further"
// bucket -- it exists precisely so a value that matches none of the four named classes above
// still surfaces as UNKNOWN rather than passing through silently (see the module header and
// D-03's own reasoning: an unverified absence-of-secrets claim is not a fact).
const HIGH_ENTROPY_TOKEN_PATTERN = /\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g;

function hasUnknownHighEntropyToken(line: string): boolean {
  HIGH_ENTROPY_TOKEN_PATTERN.lastIndex = 0;
  return HIGH_ENTROPY_TOKEN_PATTERN.test(line);
}

/**
 * Classifies a single line of added diff content (the text after a unified diff's leading `+`,
 * never including that marker itself) into one of five finding classes, or `null` if it matches
 * none. Checked in descending order of severity/specificity -- a line is reported under the
 * single most serious class it matches, not every class it happens to also brush against.
 */
export function classifyLine(line: string): FindingClass | null {
  if (isCredential(line)) return "CREDENTIAL";
  if (hasNonLoopbackHost(line)) return "NON_LOOPBACK_HOST";
  if (hasNonPrivateIpLiteral(line)) return "IP_LITERAL";
  if (hasOperationalDetail(line)) return "OPERATIONAL_DETAIL";
  if (hasUnknownHighEntropyToken(line)) return "UNKNOWN_HIGH_ENTROPY";
  return null;
}

// git's own null-byte format placeholder emits a real NUL character as the commit-boundary
// marker in the `git log` output this module parses -- chosen specifically because that
// character can never appear inside ordinary diff text or a commit message, so it is never
// confused with the literal word "commit" appearing inside either. Built via
// String.fromCharCode(0) at runtime, so no raw control character and no escape-sequence
// spelling of one is ever written directly into this file's own source text.
const COMMIT_MARKER_PREFIX = `${String.fromCharCode(0)}commit `;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/;

/** Returns the commit SHA if `line` is a commit-boundary marker line, else `null`. */
function commitShaFromMarkerLine(line: string): string | null {
  if (!line.startsWith(COMMIT_MARKER_PREFIX)) return null;
  const sha = line.slice(COMMIT_MARKER_PREFIX.length).trim();
  return COMMIT_SHA_PATTERN.test(sha) ? sha : null;
}

const NEW_FILE_PATH_PATTERN = /^\+\+\+ b\/(.+)$/;

/**
 * Walks unified-diff text produced by running `git log` across the whole reachable history with
 * a patch, zero context lines, and the same null-byte-prefixed commit marker format
 * `runAudit` below uses (or synthetic text shaped identically for tests), tracking the current
 * commit SHA and file path, and returns one `Finding` for every added line (`+` prefix, never
 * `+++`) that `classifyLine` classifies. A returned `Finding` carries only its location and
 * class -- never the matched text and never the diff line itself, so a finding can safely be
 * printed, logged, or written into a document that is itself headed for a public repository.
 */
export function scanHistoryText(diffText: string): Finding[] {
  const findings: Finding[] = [];
  const lines = diffText.split("\n");

  let currentSha = "";
  let currentPath = "";

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    const commitSha = commitShaFromMarkerLine(line);
    if (commitSha) {
      currentSha = commitSha;
      continue;
    }

    const fileMatch = line.match(NEW_FILE_PATH_PATTERN);
    if (fileMatch) {
      currentPath = fileMatch[1];
      continue;
    }

    // Diff metadata lines (`+++ /dev/null`, `--- a/...`, hunk headers, etc.) are never
    // classified -- only a genuine added-content line reaches classifyLine below.
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      const addedContent = line.slice(1);
      const findingClass = classifyLine(addedContent);
      if (findingClass) {
        findings.push({
          sha: currentSha,
          path: currentPath,
          lineNumberInDiff: index + 1,
          class: findingClass,
        });
      }
    }
  }

  return findings;
}

/**
 * Runs the real full-history scan via `git log` and summarizes it. Never throws away from a
 * clean run -- a genuine failure to invoke `git` at all propagates and Node reports it in the
 * usual way; there is nothing this reporting tool can honestly summarize if the scan itself
 * never happened.
 */
async function runAudit(): Promise<AuditSummary> {
  const commitMarkerFormat = `%x00commit %H`;
  const { stdout } = await execa("git", [
    "log",
    "--all",
    "--full-history",
    "-p",
    "-U0",
    "--no-color",
    `--format=${commitMarkerFormat}`,
  ]);

  const findings = scanHistoryText(stdout);

  const commitShas = new Set<string>();
  for (const line of stdout.split("\n")) {
    const sha = commitShaFromMarkerLine(line);
    if (sha) commitShas.add(sha);
  }

  const findingsByClass: Record<FindingClass, number> = {
    CREDENTIAL: 0,
    NON_LOOPBACK_HOST: 0,
    IP_LITERAL: 0,
    OPERATIONAL_DETAIL: 0,
    UNKNOWN_HIGH_ENTROPY: 0,
  };
  for (const finding of findings) {
    findingsByClass[finding.class] += 1;
  }

  return { commitsScanned: commitShas.size, findings, findingsByClass };
}

// Guarded with import.meta.main, matching every other command script in this repository. Reads
// no argument from process.argv -- like every other command here, this tool takes no target.
//
// This module never forces a synchronous process exit (the reproduced Windows libuv
// WASM-teardown crash documented in packages/automation/src/cli.ts's own header, and honored
// here even though this module never touches libpg-query -- the convention is "never force a
// synchronous exit", not "only after a WASM parse"). process.exitCode is set to 0 once the scan
// genuinely completes: this is a reporting tool, not a gate -- Task 3's blocking-human
// checkpoint is the gate, and a nonzero finding count must never, by itself, fail a build or a
// script invocation.
if (import.meta.main) {
  runAudit()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      console.error(`[audit-history] Could not complete the scan: ${safeErrorMessage(error)}`);
    });
}
