import type { Employee } from "./types";

// App users appear in the tree as "profile:<id>" nodes; employees as their name.
// Mirrors private.scorecards_manages_employee in the database.
export type TreeProfile = { id: string; linkedEmployeeName?: string; supervisorId?: string };

export function profileNode(profileId: string): string {
  return `profile:${profileId}`;
}

// Returns the set of employee names that report, directly or transitively, to any of the
// given root nodes — via the Rippling Manager name (Employee.manager), the manager picked
// during upload (Employee.assignedManagerId), and, when profiles are supplied, users linked
// to an employee and the Users-page supervisor chain. Does not include the roots themselves.
export function getReportingTree(roots: string | string[], employees: Employee[], profiles: TreeProfile[] = []): Set<string> {
  const childrenOf = new Map<string, string[]>();
  const addEdge = (parent: string | undefined, child: string) => {
    if (!parent) return;
    const list = childrenOf.get(parent);
    if (list) list.push(child);
    else childrenOf.set(parent, [child]);
  };
  for (const emp of employees) {
    addEdge(emp.manager, emp.name);
    if (emp.assignedManagerId) addEdge(profileNode(emp.assignedManagerId), emp.name);
  }
  for (const p of profiles) {
    addEdge(p.linkedEmployeeName, profileNode(p.id));
    if (p.supervisorId) addEdge(profileNode(p.supervisorId), profileNode(p.id));
  }

  const rootList = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
  const result = new Set<string>();
  const visited = new Set<string>(rootList);
  const queue = [...rootList];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of childrenOf.get(current) || []) {
      if (visited.has(child)) continue;
      visited.add(child);
      queue.push(child);
      if (!child.startsWith("profile:")) result.add(child);
    }
  }
  for (const r of rootList) result.delete(r);
  return result;
}
