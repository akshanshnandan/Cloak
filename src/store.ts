import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Preferences } from './types.ts';

export function defaults(): Preferences {
  return { activeProfileId: 'engineer', enabled: false, profiles: [
    { id: 'engineer', name: 'Engineering student', description: 'I study engineering and build software. I want a portable Mac laptop or desktop computer for programming, machine learning and research, with a powerful chip and plenty of memory. An iPad for university notes is useful too.', interests: ['Mac computers', 'Programming', 'Machine learning', 'Study tools'], avoid: 'Luxury phone upgrades, watch bands and smart home accessories.', feedback: [] },
    { id: 'lifestyle', name: 'Active lifestyle', description: 'I run, hike and train outdoors. I am interested in an Apple Watch for workouts, accurate heart rate monitoring and health tracking, wireless AirPods for music while running, and durable sports accessories with long battery life.', interests: ['Fitness watches', 'Health tracking', 'Running', 'Wireless headphones'], avoid: 'Desktop computers, professional video editing and programming hardware.', feedback: [] },
    { id: 'creative', name: 'Creative professional', description: 'I am a photographer and filmmaker. I care about professional iPhone cameras for shooting photos and video, a powerful Mac for video editing and graphic design, and an iPad with Apple Pencil for drawing.', interests: ['Photography', 'Video production', 'Drawing', 'Creative tools'], avoid: 'Fitness watches, home automation and basic office accessories.', feedback: [] },
    { id: 'finance', name: 'Finance researcher', description: 'I research financial markets and work with spreadsheets, data analysis and business reports. I want a Mac laptop for productivity and a clear, large external display for research.', interests: ['Productivity', 'Mac computers', 'Data analysis', 'Displays'], avoid: 'Fitness watches, gaming accessories and home automation.', feedback: [] }
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
