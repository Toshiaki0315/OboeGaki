// Content Security Policy の読み取り（TASKS 9-1）。tauri.conf.json に書いた
// 方針をテストで固定するためのもので、実行時には使わない。

/// `"a 'self'; b x y"` → { a: ["'self'"], b: ["x", "y"] }
export function parseCsp(policy: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const [directive, ...sources] = words;
    found.set(directive, sources);
  }
  return found;
}
