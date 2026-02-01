import { spawn } from 'child_process';
import { promisify } from 'util';
import { URL } from 'url';

const execAsync = promisify(require('child_process').exec);

export interface ScreenshotMetadata {
  appName: string;
  windowTitle: string;
  timestamp: Date;
  domain?: string;
  url?: string;
}

/**
 * Capture screenshot metadata by querying macOS for foreground app and window
 */
export async function captureScreenshotMetadata(): Promise<ScreenshotMetadata | null> {
  // Only works on macOS
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    // 1. Get foreground app name
    const appName = await getForegroundAppName();
    if (!appName) return null;
    
    // 2. Get window title (may fail if no window)
    const windowTitle = await getWindowTitle().catch(() => 'Unknown');

    // 3. Try to get URL/Domain if it's a browser
    let domain: string | undefined;
    let url: string | undefined;

    if (isBrowser(appName)) {
      url = await getBrowserUrl(appName);
      if (url) {
        try {
          // Parse hostname from URL (e.g., https://github.com/xyz -> github.com)
          const parsed = new URL(url);
          domain = parsed.hostname.replace(/^www\./, '');
        } catch (e) {
          // Invalid URL, ignore
        }
      }
    }

    // Fallback: If AppleScript URL fetch failed, try regex on title (old method)
    if (!domain) {
      domain = extractDomainFromTitle(windowTitle || '', appName || '');
    }

    return {
      appName: appName || 'Unknown',
      windowTitle: windowTitle || 'Unknown',
      timestamp: new Date(),
      domain,
      url
    };
  } catch (error) {
    console.error('Failed to capture screenshot metadata:', error);
    return null;
  }
}

/**
 * Check if the app is a supported browser
 */
function isBrowser(appName: string): boolean {
  const browsers = [
    'Safari', 'Google Chrome', 'Chrome', 'Microsoft Edge', 'Edge', 
    'Brave Browser', 'Brave', 'Arc', 'Opera', 'Vivaldi'
  ];
  return browsers.some(b => appName.includes(b));
}

/**
 * Get the name of the frontmost application
 */
async function getForegroundAppName(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get the title of the front window
 */
async function getWindowTitle(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `osascript -e '
        tell application "System Events"
          tell (first application process whose frontmost is true)
            get name of front window
          end tell
        end tell
      '`
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get the active URL from the specific browser
 */
async function getBrowserUrl(appName: string): Promise<string | undefined> {
  const scriptMap: Record<string, string> = {
    // Safari uses "document"
    'Safari': `tell application "Safari" to return URL of front document`,
    'Safari Technology Preview': `tell application "Safari Technology Preview" to return URL of front document`,
    
    // Chromium browsers use "active tab of front window"
    'Google Chrome': `tell application "Google Chrome" to return URL of active tab of front window`,
    'Microsoft Edge': `tell application "Microsoft Edge" to return URL of active tab of front window`,
    'Brave Browser': `tell application "Brave Browser" to return URL of active tab of front window`,
    'Arc': `tell application "Arc" to return URL of active tab of front window`,
    'Vivaldi': `tell application "Vivaldi" to return URL of active tab of front window`
  };

  // Find the matching script for the app name
  const scriptKey = Object.keys(scriptMap).find(key => appName.includes(key));
  
  if (!scriptKey) return undefined;

  try {
    const { stdout } = await execAsync(`osascript -e '${scriptMap[scriptKey]}'`);
    return stdout.trim();
  } catch (error) {
    // This often fails if the browser doesn't have a window open, 
    // or if the user denied "Apple Events" permission.
    return undefined;
  }
}

/**
 * Legacy fallback: Try to extract domain from window title
 */
function extractDomainFromTitle(windowTitle: string, appName: string): string | undefined {
  if (!isBrowser(appName)) return undefined;

  const domainPattern = /([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/;
  const match = windowTitle.match(domainPattern);
  
  if (match) {
    return match[1].toLowerCase();
  }

  return undefined;
}

/**
 * Sanitize a string for use in folder/filenames
 */
export function sanitizeForPath(input: string): string {
  return input
    .replace(/[<>:"\/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 50);
}

/**
 * Generate organized filename from metadata
 */
export function generateScreenshotFilename(
  originalFilename: string,
  metadata: ScreenshotMetadata
): string {
  const ext = originalFilename.substring(originalFilename.lastIndexOf('.'));
  
  const appName = sanitizeForPath(metadata.appName);
  const windowTitle = sanitizeForPath(metadata.windowTitle);
  const date = metadata.timestamp;
  
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}`;
  
  if (windowTitle && windowTitle !== 'Unknown' && windowTitle !== appName) {
    return `${appName}_${windowTitle}_${dateStr}_${timeStr}${ext}`;
  }
  
  return `${appName}_${dateStr}_${timeStr}${ext}`;
}

/**
 * Generate folder path from metadata
 */
export function generateScreenshotFolderPath(metadata: ScreenshotMetadata): string {
  const appName = sanitizeForPath(metadata.appName);
  
  if (metadata.domain) {
    return `${appName}/${metadata.domain}`;
  }
  
  return appName;
}
