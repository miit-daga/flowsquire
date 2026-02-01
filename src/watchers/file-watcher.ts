import chokidar from 'chokidar';
import { Rule, RuleRun } from '../types/index.js';
import { findMatchingRules, executeActions } from '../core/rule-engine.js';
import { captureScreenshotMetadata, generateScreenshotFilename, generateScreenshotFolderPath } from '../core/screenshot-metadata.js';
import { saveRun } from '../db/index.js';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { loadConfig, replaceTemplateVariables } from '../config/index.js';

export interface FileWatcherOptions {
  rules: Rule[];
  dryRun?: boolean;
}

export class FileWatcher {
  private watchers: Map<string, chokidar.FSWatcher> = new Map();
  private options: FileWatcherOptions;
  private processingFiles: Set<string> = new Set();

  constructor(options: FileWatcherOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    // Group rules by watched folder
    const folderRules = await this.groupRulesByFolder(this.options.rules);

    for (const [folder, rules] of folderRules) {
      this.watchFolder(folder, rules);
    }

    console.log(`👁  Watching ${folderRules.size} folder(s)...`);
  }

  stop(): void {
    for (const [folder, watcher] of this.watchers) {
      watcher.close();
      console.log(`Stopped watching: ${folder}`);
    }
    this.watchers.clear();
  }

  private async groupRulesByFolder(rules: Rule[]): Promise<Map<string, Rule[]>> {
    const folderRules = new Map<string, Rule[]>();

    for (const rule of rules) {
      if (!rule.enabled) continue;
      
      // Extract folder from trigger config
      const folder = await this.extractWatchedFolder(rule);
      if (!folder) continue;

      if (!folderRules.has(folder)) {
        folderRules.set(folder, []);
      }
      folderRules.get(folder)!.push(rule);
    }

    return folderRules;
  }

  private async extractWatchedFolder(rule: Rule): Promise<string | null> {
    // Load config to replace template variables
    const config = await loadConfig();
    
    // For file_created/modified triggers, folder is in trigger.config
    if (rule.trigger.type === 'file_created' || rule.trigger.type === 'file_modified') {
      const folderTemplate = rule.trigger.config.folder as string;
      if (!folderTemplate) return null;
      return replaceTemplateVariables(folderTemplate, config);
    }
    
    // For screenshot triggers, use the configured screenshots folder
    if (rule.trigger.type === 'screenshot') {
      const folderTemplate = rule.trigger.config.folder as string;
      if (!folderTemplate) return null;
      return replaceTemplateVariables(folderTemplate, config);
    }

    return null;
  }

  private watchFolder(folder: string, rules: Rule[]): void {
    const watcher = chokidar.watch(folder, {
      ignored: [
        /(^|[\/\\])\../, // ignore dotfiles
        /(^|[\/\\])Images($|[\/\\])/, // ignore Images subfolder
        /(^|[\/\\])Videos($|[\/\\])/, // ignore Videos subfolder
        /(^|[\/\\])Music($|[\/\\])/, // ignore Music subfolder
        /(^|[\/\\])Archives($|[\/\\])/, // ignore Archives subfolder
        /(^|[\/\\])Documents($|[\/\\])/, // ignore Documents subfolder
        /(^|[\/\\])Installers($|[\/\\])/, // ignore Installers subfolder
        /(^|[\/\\])Code($|[\/\\])/, // ignore Code subfolder
        /(^|[\/\\])PDFs($|[\/\\])/, // ignore PDFs subfolder
        /(^|[\/\\])Organized($|[\/\\])/, // ignore Organized subfolder
        /(^|[\/\\])ByApp($|[\/\\])/, // ignore ByApp subfolder
        /(^|[\/\\])ByDate($|[\/\\])/, // ignore ByDate subfolder
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    // Separate screenshot rules from regular file rules
    const fileRules = rules.filter(r => r.trigger.type === 'file_created' || r.trigger.type === 'file_modified');
    const screenshotRules = rules.filter(r => r.trigger.type === 'screenshot');

    // Handle regular file events
    if (fileRules.length > 0) {
      watcher
        .on('add', (filePath) => this.handleFileEvent(filePath, fileRules, 'file_created'))
        .on('change', (filePath) => this.handleFileEvent(filePath, fileRules, 'file_modified'));
    }
    
    // Handle screenshot events
    if (screenshotRules.length > 0) {
      watcher.on('add', (filePath) => {
        this.handleScreenshotEvent(filePath, screenshotRules);
      });
    }

    this.watchers.set(folder, watcher);
    console.log(`  📁 ${folder} (${rules.length} rule(s))`);
  }

  private async handleFileEvent(
    filePath: string,
    rules: Rule[],
    eventType: string
  ): Promise<void> {
    // Prevent duplicate processing
    if (this.processingFiles.has(filePath)) {
      return;
    }
    this.processingFiles.add(filePath);

    try {
      // Filter rules that match this file
      const matchingRules = findMatchingRules(rules, filePath);

      if (matchingRules.length === 0) {
        return;
      }

      console.log(`\n📄 ${path.basename(filePath)}`);

      // Execute only the first (highest priority) matching rule
      const highestPriorityRule = matchingRules[0];
      
      // Check if this is a screenshot rule by looking at tags
      if (highestPriorityRule.tags.includes('screenshot')) {
        await this.executeScreenshotRule(highestPriorityRule, filePath);
      } else {
        await this.executeRule(highestPriorityRule, filePath);
      }
    } finally {
      // Remove from processing after a delay to handle rapid successive events
      setTimeout(() => {
        this.processingFiles.delete(filePath);
      }, 1000);
    }
  }

  private async handleScreenshotEvent(filePath: string, rules: Rule[]): Promise<void> {
    // Prevent duplicate processing
    if (this.processingFiles.has(filePath)) {
      return;
    }
    this.processingFiles.add(filePath);

    try {
      // Filter screenshot rules that match this file
      const matchingRules = findMatchingRules(rules, filePath);
      
      if (matchingRules.length === 0) {
        return;
      }

      console.log(`\n📸 ${path.basename(filePath)}`);

      // Execute only the first (highest priority) matching rule
      const highestPriorityRule = matchingRules[0];
      await this.executeScreenshotRule(highestPriorityRule, filePath);
    } finally {
      // Remove from processing after a delay to handle rapid successive events
      setTimeout(() => {
        this.processingFiles.delete(filePath);
      }, 1000);
    }
  }

  private async executeRule(rule: Rule, filePath: string): Promise<void> {
    const runId = randomUUID();
    const startTime = new Date();

    console.log(`  → Rule: ${rule.name}`);

    // Get file stats for logging
    let fileSize: number | undefined;
    try {
      const stats = await fs.stat(filePath);
      fileSize = stats.size;
    } catch {
      // File might not exist anymore
    }

    // Create initial run record
    let run: RuleRun = {
      id: runId,
      ruleId: rule.id,
      status: 'running',
      triggeredBy: 'file_event',
      filePath,
      fileSize,
      tags: rule.tags || [],
      dryRun: this.options.dryRun || false,
      actions: [],
      startedAt: startTime,
    };

    await saveRun(run);

    try {
      // Execute actions
      const results = await executeActions(
        rule.actions,
        filePath,
        this.options.dryRun
      );

      const allSuccess = results.every(r => r.status === 'success');

      // Get final destination from last successful action
      const finalDestination = results
        .filter(r => r.status === 'success')
        .pop()?.destinationPath;

      // Update run record
      run = {
        ...run,
        status: allSuccess ? 'completed' : 'failed',
        actions: results,
        destinationPath: finalDestination,
        completedAt: new Date(),
      };

      await saveRun(run);

      // Log results
      for (const result of results) {
        const icon = result.status === 'success' ? '✓' : '✗';
        const action = result.action.type.toUpperCase();
        if (result.status === 'success') {
          console.log(`    ${icon} ${action}: ${path.basename(result.destinationPath || '')}`);
        } else {
          console.log(`    ${icon} ${action}: ${result.error}`);
        }
      }
    } catch (error) {
      run = {
        ...run,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      };
      await saveRun(run);

      console.log(`    ✗ Error: ${run.error}`);
    }
  }

  private async executeScreenshotRule(rule: Rule, filePath: string): Promise<void> {
    const runId = randomUUID();
    const startTime = new Date();

    console.log(`  → Rule: ${rule.name}`);
    console.log(`  📸 Capturing screenshot metadata...`);

    // Get file stats for logging
    let fileSize: number | undefined;
    try {
      const stats = await fs.stat(filePath);
      fileSize = stats.size;
    } catch {
      // File might not exist anymore
    }

    // Capture metadata (macOS only, with fallback)
    const metadata = await captureScreenshotMetadata();
    
    if (metadata) {
      console.log(`    App: ${metadata.appName}`);
      if (metadata.windowTitle && metadata.windowTitle !== 'Unknown') {
        console.log(`    Window: ${metadata.windowTitle}`);
      }
      if (metadata.domain) {
        console.log(`    Domain: ${metadata.domain}`);
      }
    } else {
      console.log(`    (Metadata capture not available - using filename)`);
    }

    // Create initial run record
    let run: RuleRun = {
      id: runId,
      ruleId: rule.id,
      status: 'running',
      triggeredBy: 'file_event',
      filePath,
      fileSize,
      tags: rule.tags || [],
      dryRun: this.options.dryRun || false,
      actions: [],
      startedAt: startTime,
    };

    await saveRun(run);

    try {
      // Execute actions with metadata for pattern substitution
      const results = await executeActions(
        rule.actions,
        filePath,
        this.options.dryRun,
        metadata ? { appName: metadata.appName, domain: metadata.domain } : undefined
      );

      const allSuccess = results.every(r => r.status === 'success');

      // Get final destination from last successful action
      const finalDestination = results
        .filter(r => r.status === 'success')
        .pop()?.destinationPath;

      // Update run record
      run = {
        ...run,
        status: allSuccess ? 'completed' : 'failed',
        actions: results,
        destinationPath: finalDestination,
        completedAt: new Date(),
      };

      await saveRun(run);

      // Log results
      for (const result of results) {
        const icon = result.status === 'success' ? '✓' : '✗';
        const action = result.action.type.toUpperCase();
        if (result.status === 'success') {
          console.log(`    ${icon} ${action}: ${path.basename(result.destinationPath || '')}`);
        } else {
          console.log(`    ${icon} ${action}: ${result.error}`);
        }
      }
    } catch (error) {
      run = {
        ...run,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      };
      await saveRun(run);

      console.log(`    ✗ Error: ${run.error}`);
    }
  }

}
