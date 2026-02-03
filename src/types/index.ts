export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number; // Higher = evaluated first
  tags: string[];
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Trigger {
  type: 'file_created' | 'file_modified' | 'screenshot' | 'manual';
  config: Record<string, unknown>;
}

export interface Condition {
  type: 'extension' | 'path' | 'size' | 'name_pattern' | 'name_contains' | 'name_starts_with' | 'name_ends_with' | 'size_greater_than_mb';
  operator: 'equals' | 'contains' | 'matches' | 'greater_than' | 'less_than' | 'in';
  value: string | number | string[];
}

export interface Action {
  type: 'move' | 'copy' | 'rename' | 'compress';
  config: {
    destination: string;
    pattern?: string;
    createDirs?: boolean;
    compress?: {
      quality: 'low' | 'medium' | 'high';
      archiveOriginal?: boolean;
    };
  };
}

// TODO: RuleRun is currently recorded but never read/queried.
// Keeping for potential future "history" command or debugging features.
// Consider removing if no usage is added within the next few versions.
export interface RuleRun {
  id: string;
  ruleId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  triggeredBy: 'file_event' | 'manual';
  filePath?: string;
  fileSize?: number;
  destinationPath?: string;
  tags: string[];
  dryRun: boolean;
  actions: ActionResult[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

// TODO: ActionResult is part of RuleRun tracking (currently unused).
// Remove if RuleRun tracking is not implemented in CLI.
export interface ActionResult {
  action: Action;
  status: 'pending' | 'success' | 'failed';
  sourcePath?: string;
  destinationPath?: string;
  error?: string;
}

export interface ScreenshotMetadata {
  appName: string;
  windowTitle: string;
  domain?: string;
  timestamp: Date;
}
