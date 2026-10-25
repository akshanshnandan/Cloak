import { cosine } from './model.ts';
import type { SemanticModel } from './model.ts';
import type { Profile, Story, RankedStory } from './types.ts';

export async function rankStories(model: Pick<SemanticModel, 'embed'>, stories: Story[], profile: Profile): Promise<RankedStory[]> {
  if (!stories.length) return [];
  const feedback = profile.feedback.slice(-40);
  const texts = [profile.description, ...profile.interests, profile.avoid || 'Unrelated content', ...feedback.map(f => f.title), ...stories.map(s => `${s.title}. ${s.description}`)];
  const vectors = await model.embed(texts);
  const topicStart = 1, avoidIndex = 1 + profile.interests.length, feedbackStart = avoidIndex + 1, storyStart = feedbackStart + feedback.length;
  const ranked = stories.map((story, i) => {
    const v = vectors[storyStart + i];
    const topics = profile.interests.map((topic, j) => ({ topic, match: cosine(v, vectors[topicStart + j]) })).sort((a,b) => b.match - a.match);
    let score = 0.65 * cosine(v, vectors[0]) + 0.35 * (topics[0]?.match ?? 0);
    if (profile.avoid.trim()) score -= 0.25 * Math.max(0, cosine(v, vectors[avoidIndex]));
    let strongest = 0, learned = '';
    feedback.forEach((f, j) => {
      const similarity = Math.max(0, cosine(v, vectors[feedbackStart + j]));
      const weight = 0.9 ** (feedback.length - j - 1);
      score += 0.32 * f.value * similarity * weight * (f.strength ?? 1);
      if (similarity * weight > strongest && f.value === 1) { strongest = similarity * weight; learned = f.title; }
    });
    const reason = strongest > 0.55 ? `Similar to something you liked: ${learned}` : topics[0]?.match > 0.15 ? `Matches your interest in ${topics[0].topic.toLowerCase()}` : 'Based on your personal profile';
    return { ...story, score, reason, movement: 0 };
  }).sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
  return ranked.map((story, i) => ({ ...story, movement: story.originalIndex - i }));
}
