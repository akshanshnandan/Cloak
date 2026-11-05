import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const installedBrowsers = process.platform === 'win32'
  ? ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
  : [];
export const executablePath = process.env.TEST_CHROME_PATH || installedBrowsers.find(existsSync);
export const launchChromium = () => chromium.launch(executablePath ? { executablePath } : {});
