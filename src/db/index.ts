import { Rule, RuleRun } from '../types/index.js';
import fs from 'fs/promises';
import path from 'path';

const DB_DIR = '.flowsquire';
const RULES_FILE = path.join(DB_DIR, 'rules.json');
const RUNS_FILE = path.join(DB_DIR, 'runs.json');

async function ensureDbDir(): Promise<void> {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return defaultValue;
  }
}

async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function initDatabase(): Promise<void> {
  await ensureDbDir();
}

export async function saveRule(rule: Rule): Promise<void> {
  await ensureDbDir();
  const rules = await getRules();
  const index = rules.findIndex(r => r.id === rule.id);
  
  if (index >= 0) {
    rules[index] = rule;
  } else {
    rules.push(rule);
  }
  
  await writeJsonFile(RULES_FILE, rules);
}

export async function getRules(): Promise<Rule[]> {
  const rules = await readJsonFile<Rule[]>(RULES_FILE, []);
  // Convert date strings back to Date objects
  return rules.map(r => ({
    ...r,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  }));
}

export async function getEnabledRules(): Promise<Rule[]> {
  const rules = await getRules();
  return rules.filter(r => r.enabled);
}

export async function saveRun(run: RuleRun): Promise<void> {
  await ensureDbDir();
  const runs = await getRuns();
  const index = runs.findIndex(r => r.id === run.id);
  
  if (index >= 0) {
    runs[index] = run;
  } else {
    runs.push(run);
  }
  
  await writeJsonFile(RUNS_FILE, runs);
}

export async function getRuns(ruleId?: string): Promise<RuleRun[]> {
  const runs = await readJsonFile<RuleRun[]>(RUNS_FILE, []);
  const filtered = ruleId ? runs.filter(r => r.ruleId === ruleId) : runs;
  
  // Convert date strings back to Date objects
  return filtered.map(r => ({
    ...r,
    startedAt: new Date(r.startedAt),
    completedAt: r.completedAt ? new Date(r.completedAt) : undefined,
  }));
}
