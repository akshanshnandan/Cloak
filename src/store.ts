import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Preferences } from './types.ts';

export function defaults(): Preferences {
  return { activeProfileId: 'engineer', enabled: true, profiles: [
    { id: 'engineer', name: 'Engineering student', description: 'I study engineering and build things. Prioritize robotics, practical AI research, open source developer tools, computer hardware, chips and ambitious technical projects.', interests: ['Robotics', 'AI research', 'Semiconductors', 'Developer tools'], avoid: 'Celebrity news, financial speculation, marketing and political arguments.', feedback: [] },
    { id: 'finance', name: 'Finance researcher', description: 'I research financial markets and the economy. Prioritize monetary policy, banking, investing, company strategy, economic research, market structure and financial technology.', interests: ['Markets', 'Economics', 'Fintech', 'Company strategy'], avoid: 'Programming tutorials, hobby electronics and video games.', feedback: [] }
  ] };
}

export class PreferenceStore {
  value = defaults();
  private writes = Promise.resolve();
  constructor(public directory: string) {}
  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      const value = JSON.parse(await readFile(path.join(this.directory, 'preferences.json'), 'utf8')) as Preferences;
      if (!value.profiles?.length || !value.profiles.some(p => p.id === value.activeProfileId)) throw new Error('Invalid preference file');
      this.value = value;
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; await this.save(); }
    return this.value;
  }
  get active() { return this.value.profiles.find(p => p.id === this.value.activeProfileId)!; }
  save() {
    const snapshot = JSON.stringify(this.value, null, 2);
    const write = this.writes.then(async () => {
      const file = path.join(this.directory, 'preferences.json');
      await writeFile(file + '.tmp', snapshot, 'utf8');
      await rename(file + '.tmp', file);
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
