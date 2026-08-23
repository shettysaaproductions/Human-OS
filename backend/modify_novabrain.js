const fs = require('fs');

const path = 'backend/src/services/NovaBrainService.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  `export class NovaBrainService {
  /**
   * Processes an incoming interaction and returns a conversational reply
   * along with any background tool commands to be executed.
   */
  async processInteraction(
    _userId: string,
    message: string,
    context: any // Aggregated context from Temporal, Situational, Memory engines
  ): Promise<{ reply: string; subconscious_actions: any[] }> {`,
  `export interface NormalizedMessage {
  message: string;
  client_message_id?: string;
  reply_to_id?: string;
  reply_to_content?: string;
  image_base64?: string;
}

export class NovaBrainService {
  /**
   * Processes an incoming interaction and returns a conversational reply
   * along with any background tool commands to be executed.
   */
  async processInteraction(
    _userId: string,
    messages: NormalizedMessage[],
    context: any // Aggregated context from Temporal, Situational, Memory engines
  ): Promise<{ reply: string; subconscious_actions: any[] }> {`
);

code = code.replace(
  `    const isCritical = isCriticalAction(message);
    let criticalActionSuccessContext = '';

    if (isCritical) {
      logger.info('[NOVA BRAIN] Critical action detected. Extracting intent synchronously.');
      const criticalActions = await extractCriticalAction(message);
      
      if (criticalActions.length > 0) {
        const result = await backgroundActions.processCriticalActions(
          _userId,
          context.requestId || crypto.randomUUID(),
          criticalActions,
          context.userCountry || 'IN'
        );
        
        if (result.success) {
          criticalActionSuccessContext = \`\\n[SYSTEM NOTICE: The user's requested action (Type: \${result.actionType}) was just successfully saved to the database. You can now confirm to them that it is done.]\\n\`;
        } else {
          logger.warn(\`[NOVA BRAIN] Bypassing LLM due to critical action failure: \${result.error}\`);
          const fallbackReply = \`I'm really sorry, but I ran into a system issue and couldn't save that \${result.actionType.includes('schedule') ? 'reminder' : 'action'}. Could you try again in a moment?\`;
          return { reply: fallbackReply, subconscious_actions: [] };
        }
      }
    }

    const conversationFullPrompt = [
      conversationSystemPrompt,
      context.memoryContext || '',
      context.temporalContextBlock || '',
      context.remindersContext || '',
      context.lengthInstruction || '',
      criticalActionSuccessContext,
      '\\n\\n## OUTPUT INSTRUCTION\\nOutput ONLY your conversational reply as plain text. No XML tags. No JSON. No subconscious_actions. Just what you would text the user on WhatsApp.',
    ].filter(Boolean).join('\\n');

    const conversationMessages = buildMessages(conversationFullPrompt, context.recentMessages, message);`,
  `    let isCritical = false;
    let criticalActionSuccessContext = '';

    for (const msg of messages) {
      if (isCriticalAction(msg.message)) {
        isCritical = true;
        logger.info('[NOVA BRAIN] Critical action detected. Extracting intent synchronously.');
        const criticalActions = await extractCriticalAction(msg.message);
        
        if (criticalActions.length > 0) {
          const result = await backgroundActions.processCriticalActions(
            _userId,
            context.requestId || crypto.randomUUID(),
            criticalActions,
            context.userCountry || 'IN'
          );
          
          if (result.success) {
            criticalActionSuccessContext += \`\\n[SYSTEM NOTICE: The user's requested action (Type: \${result.actionType}) for message "\${msg.message}" was successfully saved to the database. You can now confirm to them that it is done.]\\n\`;
          } else {
            logger.warn(\`[NOVA BRAIN] Bypassing LLM due to critical action failure: \${result.error}\`);
            const fallbackReply = \`I'm really sorry, but I ran into a system issue and couldn't save that \${result.actionType.includes('schedule') ? 'reminder' : 'action'}. Could you try again in a moment?\`;
            return { reply: fallbackReply, subconscious_actions: [] };
          }
        }
      }
    }

    const conversationFullPrompt = [
      conversationSystemPrompt,
      context.memoryContext || '',
      context.temporalContextBlock || '',
      context.remindersContext || '',
      context.lengthInstruction || '',
      criticalActionSuccessContext,
      '\\n\\n## OUTPUT INSTRUCTION\\nOutput ONLY your conversational reply as plain text. No XML tags. No JSON. No subconscious_actions. Just what you would text the user on WhatsApp.',
    ].filter(Boolean).join('\\n');

    const combinedUserMessage = messages.map((m, i) => messages.length > 1 ? \`USER MESSAGE \${i + 1}:\\n\${m.message}\` : m.message).join('\\n\\n');

    const conversationMessages = buildMessages(conversationFullPrompt, context.recentMessages, combinedUserMessage);`
);

code = code.replace(
  `        subconsciousQueue.add('extract_subconscious_actions', {
          userId: _userId,
          messageId: jobMessageId,
          conversationId: context.conversationId || '',
          message,
          userMessage: message,
          novaReply: reply,
          userCountry: context.userCountry || 'IN'
        });`,
  `        const fullTurnContent = messages.map(m => m.message).join(' | ');
        subconsciousQueue.add('extract_subconscious_actions', {
          userId: _userId,
          messageId: jobMessageId,
          conversationId: context.conversationId || '',
          message: fullTurnContent,
          userMessage: fullTurnContent,
          novaReply: reply,
          userCountry: context.userCountry || 'IN'
        });`
);

code = code.replace(
  `  async *streamInteraction(
    _userId: string,
    message: string,
    context: any
  ): AsyncGenerator<string, { subconscious_actions: any[] }, unknown> {`,
  `  async *streamInteraction(
    _userId: string,
    messages: NormalizedMessage[],
    context: any
  ): AsyncGenerator<string, { subconscious_actions: any[] }, unknown> {`
);

code = code.replace(
  `    const isCritical = isCriticalAction(message);
    let criticalActionSuccessContext = '';

    if (isCritical) {
      logger.info('[NOVA BRAIN] Stream: Critical action detected. Extracting intent synchronously.');
      const criticalActions = await extractCriticalAction(message);
      
      if (criticalActions.length > 0) {
        const result = await backgroundActions.processCriticalActions(
          _userId,
          context.requestId || crypto.randomUUID(),
          criticalActions,
          context.userCountry || 'IN'
        );
        
        if (result.success) {
          criticalActionSuccessContext = \`\\n[SYSTEM NOTICE: The user's requested action (Type: \${result.actionType}) was just successfully saved to the database. You can now confirm to them that it is done.]\\n\`;
        } else {
          logger.warn(\`[NOVA BRAIN] Stream: Bypassing LLM due to critical action failure: \${result.error}\`);
          const fallbackReply = \`I'm really sorry, but I ran into a system issue and couldn't save that \${result.actionType.includes('schedule') ? 'reminder' : 'action'}. Could you try again in a moment?\`;
          yield fallbackReply;
          return { subconscious_actions: [] };
        }
      }
    }

    const fullPrompt = [
      systemPrompt,
      context.memoryContext || '',
      context.temporalContextBlock || '',
      context.remindersContext || '',
      context.lengthInstruction || '',
      criticalActionSuccessContext,
      '\\n\\n## OUTPUT INSTRUCTION\\nOutput ONLY your conversational reply as plain text. No XML tags. No JSON. No subconscious_actions. Just what you would text the user on WhatsApp.',
    ].filter(Boolean).join('\\n');

    const messages = buildMessages(fullPrompt, context.recentMessages, message);

    const profile = determineUserProfile(message);`,
  `    let isCritical = false;
    let criticalActionSuccessContext = '';

    for (const msg of messages) {
      if (isCriticalAction(msg.message)) {
        isCritical = true;
        logger.info('[NOVA BRAIN] Stream: Critical action detected. Extracting intent synchronously.');
        const criticalActions = await extractCriticalAction(msg.message);
        
        if (criticalActions.length > 0) {
          const result = await backgroundActions.processCriticalActions(
            _userId,
            context.requestId || crypto.randomUUID(),
            criticalActions,
            context.userCountry || 'IN'
          );
          
          if (result.success) {
            criticalActionSuccessContext += \`\\n[SYSTEM NOTICE: The user's requested action (Type: \${result.actionType}) for message "\${msg.message}" was successfully saved to the database. You can now confirm to them that it is done.]\\n\`;
          } else {
            logger.warn(\`[NOVA BRAIN] Stream: Bypassing LLM due to critical action failure: \${result.error}\`);
            const fallbackReply = \`I'm really sorry, but I ran into a system issue and couldn't save that \${result.actionType.includes('schedule') ? 'reminder' : 'action'}. Could you try again in a moment?\`;
            yield fallbackReply;
            return { subconscious_actions: [] };
          }
        }
      }
    }

    const fullPrompt = [
      systemPrompt,
      context.memoryContext || '',
      context.temporalContextBlock || '',
      context.remindersContext || '',
      context.lengthInstruction || '',
      criticalActionSuccessContext,
      '\\n\\n## OUTPUT INSTRUCTION\\nOutput ONLY your conversational reply as plain text. No XML tags. No JSON. No subconscious_actions. Just what you would text the user on WhatsApp.',
    ].filter(Boolean).join('\\n');

    const combinedUserMessage = messages.map((m, i) => messages.length > 1 ? \`USER MESSAGE \${i + 1}:\\n\${m.message}\` : m.message).join('\\n\\n');

    const convoMessages = buildMessages(fullPrompt, context.recentMessages, combinedUserMessage);

    const profile = determineUserProfile(combinedUserMessage);`
);

code = code.replace(
  `    const responseStream = stream(profile, messages, {`,
  `    const responseStream = stream(profile, convoMessages, {`
);

code = code.replace(
  `        subconsciousQueue.add('extract_subconscious_actions', {
          userId: _userId,
          messageId: jobMessageId,
          conversationId: context.conversationId || '',
          message,
          userMessage: message,
          novaReply: replyStreamed || fallbackReply || NOVA_EMPTY_REPLY,
          userCountry: context.userCountry || 'IN'
        });`,
  `        const fullTurnContent = messages.map(m => m.message).join(' | ');
        subconsciousQueue.add('extract_subconscious_actions', {
          userId: _userId,
          messageId: jobMessageId,
          conversationId: context.conversationId || '',
          message: fullTurnContent,
          userMessage: fullTurnContent,
          novaReply: replyStreamed || fallbackReply || NOVA_EMPTY_REPLY,
          userCountry: context.userCountry || 'IN'
        });`
);

fs.writeFileSync(path, code);
console.log('Modified NovaBrainService');
