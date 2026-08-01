export class MessageFormatter {
  
  // Split long messages into multiple bubbles (like WhatsApp)
  static splitIntoBubbles(text: string, maxLength: number = 150): string[] {
    if (text.length <= maxLength) return [text];
    
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const bubbles: string[] = [];
    let currentBubble = '';
    
    for (const sentence of sentences) {
      if ((currentBubble + sentence).length > maxLength && currentBubble.length > 0) {
        bubbles.push(currentBubble.trim());
        currentBubble = sentence;
      } else {
        currentBubble += sentence;
      }
    }
    
    if (currentBubble.trim()) bubbles.push(currentBubble.trim());
    return bubbles.length > 0 ? bubbles : [text];
  }

  // Add emoji based on emotional context
  static addEmoji(text: string, emotion: string): string {
    const emojiMap: Record<string, string[]> = {
      joy: ['😊', '✨', '🎉', '💫'],
      concern: ['🤗', '💙', '🌟'],
      curiosity: ['🤔', '💭', '✨'],
      excitement: ['🎉', '✨', '🚀', '💫'],
      comfort: ['🤗', '💙', '🌸'],
      playful: ['😄', '✨', '🎈'],
    };
    
    const emojis = emojiMap[emotion] || ['✨'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    
    // Add emoji at natural break points (not at start of every message)
    if (text.length > 50 && !text.includes('?')) {
      return `${text} ${randomEmoji}`;
    }
    return text;
  }

  // Merge related short messages
  static shouldMergeWithPrevious(currentMsg: string, previousMsg: string, timeGapMs: number): boolean {
    if (timeGapMs > 30000) return false; // Don't merge if > 30s gap
    if (currentMsg.length > 100) return false; // Don't merge long messages
    if (previousMsg.length > 200) return false;
    return true;
  }
}
