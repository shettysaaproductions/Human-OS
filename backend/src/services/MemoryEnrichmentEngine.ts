/**
 * MemoryEnrichmentEngine.ts — Sparse Memory Bubble Detector & Curiosity Driver
 *
 * Implements conversational bubble enrichment:
 * 1. Scans long-term and working memories for nodes with thin depth (< 2 sub-attributes).
 * 2. Identifies missing branches/stems (e.g. artist without genre/tracks, friend without shared history/activities).
 * 3. Synthesizes warm, natural, human curiosity angles so Nova naturally enriches bubbles
 *    over the course of friendship rather than treating memories as static single-word tags.
 */

export interface SparseNode {
  nodeKey: string;
  title: string;
  existingContext: string;
  missingAttributes: string[];
  curiosityAngle: string;
}

export class MemoryEnrichmentEngine {
  /**
   * Identifies sparse memory bubbles that need conversational depth.
   */
  public static detectSparseNodes(
    memories: Array<{ key: string; value: string }>,
    workingMemories: Array<{ key: string; value: string }> = []
  ): SparseNode[] {
    const sparseNodes: SparseNode[] = [];
    const allKeys = new Set(memories.map(m => m.key.toLowerCase()));
    const memMap = new Map<string, string>();
    for (const m of memories) {
      memMap.set(m.key.toLowerCase(), m.value);
    }
    for (const wm of workingMemories) {
      if (!memMap.has(wm.key.toLowerCase())) {
        memMap.set(wm.key.toLowerCase(), wm.value);
      }
    }

    // 1. Creative / Artist Bubble Enrichment
    const professionVal = memMap.get('profession') || '';
    const isArtist = /artist|rapper|musician|singer|producer|hip[- ]hop/i.test(professionVal) ||
      allKeys.has('career_milestone_mtv_hustle') ||
      allKeys.has('career_milestone_gully_boy') ||
      allKeys.has('artist_genre');

    if (isArtist) {
      const missingArtist: string[] = [];
      if (!allKeys.has('artist_genre') && !/hip[- ]hop|rap|pop|rock|classical/i.test(professionVal)) {
        missingArtist.push('music genre / style');
      }
      const hasTracksOrSongs = Array.from(allKeys).some(k => k.includes('track') || k.includes('song') || k.includes('album'));
      if (!hasTracksOrSongs) {
        missingArtist.push('current tracks / released songs');
      }
      const hasUpcomingProjects = Array.from(allKeys).some(k => k.includes('project') || k.includes('upcoming') || k.includes('release'));
      if (!hasUpcomingProjects) {
        missingArtist.push('upcoming releases or shows');
      }

      if (missingArtist.length > 0) {
        const existingInfo = [
          professionVal ? `Role: ${professionVal}` : '',
          memMap.get('career_milestone_mtv_hustle') ? `Milestone: ${memMap.get('career_milestone_mtv_hustle')}` : '',
          memMap.get('career_milestone_gully_boy') ? `Movie: ${memMap.get('career_milestone_gully_boy')}` : '',
        ].filter(Boolean).join(', ');

        sparseNodes.push({
          nodeKey: 'profession_artist',
          title: 'Artist & Music Career',
          existingContext: existingInfo || 'User is an artist/rapper',
          missingAttributes: missingArtist,
          curiosityAngle: 'Music scene mein kaunse style ya naye tracks pe kaam chal raha hai aaj kal?'
        });
      }
    }

    // 2. Friend Relationship Bubbles (e.g. Sushant, Ijaz, etc.)
    const friendNames = new Set<string>();
    const friendNameVal = memMap.get('friend_name');
    if (friendNameVal && friendNameVal.length < 30) {
      friendNames.add(friendNameVal.trim());
    }

    for (const k of allKeys) {
      if (k.startsWith('friend_') && !k.endsWith('_name') && !k.endsWith('_relation') && !k.endsWith('_habit')) {
        const slug = k.replace(/^friend_/, '');
        if (slug && slug !== 'name') {
          friendNames.add(slug.charAt(0).toUpperCase() + slug.slice(1));
        }
      }
    }

    for (const fName of friendNames) {
      const slug = fName.toLowerCase();
      const hasRelation = allKeys.has(`friend_${slug}_relation`);
      const hasHabit = allKeys.has(`friend_${slug}_habit`);
      const hasSince = allKeys.has(`friend_${slug}_since`);
      const missingFriend: string[] = [];

      if (!hasRelation) missingFriend.push('how they met / bond type (childhood, college, etc.)');
      if (!hasHabit) missingFriend.push('shared habits or what they usually do together');
      if (!hasSince) missingFriend.push('how long they have known each other');

      if (missingFriend.length >= 2) {
        sparseNodes.push({
          nodeKey: `friend_${slug}`,
          title: `Friend (${fName})`,
          existingContext: `User is friends with ${fName}`,
          missingAttributes: missingFriend,
          curiosityAngle: `Waise ${fName} se dosti kitni purani hai — childhood friend hai ya college/office time se?`
        });
      }
    }

    // 3. Goal Bubble Depth
    const goalVal = memMap.get('goals') || memMap.get('primary_goal');
    if (goalVal && !allKeys.has('target_exam') && !allKeys.has('goal_deadline') && !allKeys.has('goal_milestone')) {
      sparseNodes.push({
        nodeKey: 'goals',
        title: 'Core Ambition & Goals',
        existingContext: goalVal,
        missingAttributes: ['target timeline or milestone', 'current biggest obstacle'],
        curiosityAngle: 'Is goal ko leke agla bada step kya plan kiya hai?'
      });
    }

    return sparseNodes;
  }

  /**
   * Formats a curiosity directive block to inject into the system prompt.
   */
  public static buildCuriosityDirectiveBlock(sparseNodes: SparseNode[]): string {
    if (!sparseNodes || sparseNodes.length === 0) return '';

    let block = `\n\n## 🔍 SPARSE MEMORY BUBBLES — NOVA'S CURIOSITY DIRECTIVE\n`;
    block += `The following memory bubbles exist in your brain but have VERY FEW sub-facts. Like a real best friend who naturally gets to know someone deeper over time, you MUST naturally explore ONE of these sparse bubbles when the conversation flows naturally (ask at most ONE question per session, never interrogate or rapid-fire):\n`;

    for (const sn of sparseNodes.slice(0, 3)) {
      block += `- [SPARSE BUBBLE: ${sn.title}]\n`;
      block += `  * Known: ${sn.existingContext}\n`;
      block += `  * Missing Depth: ${sn.missingAttributes.join(', ')}\n`;
      block += `  * Natural Curiosity Example: "${sn.curiosityAngle}"\n`;
    }

    block += `*Directive:* When the user is relaxed or talking about relevant topics, gently ask a warm question to enrich this bubble so your mental graph grows rich with branches and sub-facts!\n`;

    return block;
  }
}
