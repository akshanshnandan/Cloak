import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Preferences } from './types.ts';

export function defaults(): Preferences {
  return { activeProfileId: 'engineer', enabled: false, profiles: [
    { id: 'engineer', name: 'Engineering student', description: 'I am a university engineering student. I need an affordable, portable Mac laptop for coding and coursework. Battery life and value matter more than maximum performance. An iPad for handwritten notes is useful. Bring verified education pricing and refurbished options closer.', interests: ['Portable Mac laptops', 'Programming', 'University study', 'Value for money'], avoid: 'Luxury phone upgrades, expensive desktop workstations and smart home accessories.', budget: 1400, feedback: [] },
    { id: 'lifestyle', name: 'Active lifestyle', description: 'I run, hike and train outdoors. I am interested in an Apple Watch for workouts, accurate heart rate monitoring and health tracking, wireless AirPods for music while running, and durable sports accessories with long battery life.', interests: ['Fitness watches', 'Health tracking', 'Running', 'Wireless headphones'], avoid: 'Desktop computers, professional video editing and programming hardware.', feedback: [] },
    { id: 'creative', name: 'Creative professional', description: 'I edit 4K films, work on professional photography and draw. Prioritize a powerful Mac for video editing, creative workflows and graphics performance, an iPad Pro with Apple Pencil for illustration, and professional iPhone cameras. Performance matters more than portability or low price.', interests: ['Video editing', 'Creative workstations', 'Photography', 'Illustration'], avoid: 'Fitness watches, home automation and basic phone cases.', budget: 4000, feedback: [] },
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
      const legacy: Record<string, string> = {
        engineer: 'I study engineering and build software. I want a portable Mac laptop or desktop computer for programming, machine learning and research, with a powerful chip and plenty of memory. An iPad for university notes is useful too.',
        creative: 'I am a photographer and filmmaker. I care about professional iPhone cameras for shooting photos and video, a powerful Mac for video editing and graphic design, and an iPad with Apple Pencil for drawing.'
      };
      let changed = false;
      for (const profile of this.value.profiles) {
        const preset = defaults().profiles.find(p => p.id === profile.id);
        // Upgrade only untouched bundled examples. Preserve custom needs and all feedback.
        if (preset && profile.description === legacy[profile.id] && profile.budget === undefined) {
          Object.assign(profile, { description: preset.description, interests: preset.interests, avoid: preset.avoid, budget: preset.budget }); changed = true;
        }
      }
      if (changed) await this.save();
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
