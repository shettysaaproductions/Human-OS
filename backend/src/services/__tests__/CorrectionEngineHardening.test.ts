import { TurnAnalyzer } from '../TurnAnalyzer';
import { ChatMessageInput } from '../../routes/chat';

describe('CorrectionEngineHardening', () => {
  const runTest = (message: string, context?: any) => {
    const input: ChatMessageInput[] = [{
      message,
      sender: 'user',
      client_message_id: 'test-uuid-1'
    }];
    return TurnAnalyzer.analyze(input, context);
  };

  it('A. "Actually my favourite color is blue"', () => {
    const res = runTest('Actually my favourite color is blue');
    expect(res.hasCorrections).toBe(true);
    const unit = res.units.find(u => u.type === 'correction');
    expect(unit).toBeDefined();
    expect(unit?.factKey).toBe('favourite_color');
    expect(unit?.factValue).toBe('blue');
  });

  it('B. "Ek correction hai mera favourite color blue hai"', () => {
    const res = runTest('Ek correction hai mera favourite color blue hai');
    expect(res.hasCorrections).toBe(true);
    const unit = res.units.find(u => u.type === 'correction');
    expect(unit?.factKey).toBe('favourite_color');
    expect(unit?.factValue).toBe('blue');
  });

  it('C. "Nahi, favourite color blue hai"', () => {
    const res = runTest('Nahi, favourite color blue hai');
    expect(res.hasCorrections).toBe(true);
    const unit = res.units.find(u => u.type === 'correction');
    expect(unit?.factKey).toBe('favourite_color');
    expect(unit?.factValue).toBe('blue');
  });

  it('D. "Galat tha, favourite color blue hai"', () => {
    const res = runTest('Galat tha, favourite color blue hai');
    expect(res.hasCorrections).toBe(true);
    const unit = res.units.find(u => u.type === 'correction');
    expect(unit?.factKey).toBe('favourite_color');
    expect(unit?.factValue).toBe('blue');
  });

  it('F. "Correction: favourite color blue"', () => {
    const res = runTest('Correction: favourite color blue');
    expect(res.hasCorrections).toBe(true);
    const unit = res.units.find(u => u.type === 'correction');
    expect(unit?.factKey).toBe('favourite_color');
    expect(unit?.factValue).toBe('blue');
  });

  it('G. same concept retains one canonical key (favourite_colour)', () => {
    const context = {
      memories: [{ key: 'favourite_colour', value: 'red' }]
    };
    const res = runTest('Ek correction hai mera favourite color blue hai', context);
    expect(res.hasCorrections).toBe(true);
    const unit = res.units.find(u => u.type === 'correction');
    // It should map to the existing DB key
    expect(unit?.factKey).toBe('favourite_colour');
    expect(unit?.factValue).toBe('blue');
  });

  it('E. "Make that blue" with unambiguous immediate USER context', () => {
    const context = {
      recentMessages: [
        { role: 'user', content: 'Actually my favourite color is red' },
        { role: 'assistant', content: 'Got it, red.' } // Should be ignored
      ],
      memories: [{ key: 'favourite_colour', value: 'red' }]
    };
    const res = runTest('Make that blue', context);
    expect(res.hasCorrections).toBe(true);
    const unit = res.units.find(u => u.type === 'correction');
    expect(unit?.factKey).toBe('favourite_colour');
    expect(unit?.factValue).toBe('blue');
  });

  it('K. ambiguous correction performs zero mutation with no context', () => {
    const res = runTest('Make that blue');
    expect(res.hasCorrections).toBe(true); // Correction intent is detected
    const unit = res.units.find(u => u.type === 'correction');
    // But since there is no context to resolve the target, factKey is undefined
    expect(unit?.factKey).toBeUndefined();
  });

  it('O. assistant-generated text cannot provide antecedent evidence', () => {
    const context = {
      recentMessages: [
        { role: 'assistant', content: 'Actually my favourite color is red' }
      ]
    };
    const res = runTest('Make that blue', context);
    const unit = res.units.find(u => u.type === 'correction');
    expect(unit?.factKey).toBeUndefined(); // Should fail because it ignores assistant messages
  });

  it('L. correction cannot modify wife_name accidentally', () => {
    const res = runTest('Actually my favourite color is blue');
    const unit = res.units.find(u => u.type === 'correction');
    expect(unit?.factKey).not.toBe('wife_name');
  });

});
