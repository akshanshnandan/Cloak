export interface Feedback { id: string; title: string; value: 1 | -1; at: string; strength?: number }
export interface Profile { id: string; name: string; description: string; interests: string[]; avoid: string; feedback: Feedback[]; budget?: number | null; reading?: 'auto' | 'standard' | 'larger'; density?: 'auto' | 'all' | 'focused' }
export interface Preferences { activeProfileId: string; enabled: boolean; profiles: Profile[] }
export interface Story { id: string; title: string; url: string; description: string; originalIndex: number; sectionId?: string; kind?: 'product' | 'content'; price?: number | null; currency?: string; education?: boolean }
export interface RankedStory extends Story { score: number; reason: string; movement: number }
export interface ModelStatus { phase: 'idle' | 'loading' | 'ready' | 'error'; message: string; progress: number }
export interface PageSection { id: string; title: string; description: string; itemIds: string[]; originalIndex: number }
export interface PageCategory { id: string; title: string; url: string; originalIndex: number }
export interface PageInventory { url: string; sections: PageSection[]; categories: PageCategory[]; items: Story[]; primarySectionId: string; mode?: 'store' | 'content' | 'transaction'; groups?: { id: string; type: 'sections' | 'items' | 'categories'; ids: string[] }[] }
export interface IntentDecision { title: string; query: string; budget: number | null; products: number[]; sections: number[]; categories: number[]; reading?: 'standard' | 'larger'; density?: 'all' | 'focused' }
export interface PersonalizationPlan {
  id: string; profileId: string; inventoryKey: string;
  source: { model: string; generatedAt: string; cached: boolean };
  intent: { title: string; query: string; budget: number | null };
  sectionOrder: string[]; categoryOrder: string[]; itemOrders: Record<string, string[]>;
  collection: { sectionId: string; title: string; itemIds: string[] };
  presentation?: { reading: 'standard' | 'larger'; density: 'all' | 'focused' };
}
