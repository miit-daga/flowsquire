#!/usr/bin/env node

import { initDatabase } from './db/index.js';
import { FileWatcher } from './watchers/file-watcher.js';
import { getEnabledRules, saveRule } from './db/index.js';
import { Rule, Action } from './types/index.js';
import { randomUUID } from 'crypto';
import { loadConfig, setConfigValue, listConfigPaths, FlowSquireConfig } from './config/index.js';
import { findMatchingRules, executeActions } from './core/rule-engine.js';
import readline from 'readline';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'start':
      await startAgent();
      break;
    case 'init':
      await initWithTemplates();
      break;
    case 'rules':
      await listRules();
      break;
    case 'config':
      await handleConfigCommand(args.slice(1));
      break;
    default:
      console.log(`
FlowSquire Agent - Local file automation

Usage:
  flowsquire start                    Start the file watcher agent
  flowsquire init                     Run interactive setup wizard
  flowsquire rules                    List all rules
  flowsquire config                   Show all configured paths and settings
  flowsquire config --<key> <value>   Set a config value (path or mode)
  flowsquire config --<key>           Get a config value

Config Keys:
  Paths:     --downloads, --documents, --screenshots, --pictures, --videos, --music
  Modes:     --downloads-mode <nested|system>, --screenshot-mode <metadata|by-app|by-date>

Options:
  --dry-run                           Preview actions without executing (only with start)
`);
  }
}

async function startAgent() {
  console.log('🚀 FlowSquire Agent starting...\n');
  
  // Initialize database
  await initDatabase();
  
  // Load enabled rules
  const rules = await getEnabledRules();
  
  if (rules.length === 0) {
    console.log('⚠️  No enabled rules found. Run "flowsquire init" to create default rules.');
    process.exit(1);
  }
  
  console.log(`📋 Loaded ${rules.length} rule(s)\n`);
  
  // Start file watcher
  const dryRun = process.argv.includes('--dry-run');
  const watcher = new FileWatcher({ rules, dryRun });
  
  await watcher.start();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down...');
    watcher.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    watcher.stop();
    process.exit(0);
  });
}

async function initWithTemplates() {
  console.log('📝 Initializing FlowSquire with default templates...\n');
  
  await initDatabase();
  
  // Load or create config
  const config = await loadConfig();
  
  // Check if this is first-time setup (no rules exist yet)
  const existingRules = await getEnabledRules();
  if (existingRules.length === 0) {
    // Interactive setup for first-time users
    await runInteractiveSetup(config);
  }
  
  // Reload config after potential changes
  const finalConfig = await loadConfig();
  
  // Create PDF Workflow Template Rules (in priority order)
  // Determine PDF destinations based on downloadsMode setting
  const isNestedMode = finalConfig.settings.downloadsMode === 'nested';
  
  const pdfDestinations = {
    compressed: isNestedMode ? '{downloads}/PDFs/Compressed' : '{documents}/PDFs/Compressed',
    invoices: isNestedMode ? '{downloads}/PDFs/Invoices' : '{documents}/PDFs/Invoices',
    finance: isNestedMode ? '{downloads}/PDFs/Finance' : '{documents}/PDFs/Finance',
    study: isNestedMode ? '{downloads}/PDFs/Study' : '{documents}/PDFs/Study',
    unsorted: isNestedMode ? '{downloads}/PDFs/Unsorted' : '{documents}/PDFs/Unsorted',
  };
  
  // Rule 1: Large PDF Compression (Priority 500 - highest, only for files > 8MB)
  // Smart compression: detects category, moves original, then compresses to PDFs/{category}/Compressed/
  const largePdfCompressionRule: Rule = {
    id: randomUUID(),
    name: 'Large PDF Compression',
    enabled: true,
    priority: 500,
    tags: ['pdf', 'compression', 'large-files'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'equals', value: 'pdf' },
      { type: 'size_greater_than_mb', operator: 'equals', value: 8 },
    ],
    actions: [
      // First: Move original to category folder
      {
        type: 'move',
        config: {
          destination: `${isNestedMode ? '{downloads}' : '{documents}'}/PDFs/{category}`,
          createDirs: true,
        },
      },
      // Second: Compress to Compressed/ subfolder
      {
        type: 'compress',
        config: {
          destination: `${isNestedMode ? '{downloads}' : '{documents}'}/PDFs/{category}/Compressed`,
          pattern: '{filename}_compressed',
          createDirs: true,
          compress: {
            quality: 'medium',
            archiveOriginal: true,
          },
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Rule 2: Invoice PDFs (Priority 400)
  const invoiceRule: Rule = {
    id: randomUUID(),
    name: 'PDF Invoice Organizer',
    enabled: true,
    priority: 400,
    tags: ['pdf', 'invoice', 'finance'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'equals', value: 'pdf' },
      { type: 'name_contains', operator: 'equals', value: 'invoice' },
    ],
    actions: [
      {
        type: 'move',
        config: {
          destination: pdfDestinations.invoices,
          pattern: '{filename}_{YYYY}-{MM}-{DD}',
          createDirs: true,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Rule 3: Bank/Statement PDFs (Priority 300)
  const bankRule: Rule = {
    id: randomUUID(),
    name: 'PDF Bank Statement Organizer',
    enabled: true,
    priority: 300,
    tags: ['pdf', 'bank', 'finance', 'statement'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'equals', value: 'pdf' },
      { type: 'name_contains', operator: 'equals', value: 'bank' },
    ],
    actions: [
      {
        type: 'move',
        config: {
          destination: pdfDestinations.finance,
          pattern: '{filename}_{YYYY}-{MM}',
          createDirs: true,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Rule 4: Notes/College PDFs (Priority 200)
  const notesRule: Rule = {
    id: randomUUID(),
    name: 'PDF Study Notes Organizer',
    enabled: true,
    priority: 200,
    tags: ['pdf', 'study', 'notes', 'college'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'equals', value: 'pdf' },
      { type: 'name_contains', operator: 'equals', value: 'notes' },
    ],
    actions: [
      {
        type: 'move',
        config: {
          destination: pdfDestinations.study,
          pattern: '{filename}_{YYYY}-{MM}-{DD}',
          createDirs: true,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Rule 5: Default PDF Organizer (Priority 100 - lowest)
  const defaultPdfRule: Rule = {
    id: randomUUID(),
    name: 'PDF Default Organizer',
    enabled: true,
    priority: 100,
    tags: ['pdf', 'default'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'equals', value: 'pdf' },
    ],
    actions: [
      {
        type: 'move',
        config: {
          destination: pdfDestinations.unsorted,
          createDirs: true,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  // Save all rules
  await saveRule(largePdfCompressionRule);
  await saveRule(invoiceRule);
  await saveRule(bankRule);
  await saveRule(notesRule);
  await saveRule(defaultPdfRule);

  // Show appropriate messages based on mode
  if (isNestedMode) {
    console.log('✓ Created: Large PDF Compression (>8MB → Downloads/PDFs/Compressed)');
    console.log('✓ Created: PDF Invoice Organizer (invoices → Downloads/PDFs/Invoices)');
    console.log('✓ Created: PDF Bank Statement Organizer (bank → Downloads/PDFs/Finance)');
    console.log('✓ Created: PDF Study Notes Organizer (notes → Downloads/PDFs/Study)');
    console.log('✓ Created: PDF Default Organizer (other PDFs → Downloads/PDFs/Unsorted)');
  } else {
    console.log('✓ Created: Large PDF Compression (>8MB → Documents/PDFs/Compressed)');
    console.log('✓ Created: PDF Invoice Organizer (invoices → Documents/PDFs/Invoices)');
    console.log('✓ Created: PDF Bank Statement Organizer (bank → Documents/PDFs/Finance)');
    console.log('✓ Created: PDF Study Notes Organizer (notes → Documents/PDFs/Study)');
    console.log('✓ Created: PDF Default Organizer (other PDFs → Documents/PDFs/Unsorted)');
  }

  // Create Downloads Organizer Template Rules (Priority 50 - lower than PDF rules)
  // isNestedMode and destinations already defined above for PDF rules
  
  const destinations = {
    images: isNestedMode ? '{downloads}/Images' : '{pictures}/Downloads',
    videos: isNestedMode ? '{downloads}/Videos' : '{videos}',
    music: isNestedMode ? '{downloads}/Music' : '{music}',
    archives: isNestedMode ? '{downloads}/Archives' : '{documents}/Archives',
    documents: isNestedMode ? '{downloads}/Documents' : '{documents}/Documents',
    installers: isNestedMode ? '{downloads}/Installers' : '{documents}/Installers',
    code: isNestedMode ? '{downloads}/Code' : '{documents}/Code',
  };

  // Rule 6: Images Organizer (Priority 50)
  const imagesRule: Rule = {
    id: randomUUID(),
    name: 'Downloads - Images Organizer',
    enabled: true,
    priority: 50,
    tags: ['downloads', 'images', 'organizer'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'in', value: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'] },
    ],
    actions: [
      {
        type: 'move',
        config: {
          destination: destinations.images,
          createDirs: true,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Rule 7: Videos Organizer (Priority 50)
  const videosRule: Rule = {
    id: randomUUID(),
    name: 'Downloads - Videos Organizer',
    enabled: true,
    priority: 50,
    tags: ['downloads', 'videos', 'organizer'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'in', value: ['mp4', 'mov', 'avi', 'mkv'] },
    ],
    actions: [
      {
        type: 'move',
        config: {
          destination: destinations.videos,
          createDirs: true,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Rule 8: Music Organizer (Priority 50)
  const musicRule: Rule = {
    id: randomUUID(),
    name: 'Downloads - Music Organizer',
    enabled: true,
    priority: 50,
    tags: ['downloads', 'music', 'organizer'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'in', value: ['mp3', 'wav', 'flac', 'aac'] },
    ],
    actions: [
      {
        type: 'move',
        config: {
          destination: destinations.music,
          createDirs: true,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Rule 9: Archives Organizer (Priority 50)
  const archivesRule: Rule = {
    id: randomUUID(),
    name: 'Downloads - Archives Organizer',
    enabled: true,
    priority: 50,
    tags: ['downloads', 'archives', 'organizer'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'in', value: ['zip', 'rar', '7z', 'tar', 'gz'] },
    ],
    actions: [
      {
        type: 'move',
        config: {
          destination: destinations.archives,
          createDirs: true,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Rule 10: Documents Organizer (Priority 50)
  const documentsRule: Rule = {
    id: randomUUID(),
    name: 'Downloads - Documents Organizer',
    enabled: true,
    priority: 50,
    tags: ['downloads', 'documents', 'organizer'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'in', value: ['doc', 'docx', 'txt', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx'] },
    ],
    actions: [
      {
        type: 'move',
        config: {
          destination: destinations.documents,
          createDirs: true,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Rule 11: Installers Organizer (Priority 50)
  const installersRule: Rule = {
    id: randomUUID(),
    name: 'Downloads - Installers Organizer',
    enabled: true,
    priority: 50,
    tags: ['downloads', 'installers', 'organizer'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'in', value: ['dmg', 'pkg', 'exe', 'msi'] },
    ],
    actions: [
      {
        type: 'move',
        config: {
          destination: destinations.installers,
          createDirs: true,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Rule 12: Code Files Organizer (Priority 50)
  const codeRule: Rule = {
    id: randomUUID(),
    name: 'Downloads - Code Files Organizer',
    enabled: true,
    priority: 50,
    tags: ['downloads', 'code', 'organizer'],
    trigger: {
      type: 'file_created',
      config: { folder: '{downloads}' },
    },
    conditions: [
      { type: 'extension', operator: 'in', value: ['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'cpp', 'c', 'h'] },
    ],
    actions: [
      {
        type: 'move',
        config: {
          destination: destinations.code,
          createDirs: true,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Save all Downloads Organizer rules
  await saveRule(imagesRule);
  await saveRule(videosRule);
  await saveRule(musicRule);
  await saveRule(archivesRule);
  await saveRule(documentsRule);
  await saveRule(installersRule);
  await saveRule(codeRule);

  // Show appropriate messages based on mode
  if (isNestedMode) {
    console.log('✓ Created: Images Organizer (jpg, png, gif, etc. → Downloads/Images)');
    console.log('✓ Created: Videos Organizer (mp4, mov, etc. → Downloads/Videos)');
    console.log('✓ Created: Music Organizer (mp3, wav, etc. → Downloads/Music)');
    console.log('✓ Created: Archives Organizer (zip, rar, etc. → Downloads/Archives)');
    console.log('✓ Created: Documents Organizer (doc, xls, etc. → Downloads/Documents)');
    console.log('✓ Created: Installers Organizer (dmg, pkg, etc. → Downloads/Installers)');
    console.log('✓ Created: Code Files Organizer (js, py, etc. → Downloads/Code)');
  } else {
    console.log('✓ Created: Images Organizer (jpg, png, gif, etc. → Pictures/Downloads)');
    console.log('✓ Created: Videos Organizer (mp4, mov, etc. → Movies)');
    console.log('✓ Created: Music Organizer (mp3, wav, etc. → Music)');
    console.log('✓ Created: Archives Organizer (zip, rar, etc. → Documents/Archives)');
    console.log('✓ Created: Documents Organizer (doc, xls, etc. → Documents/Documents)');
    console.log('✓ Created: Installers Organizer (dmg, pkg, etc. → Documents/Installers)');
    console.log('✓ Created: Code Files Organizer (js, py, etc. → Documents/Code)');
  }

  console.log('\n✅ Templates initialized! (PDF Workflow + Downloads Organizer)');
  console.log(`Mode: ${finalConfig.settings.downloadsMode === 'nested' ? 'Organize inside Downloads' : 'Move to system folders'}`);
  
  // Create Screenshot Organizer Template Rules
  await createScreenshotOrganizerRules(finalConfig);
  
  // Prompt to organize existing files (after rules are created)
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      await promptOrganizeExistingFiles(rl, finalConfig);
    } finally {
      rl.close();
    }
  }
  
  console.log('\nRun "flowsquire start" to begin watching files.');
}

async function listRules() {
  await initDatabase();
  const rules = await getEnabledRules();
  
  console.log('\n📋 Rules:\n');
  
  for (const rule of rules) {
    const status = rule.enabled ? '🟢' : '🔴';
    console.log(`${status} ${rule.name} (${rule.id})`);
    console.log(`   Trigger: ${rule.trigger.type}`);
    console.log(`   Actions: ${rule.actions.map((a: Action) => a.type).join(', ')}`);
    console.log('');
  }
}

async function handleConfigCommand(args: string[]) {
  const config = await loadConfig();
  
  if (args.length === 0) {
    // Show all config
    listConfigPaths(config);
    return;
  }
  
  // Parse arguments
  const setArgs: Record<string, string> = {};
  const getArgs: string[] = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        // Set value
        setArgs[key] = args[i + 1];
        i++; // Skip the value
      } else {
        // Get value
        getArgs.push(key);
      }
    }
  }
  
  // Handle get operations
  for (const key of getArgs) {
    if (key === 'downloadsMode') {
      console.log(`{${key}}: ${config.settings.downloadsMode}`);
    } else {
      const value = config.paths[key];
      if (value !== undefined) {
        console.log(`{${key}}: ${value}`);
      } else {
        console.log(`{${key}}: (not set)`);
      }
    }
  }
  
  // Handle set operations
  let modeChanged = false;
  for (const [key, value] of Object.entries(setArgs)) {
    await setConfigValue(key, value);
    console.log(`✓ Set {${key}} to: ${value}`);
    
    // Check if downloadsMode or screenshotMode was changed
    if (key === 'downloadsMode' || key === 'downloads-mode' ||
        key === 'screenshotMode' || key === 'screenshot-mode') {
      modeChanged = true;
    }
  }
  
  // Show hint if mode was changed
  if (modeChanged) {
    console.log('\n⚠️  Note: Run "rm .flowsquire/rules.json && flowsquire init" to regenerate rules with new mode');
  }
  
  // Show current modes in config listing
  if (args.length === 0) {
    console.log(`\n📊 Downloads organizer mode: ${config.settings.downloadsMode}`);
    console.log('   (Change with: flowsquire config --downloads-mode nested|system)');
    console.log(`\n📸 Screenshot organizer mode: ${config.settings.screenshotMode}`);
    console.log('   (Change with: flowsquire config --screenshot-mode metadata|by-app|by-date)');
    if (modeChanged) {
      console.log('   ⚠️  Mode changed? Delete rules and run "flowsquire init" to apply');
    }
  }
}

// Helper function to ask user a question via CLI
function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// Interactive setup for first-time users
async function runInteractiveSetup(config: FlowSquireConfig): Promise<void> {
  // Check if stdin is a TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    console.log('⚠️  Non-interactive mode detected. Using default settings.');
    console.log(`   Watch folder: ${config.paths.downloads}`);
    console.log(`   Organizer mode: ${config.settings.downloadsMode}`);
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('👋 Welcome to FlowSquire!\n');
    console.log('Let\'s set up your file organization preferences.\n');

    // Question 1: Which folder to watch
    const defaultDownloads = config.paths.downloads;
    const downloadsAnswer = await askQuestion(
      rl,
      `Which folder should I watch for new files? [${defaultDownloads}]: `
    );
    let downloadsPath = downloadsAnswer || defaultDownloads;
    
    // Expand ~ to home directory
    if (downloadsPath.startsWith('~/')) {
      downloadsPath = path.join(os.homedir(), downloadsPath.slice(2));
    }
    
    // Resolve to absolute path if relative
    const absoluteDownloads = path.isAbsolute(downloadsPath) 
      ? downloadsPath 
      : path.resolve(downloadsPath);
    
    await setConfigValue('downloads', absoluteDownloads);
    console.log(`✓ Watch folder set to: ${absoluteDownloads}\n`);

    // Question 2: Documents folder (for PDFs, Archives, etc.)
    const defaultDocuments = config.paths.documents;
    const documentsAnswer = await askQuestion(
      rl,
      `Where should documents be organized? [${defaultDocuments}]: `
    );
    let documentsPath = documentsAnswer || defaultDocuments;
    
    // Expand ~ to home directory
    if (documentsPath.startsWith('~/')) {
      documentsPath = path.join(os.homedir(), documentsPath.slice(2));
    }
    
    // Resolve to absolute path if relative
    const absoluteDocuments = path.isAbsolute(documentsPath) 
      ? documentsPath 
      : path.resolve(documentsPath);
    
    await setConfigValue('documents', absoluteDocuments);
    console.log(`✓ Documents folder set to: ${absoluteDocuments}\n`);

    // Question 3: Screenshots folder (for Shottr or native screenshots)
    console.log('⚠️  Note: Using Desktop or Documents for screenshots may cause detection issues');
    console.log('    due to macOS FSEvents limitations. For best results, use a custom folder');
    console.log('    (e.g., ~/Downloads/Screenshots).\n');
    const defaultScreenshots = config.paths.screenshots;
    const screenshotsAnswer = await askQuestion(
      rl,
      `Where do your screenshots get saved? [${defaultScreenshots}]: `
    );
    let screenshotsPath = screenshotsAnswer || defaultScreenshots;
    
    // Expand ~ to home directory
    if (screenshotsPath.startsWith('~/')) {
      screenshotsPath = path.join(os.homedir(), screenshotsPath.slice(2));
    }
    
    // Resolve to absolute path if relative
    const absoluteScreenshots = path.isAbsolute(screenshotsPath)
      ? screenshotsPath
      : path.resolve(screenshotsPath);
    
    await setConfigValue('screenshots', absoluteScreenshots);
    console.log(`✓ Screenshots folder set to: ${absoluteScreenshots}\n`);

    // Question 4: Downloads organizer mode
    console.log('How should I organize downloaded files?\n');
    console.log('[1] Organize inside Downloads folder (default)');
    console.log('    • Images → ~/Downloads/Images/');
    console.log('    • Music  → ~/Downloads/Music/');
    console.log('    • Videos → ~/Downloads/Videos/');
    console.log('    • etc.\n');
    console.log('[2] Move to system folders');
    console.log('    • Images → ~/Pictures/Downloads/');
    console.log('    • Music  → ~/Music/');
    console.log('    • Videos → ~/Movies/');
    console.log('    • etc.\n');

    const modeAnswer = await askQuestion(rl, 'Select option [1/2]: ');
    const downloadsMode = modeAnswer === '2' ? 'system' : 'nested';
    
    await setConfigValue('downloadsMode', downloadsMode);
    console.log(`✓ Downloads organizer mode set to: ${downloadsMode}\n`);

    // Question 5: Screenshot organization mode
    console.log('\n📸 How should screenshots be organized?\n');
    console.log('[1] Full Metadata (recommended)');
    console.log('    • Organizes by: App/Domain/{filename_date}');
    console.log('    • Example: Google Chrome/aistudio.google.com/SCR-2026-02-01_16-41.png');
    console.log('    • Requires: macOS with Accessibility permissions\n');
    console.log('[2] By App Only');
    console.log('    • Organizes by: App/{filename}');
    console.log('    • Example: Google Chrome/SCR-20260201-ornd.png\n');
    console.log('[3] By Date Only');
    console.log('    • Organizes by: Date/{filename}');
    console.log('    • Example: 2026/02/01/SCR-20260201-ornd.png');
    console.log('    • Works on all platforms\n');

    const screenshotModeAnswer = await askQuestion(rl, 'Select option [1/2/3]: ');
    const screenshotMode = screenshotModeAnswer === '2' ? 'by-app' : 
                           screenshotModeAnswer === '3' ? 'by-date' : 'metadata';
    
    await setConfigValue('screenshotMode', screenshotMode);
    console.log(`✓ Screenshot organizer mode set to: ${screenshotMode}\n`);

    console.log('✅ Configuration saved!\n');
  } finally {
    rl.close();
  }
}

// Prompt user to organize existing files
async function promptOrganizeExistingFiles(rl: readline.Interface, config: FlowSquireConfig): Promise<void> {
  const downloadsPath = config.paths.downloads;
  
  // Count existing files
  let existingFiles: string[] = [];
  try {
    const entries = await fs.readdir(downloadsPath, { withFileTypes: true });
    existingFiles = entries
      .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
      .map(entry => path.join(downloadsPath, entry.name));
  } catch {
    console.log('⚠️  Could not read Downloads folder. Skipping existing file organization.');
    return;
  }
  
  if (existingFiles.length === 0) {
    console.log('📂 Downloads folder is empty. No existing files to organize.');
    return;
  }
  
  console.log(`📂 Your Downloads folder has ${existingFiles.length} file(s).`);
  console.log('Would you like to organize existing files now?\n');
  console.log('[1] Yes, show me what will be moved first');
  console.log('[2] No, only organize new files (default)\n');
  
  const organizeAnswer = await askQuestion(rl, 'Select option [1/2]: ');
  
  if (organizeAnswer !== '1') {
    console.log('✓ Skipping existing file organization.\n');
    return;
  }
  
  // Load rules and show preview
  const rules = await getEnabledRules();
  const preview: Array<{ file: string; rule: string; destination: string }> = [];
  
  for (const filePath of existingFiles) {
    const matchingRules = findMatchingRules(rules, filePath);
    if (matchingRules.length > 0) {
      const rule = matchingRules[0];
      // Calculate destination
      const action = rule.actions[0];
      if (action && (action.type === 'move' || action.type === 'copy' || action.type === 'compress')) {
        const destTemplate = action.config.destination;
        const fileName = path.basename(filePath);
        // Simple destination preview (without pattern processing)
        let destPath: string;
        if (action.type === 'compress' && action.config.pattern) {
          // For compression, show the compressed filename
          const ext = path.extname(fileName);
          const base = path.basename(fileName, ext);
          destPath = path.join(destTemplate, `${base}_compressed${ext}`);
        } else {
          destPath = path.join(destTemplate, fileName);
        }
        preview.push({
          file: fileName,
          rule: rule.name,
          destination: destPath,
        });
      }
    }
  }
  
  if (preview.length === 0) {
    console.log('\n📋 No files match the current rules.');
    return;
  }
  
  console.log(`\n📋 Preview of actions (${preview.length} files):`);
  // Show first 10 files
  preview.slice(0, 10).forEach(item => {
    console.log(`  • ${item.file} → ${item.destination}`);
  });
  if (preview.length > 10) {
    console.log(`  ... and ${preview.length - 10} more files`);
  }
  
  const confirmAnswer = await askQuestion(rl, '\nProceed with organization? [y/N]: ');
  
  if (confirmAnswer.toLowerCase() !== 'y') {
    console.log('✓ Organization cancelled.\n');
    return;
  }
  
  // Execute organization
  console.log('\n🔄 Organizing files...\n');
  let successCount = 0;
  let failCount = 0;
  
  for (const filePath of existingFiles) {
    const matchingRules = findMatchingRules(rules, filePath);
    if (matchingRules.length > 0) {
      const rule = matchingRules[0];
      try {
        await executeActions(rule.actions, filePath, false);
        successCount++;
        console.log(`  ✓ ${path.basename(filePath)}`);
      } catch (error) {
        failCount++;
        console.log(`  ✗ ${path.basename(filePath)} (error)`);
      }
    }
  }
  
  console.log(`\n✅ Organization complete! ${successCount} files moved, ${failCount} failed.\n`);
}

// Create Screenshot Organizer Template Rules
async function createScreenshotOrganizerRules(config: FlowSquireConfig): Promise<void> {
  console.log('\n📸 Creating Screenshot Organizer rules...\n');
  
  // Determine screenshot destination based on downloadsMode
  const isNestedMode = config.settings.downloadsMode === 'nested';
  const screenshotMode = config.settings.screenshotMode || 'metadata';
  
  const screenshotDestinations = {
    organized: isNestedMode
      ? '{screenshots}/Organized'
      : '{pictures}/Screenshots/Organized',
    byApp: isNestedMode
      ? '{screenshots}/ByApp'
      : '{pictures}/Screenshots/ByApp',
    byDate: isNestedMode
      ? '{screenshots}/ByDate'
      : '{pictures}/Screenshots/ByDate',
  };
  
  // Create rules based on user's selected screenshot mode
  if (screenshotMode === 'metadata') {
    // Rule: Screenshot Organizer with Metadata (Priority 450)
    const screenshotMetadataRule: Rule = {
      id: randomUUID(),
      name: 'Screenshot Organizer with Metadata',
      enabled: true,
      priority: 450,
      tags: ['screenshot', 'metadata', 'organizer'],
      trigger: {
        type: 'file_created',
        config: { folder: '{screenshots}' },
      },
      conditions: [
        { type: 'extension', operator: 'in', value: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      ],
      actions: [
        {
          type: 'move',
          config: {
            destination: `${screenshotDestinations.organized}/{app}/{domain}`,
            pattern: '{filename}_{YYYY}-{MM}-{DD}_{HH}-{mm}',
            createDirs: true,
          },
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await saveRule(screenshotMetadataRule);
    
    if (isNestedMode) {
      console.log('✓ Created: Screenshot Organizer with Metadata (→ Screenshots/Organized/{app}/{domain})');
    } else {
      console.log('✓ Created: Screenshot Organizer with Metadata (→ Pictures/Screenshots/Organized/{app}/{domain})');
    }
    console.log('    Example: Google Chrome/aistudio.google.com/SCR-2026-02-01_16-41.png');
    
  } else if (screenshotMode === 'by-app') {
    // Rule: Screenshot by App (Priority 450)
    const screenshotByAppRule: Rule = {
      id: randomUUID(),
      name: 'Screenshot - Organize by App',
      enabled: true,
      priority: 450,
      tags: ['screenshot', 'by-app', 'organizer'],
      trigger: {
        type: 'file_created',
        config: { folder: '{screenshots}' },
      },
      conditions: [
        { type: 'extension', operator: 'in', value: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      ],
      actions: [
        {
          type: 'move',
          config: {
            destination: `${screenshotDestinations.byApp}/{app}`,
            createDirs: true,
          },
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await saveRule(screenshotByAppRule);
    
    if (isNestedMode) {
      console.log('✓ Created: Screenshot by App (→ Screenshots/ByApp/{app})');
    } else {
      console.log('✓ Created: Screenshot by App (→ Pictures/Screenshots/ByApp/{app})');
    }
    console.log('    Example: Google Chrome/SCR-20260201-ornd.png');
    
  } else if (screenshotMode === 'by-date') {
    // Rule: Screenshot by Date (Priority 450)
    const screenshotByDateRule: Rule = {
      id: randomUUID(),
      name: 'Screenshot - Organize by Date',
      enabled: true,
      priority: 450,
      tags: ['screenshot', 'by-date', 'organizer'],
      trigger: {
        type: 'file_created',
        config: { folder: '{screenshots}' },
      },
      conditions: [
        { type: 'extension', operator: 'in', value: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      ],
      actions: [
        {
          type: 'move',
          config: {
            destination: screenshotDestinations.byDate,
            pattern: '{YYYY}/{Month}/{filename}',
            createDirs: true,
          },
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await saveRule(screenshotByDateRule);
    
    if (isNestedMode) {
      console.log('✓ Created: Screenshot by Date (→ Screenshots/ByDate/{YYYY}/{MM})');
    } else {
      console.log('✓ Created: Screenshot by Date (→ Pictures/Screenshots/ByDate/{YYYY}/{MM})');
    }
    console.log('    Example: 2026/02/01/SCR-20260201-ornd.png');
  }
  
  console.log('\n  Note: Screenshot metadata capture requires macOS Accessibility permissions.');
  console.log('  On non-macOS platforms, screenshots will be organized by date/filename.\n');
}

main().catch(console.error);
