import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const DB_DIR = '.flowsquire';
const CONFIG_FILE = path.join(DB_DIR, 'config.json');

export interface FlowSquireConfig {
  paths: {
    downloads: string;
    documents: string;
    desktop: string;
    pictures: string;
    screenshots: string;
    videos: string;
    music: string;
    home: string;
    [key: string]: string;
  };
  settings: {
    downloadsMode: 'nested' | 'system';
    screenshotMode: 'metadata' | 'by-app' | 'by-date';
  };
  version: string;
}

const DEFAULT_CONFIG: FlowSquireConfig = {
  paths: {
    downloads: path.join(os.homedir(), 'Downloads'),
    documents: path.join(os.homedir(), 'Documents'),
    desktop: path.join(os.homedir(), 'Desktop'),
    pictures: path.join(os.homedir(), 'Pictures'),
    screenshots: path.join(os.homedir(), 'Downloads', 'Screenshots'), // Use Downloads subfolder (avoids Documents FSEvents issue)
    videos: path.join(os.homedir(), 'Movies'),
    music: path.join(os.homedir(), 'Music'),
    home: os.homedir(),
  },
  settings: {
    downloadsMode: 'nested',
    screenshotMode: 'metadata',
  },
  version: '1.0.0',
};

async function ensureDbDir(): Promise<void> {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

export async function loadConfig(): Promise<FlowSquireConfig> {
  await ensureDbDir();
  
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(data) as FlowSquireConfig;
    
    // Merge with defaults to ensure all required paths and settings exist
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      paths: {
        ...DEFAULT_CONFIG.paths,
        ...parsed.paths,
      },
      settings: {
        ...DEFAULT_CONFIG.settings,
        ...parsed.settings,
      },
    };
  } catch {
    // Config doesn't exist, create with defaults
    await saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: FlowSquireConfig): Promise<void> {
  await ensureDbDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function getConfigValue(key: string): Promise<string | undefined> {
  const config = await loadConfig();
  if (key === 'downloadsMode' || key === 'screenshotMode') {
    return config.settings[key as keyof typeof config.settings];
  }
  return config.paths[key];
}

export async function setConfigValue(key: string, value: string): Promise<void> {
  const config = await loadConfig();
  // Handle kebab-case to camelCase conversion for CLI args
  const normalizedKey = key === 'downloads-mode' ? 'downloadsMode' : 
                        key === 'screenshot-mode' ? 'screenshotMode' : key;
  if (normalizedKey === 'downloadsMode') {
    config.settings.downloadsMode = value as 'nested' | 'system';
  } else if (normalizedKey === 'screenshotMode') {
    config.settings.screenshotMode = value as 'metadata' | 'by-app' | 'by-date';
  } else {
    config.paths[normalizedKey] = value;
  }
  await saveConfig(config);
}

/**
 * Replace template variables in a string with actual paths.
 * Template variables are in the format {variableName}, e.g., {downloads}, {documents}
 */
export function replaceTemplateVariables(template: string, config: FlowSquireConfig, metadata?: { appName?: string; domain?: string }): string {
  let result = template;

  // Replace path-based template variables first
  for (const [key, value] of Object.entries(config.paths)) {
    const placeholder = `{${key}}`;
    result = result.replaceAll(placeholder, value);
  }
  
  // Replace metadata-based template variables if metadata is provided
  if (metadata) {
    result = result.replaceAll('{app}', metadata.appName ? sanitizeForPath(metadata.appName) : 'Unknown');
    result = result.replaceAll('{domain}', metadata.domain ? sanitizeForPath(metadata.domain) : 'General');
  }
  
  return result;
}

/**
 * Sanitize a string for use in folder/filenames
 */
function sanitizeForPath(input: string): string {
  return input
    .replace(/[<>:"\/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 50);
}

/**
 * Replace template variables in rule trigger and action configs
 */
export function replaceVariablesInObject<T extends Record<string, unknown>>(
  obj: T,
  config: FlowSquireConfig
): T {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = replaceTemplateVariables(value, config);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = replaceVariablesInObject(value as Record<string, unknown>, config);
    } else {
      result[key] = value;
    }
  }
  
  return result as T;
}

export function listConfigPaths(config: FlowSquireConfig): void {
  console.log('\n📁 Configured Paths:\n');
  for (const [key, value] of Object.entries(config.paths)) {
    console.log(`  {${key}}: ${value}`);
  }
  
  // Show organizer modes
  console.log(`\n📊 Downloads organizer mode: ${config.settings.downloadsMode}`);
  console.log('   (Change with: flowsquire config --downloads-mode nested|system)');
  console.log(`\n📸 Screenshot organizer mode: ${config.settings.screenshotMode}`);
  console.log('   (Change with: flowsquire config --screenshot-mode metadata|by-app|by-date)');
  console.log('   ⚠️  Mode changed? Delete rules and run "flowsquire init" to apply');
  console.log('');
}
