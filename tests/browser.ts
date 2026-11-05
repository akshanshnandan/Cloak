import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const installedChrome = process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined;
export const executablePath = process.env.TEST_CHROME_PATH || (installedChrome && existsSync(installedChrome) ? installedChrome : undefined);
export const launchChromium = () => chromium.launch(executablePath ? { executablePath } : {});
