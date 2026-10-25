export interface Feedback { id: string; title: string; value: 1 | -1; at: string; strength?: number }
export interface Profile { id: string; name: string; description: string; interests: string[]; avoid: string; feedback: Feedback[] }
export interface Preferences { activeProfileId: string; enabled: boolean; profiles: Profile[] }
export interface Story { id: string; title: string; url: string; description: string; originalIndex: number }
export interface RankedStory extends Story { score: number; reason: string; movement: number }
export interface ModelStatus { phase: 'idle' | 'loading' | 'ready' | 'error'; message: string; progress: number }
