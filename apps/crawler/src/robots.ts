interface Group { agents: string[]; rules: Array<{ allow: boolean; path: string }> }

export function isRobotsAllowed(robots: string, path: string, agent: string): boolean {
  const groups: Group[] = [];
  let group: Group = { agents: [], rules: [] };
  for (const original of robots.split(/\r?\n/)) {
    const line = original.replace(/#.*$/, '').trim();
    if (!line) {
      if (group.agents.length || group.rules.length) groups.push(group);
      group = { agents: [], rules: [] };
      continue;
    }
    const field = line.match(/^([^:]+):\s*(.*)$/);
    if (!field) continue;
    const key = field[1]!.toLowerCase();
    const value = field[2]!.trim();
    if (key === 'user-agent') {
      if (group.rules.length) {
        groups.push(group);
        group = { agents: [], rules: [] };
      }
      group.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && group.agents.length && value) {
      group.rules.push({ allow: key === 'allow', path: value });
    }
  }
  if (group.agents.length || group.rules.length) groups.push(group);
  const product = agent.toLowerCase();
  const matches = groups.flatMap((item) => item.agents
    .filter((name) => name === '*' || product.includes(name))
    .map((name) => ({ specificity: name === '*' ? 0 : name.length, rules: item.rules })));
  if (!matches.length) return true;
  const specificity = Math.max(...matches.map((item) => item.specificity));
  const rules = matches.filter((item) => item.specificity === specificity).flatMap((item) => item.rules);
  let best: { length: number; allow: boolean } | undefined;
  for (const rule of rules) {
    const endAnchored = rule.path.endsWith('$');
    const source = endAnchored ? rule.path.slice(0, -1) : rule.path;
    const pattern = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    if (!new RegExp(`^${pattern}${endAnchored ? '$' : ''}`).test(path)) continue;
    const length = rule.path.replace(/[*$]/g, '').length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { length, allow: rule.allow };
    }
  }
  return best?.allow ?? true;
}

export async function fetchAllowedText(
  url: string, fetcher: typeof fetch, headers: Record<string, string> = {},
  robotsCache: Map<string, string> = new Map(),
): Promise<string> {
  const target = new URL(url);
  const agent = 'ceepp-crawler';
  if (!robotsCache.has(target.origin)) {
    const robots = await fetcher(`${target.origin}/robots.txt`, { headers: { 'User-Agent': agent } });
    if (robots.status !== 404 && !robots.ok) throw new Error(`robots.txt failed for ${target.origin}: HTTP ${robots.status}`);
    robotsCache.set(target.origin, robots.ok ? await robots.text() : '');
  }
  if (!isRobotsAllowed(robotsCache.get(target.origin)!, target.pathname, agent)) {
    throw new Error(`robots.txt disallows ${target.pathname}`);
  }
  const response = await fetcher(url, { headers: { 'User-Agent': agent, ...headers } });
  if (!response.ok) throw new Error(`Source request failed: ${target.origin} HTTP ${response.status}`);
  return response.text();
}
