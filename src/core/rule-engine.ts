import { Rule, Condition, Action, ActionResult, RuleRun } from '../types/index.js';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import { loadConfig, replaceTemplateVariables } from '../config/index.js';

// Get the appropriate Ghostscript command for the current platform
function getGhostscriptCommand(): string {
  const platform = os.platform();
  if (platform === 'win32') {
    // Windows uses gswin64c (64-bit) or gswin32c (32-bit)
    return 'gswin64c';
  }
  // macOS and Linux use 'gs'
  return 'gs';
}

export function evaluateConditions(conditions: Condition[], filePath: string): boolean {
  return conditions.every(condition => evaluateCondition(condition, filePath));
}

function evaluateCondition(condition: Condition, filePath: string): boolean {
  const fileName = path.basename(filePath);
  const fileNameWithoutExt = path.basename(filePath, path.extname(filePath));
  const ext = path.extname(filePath).toLowerCase();
  const conditionValue = String(condition.value).toLowerCase();

  switch (condition.type) {
    case 'extension':
      // Remove leading dot if present for comparison
      const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
      const result = matchValue(cleanExt, condition);
      return result;
    case 'name_pattern':
      return matchValue(fileName, condition);
    case 'name_contains':
      return fileNameWithoutExt.toLowerCase().includes(conditionValue);
    case 'name_starts_with':
      return fileNameWithoutExt.toLowerCase().startsWith(conditionValue);
    case 'name_ends_with':
      return fileNameWithoutExt.toLowerCase().endsWith(conditionValue);
    case 'size_greater_than_mb':
      try {
        const stats = require('fs').statSync(filePath);
        const sizeMB = stats.size / (1024 * 1024);
        return sizeMB > Number(conditionValue);
      } catch {
        return false;
      }
    case 'path':
      return matchValue(filePath, condition);
    default:
      return false;
  }
}

function matchValue(value: string, condition: Condition): boolean {
  const testValue = value.toLowerCase();
  
  switch (condition.operator) {
    case 'equals':
      return testValue === String(condition.value).toLowerCase();
    case 'contains':
      return testValue.includes(String(condition.value).toLowerCase());
    case 'matches':
      try {
        const regex = new RegExp(String(condition.value), 'i');
        return regex.test(testValue);
      } catch {
        return false;
      }
    case 'in':
      if (Array.isArray(condition.value)) {
        return condition.value.some(v => v.toLowerCase() === testValue);
      }
      return false;
    default:
      return false;
  }
}

export function findMatchingRules(rules: Rule[], filePath: string): Rule[] {
  // Sort by priority (highest first), then filter matching rules
  return rules
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .filter(rule => evaluateConditions(rule.conditions, filePath));
}

// Helper function to detect PDF category from filename
function detectPdfCategory(fileName: string): string {
  const lowerFileName = fileName.toLowerCase();
  
  // Finance / Invoices
  if (lowerFileName.includes('invoice')) return 'Invoices';
  if (lowerFileName.includes('bill')) return 'Invoices';
  if (lowerFileName.includes('payment')) return 'Invoices';
  if (lowerFileName.includes('receipt')) return 'Invoices';
  if (lowerFileName.includes('tax')) return 'Invoices';
  
  // Finance / Banking
  if (lowerFileName.includes('bank')) return 'Finance';
  if (lowerFileName.includes('statement')) return 'Finance';
  if (lowerFileName.includes('transaction')) return 'Finance';
  if (lowerFileName.includes('finance')) return 'Finance';
  if (lowerFileName.includes('credit')) return 'Finance';
  if (lowerFileName.includes('debit')) return 'Finance';
  
  // Study / Education
  if (lowerFileName.includes('notes')) return 'Study';
  if (lowerFileName.includes('note')) return 'Study';
  if (lowerFileName.includes('lecture')) return 'Study';
  if (lowerFileName.includes('study')) return 'Study';
  if (lowerFileName.includes('class')) return 'Study';
  if (lowerFileName.includes('course')) return 'Study';
  if (lowerFileName.includes('assignment')) return 'Study';
  if (lowerFileName.includes('homework')) return 'Study';
  if (lowerFileName.includes('exam')) return 'Study';
  
  return 'Unsorted';
}

export async function executeActions(
  actions: Action[],
  sourcePath: string,
  dryRun: boolean = false,
  metadata?: { appName?: string; domain?: string }
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  let currentPath = sourcePath;

  for (const action of actions) {
    const result = await executeAction(action, currentPath, dryRun, metadata);
    results.push(result);
    
    if (result.status === 'success' && result.destinationPath) {
      currentPath = result.destinationPath;
    }
  }

  return results;
}

async function executeAction(
  action: Action,
  sourcePath: string,
  dryRun: boolean,
  metadata?: { appName?: string; domain?: string }
): Promise<ActionResult> {
  const fs = await import('fs/promises');
  const path = await import('path');

  try {
    // Load config and replace template variables in destination
    const config = await loadConfig();
    
    const fileName = path.basename(sourcePath);
    
    // Detect PDF category for smart compression
    const category = detectPdfCategory(fileName);
    
    // Pass metadata to replaceTemplateVariables to handle {app} and {domain}
    // Also replace {category} placeholder for PDF compression
    let destinationPath = replaceTemplateVariables(action.config.destination, config, metadata);
    destinationPath = destinationPath.replace(/{category}/g, category);

    // If destination is a directory (no extension) AND no pattern is provided, append the filename
    // Don't append if pattern is present - applyPattern will handle the full path
    if (!path.extname(destinationPath) && !action.config.pattern) {
      destinationPath = path.join(destinationPath, fileName);
    }

    // Apply pattern if provided (pattern replaces the filename)
    if (action.config.pattern) {
      destinationPath = applyPattern(destinationPath, action.config.pattern, sourcePath, metadata);
    }

    // Ensure destination directory exists
    if (action.config.createDirs !== false) {
      const destDir = path.dirname(destinationPath);
      if (!dryRun) {
        try {
          await fs.mkdir(destDir, { recursive: true });
        } catch (err: any) {
          // Ignore EEXIST errors (directory already exists)
          if (err.code !== 'EEXIST') {
            throw err;
          }
        }
      }
    }

    // Handle filename collisions
    destinationPath = await resolveCollision(destinationPath, dryRun);

    if (!dryRun) {
      switch (action.type) {
        case 'move':
          await fs.rename(sourcePath, destinationPath);
          break;
        case 'copy':
          await fs.copyFile(sourcePath, destinationPath);
          break;
        case 'rename':
          await fs.rename(sourcePath, destinationPath);
          break;
        case 'compress':
          await compressPdf(sourcePath, destinationPath, action.config.compress?.quality || 'medium');
          break;
      }
    }
    
    return {
      action,
      status: 'success',
      sourcePath,
      destinationPath,
    };
  } catch (error) {
    return {
      action,
      status: 'failed',
      sourcePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function applyPattern(destination: string, pattern: string, sourcePath: string, metadata?: { appName?: string; domain?: string }): string {
  const path = require('path');
  const now = new Date();

  const originalFileName = path.basename(sourcePath);
  const fileNameWithoutExt = path.basename(sourcePath, path.extname(sourcePath));
  const ext = path.extname(sourcePath);

  // Check if destination is a file path (single segment with extension)
  // vs a directory path (multiple segments like {app}/{domain})
  // This fixes the bug where domains like 'aistudio.google.com' were treated as filenames
  const pathParts = destination.split(path.sep);
  const destHasFilename = pathParts.length === 1 && path.extname(destination).length > 0;
  
  // Get the directory where the file should go
  // If destination has a filename, get its directory
  // If destination is a directory path, use it as-is
  const destDir = destHasFilename ? path.dirname(destination) : destination;

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  const placeholders: Record<string, string> = {
    '{filename}': fileNameWithoutExt,
    '{ext}': ext,
    '{YYYY}': now.getFullYear().toString(),
    '{MM}': String(now.getMonth() + 1).padStart(2, '0'),
    '{Month}': monthNames[now.getMonth()],
    '{DD}': String(now.getDate()).padStart(2, '0'),
    '{HH}': String(now.getHours()).padStart(2, '0'),
    '{mm}': String(now.getMinutes()).padStart(2, '0'),
    '{ss}': String(now.getSeconds()).padStart(2, '0'),
  };

  let result = pattern;
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.replaceAll(key, value);
  }

  // If result already has extension, don't add another one
  if (!result.endsWith(ext)) {
    result = result + ext;
  }

  // Join with the destination directory
  return path.join(destDir, result);
}

async function resolveCollision(filePath: string, dryRun: boolean): Promise<string> {
  const fs = await import('fs/promises');
  const path = await import('path');

  if (dryRun) {
    return filePath;
  }

  try {
    await fs.access(filePath);
    // File exists, need to resolve collision
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);

    let counter = 1;
    let newPath = filePath;

    while (true) {
      newPath = path.join(dir, `${base}-${counter}${ext}`);
      try {
        await fs.access(newPath);
        counter++;
      } catch {
        // File doesn't exist, we can use this path
        break;
      }
    }

    return newPath;
  } catch {
    // File doesn't exist, use original path
    return filePath;
  }
}

async function compressPdf(
  sourcePath: string,
  destinationPath: string,
  quality: 'low' | 'medium' | 'high'
): Promise<void> {
  const fs = await import('fs/promises');

  // Check if source file exists
  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  // Determine quality settings for Ghostscript
  let pdfSettings = '/ebook'; // Medium quality default
  if (quality === 'low') {
    pdfSettings = '/screen'; // Lowest quality, smallest size
  } else if (quality === 'high') {
    pdfSettings = '/printer'; // Higher quality
  }

  // Use Ghostscript for compression
  return new Promise((resolve, reject) => {
    const gsCommand = getGhostscriptCommand();
    const gs = spawn(gsCommand, [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=${pdfSettings}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      `-sOutputFile=${destinationPath}`,
      sourcePath
    ]);

    let errorOutput = '';
    gs.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    gs.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Ghostscript failed with code ${code}: ${errorOutput}`));
      }
    });

    gs.on('error', (err) => {
      reject(new Error(`Failed to spawn Ghostscript: ${err.message}. Please install Ghostscript (brew install ghostscript)`));
    });
  });
}
