import { expect, test } from "bun:test";

import { extractIssueRefs, tokenizeIssueRefs, type IssueRef } from "./issue-links";

function refs(text: string): IssueRef[] {
  return tokenizeIssueRefs(text).filter((t): t is IssueRef => typeof t !== "string");
}

test('"Issue #40" resolves to the default populace repo', () => {
  const [ref] = refs("Reviewed exclusion: this release recalibrates the Issue #40 fiscal surface.");
  expect(ref.owner).toBe("PolicyEngine");
  expect(ref.repo).toBe("populace");
  expect(ref.number).toBe(40);
  expect(ref.url).toBe("https://github.com/PolicyEngine/populace/issues/40");
});

test('"populace#359" resolves via the shortname map', () => {
  const [ref] = refs("Sparse frozen-support cells, see populace#359.");
  expect(ref.owner).toBe("PolicyEngine");
  expect(ref.repo).toBe("populace");
  expect(ref.number).toBe(359);
  expect(ref.label).toBe("populace#359");
});

test('bare "#359" resolves to the default repo', () => {
  const [ref] = refs("tracked in #359");
  expect(ref.url).toBe("https://github.com/PolicyEngine/populace/issues/359");
});

test("owner/repo#N resolves to that exact repo", () => {
  const [ref] = refs("see PolicyEngine/policyengine-us#1234 for the variable");
  expect(ref.owner).toBe("PolicyEngine");
  expect(ref.repo).toBe("policyengine-us");
  expect(ref.number).toBe(1234);
});

test("known shortname maps to the right repo", () => {
  const [ref] = refs("blocked on policyengine.py#462");
  expect(ref.repo).toBe("policyengine.py");
  expect(ref.number).toBe(462);
});

test("tokenize preserves surrounding text in order", () => {
  const tokens = tokenizeIssueRefs("before #40 after");
  expect(tokens.length).toBe(3);
  expect(tokens[0]).toBe("before ");
  expect(typeof tokens[1]).not.toBe("string");
  expect(tokens[2]).toBe(" after");
});

test("text with no issue reference yields a single string token", () => {
  const tokens = tokenizeIssueRefs("no references here");
  expect(tokens).toEqual(["no references here"]);
});

test("extractIssueRefs de-duplicates by URL and keeps first-seen order", () => {
  const list = extractIssueRefs("first #40 then populace#359 then #40 again");
  expect(list.map((r) => r.number)).toEqual([40, 359]);
});

test("empty / whitespace input yields no refs", () => {
  expect(tokenizeIssueRefs("")).toEqual([]);
  expect(extractIssueRefs("   ")).toEqual([]);
});
