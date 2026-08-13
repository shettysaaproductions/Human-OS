import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';

const THOUGHT_STEPS = [
  { icon: '🧠', text: "Nova is thinking..." },
  { icon: '🌐', text: "Analyzing context & presence..." },
  { icon: '🧩', text: "Checking memory & life graph..." },
  { icon: '💭', text: "Formulating response..." },
];

export const LiveThinkingIndicator: React.FC = () => {
  const [stepIndex, setStepIndex] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const dot1Anim = useRef(new Animated.Value(0.3)).current;
  const dot2Anim = useRef(new Animated.Value(0.3)).current;
  const dot3Anim = useRef(new Animated.Value(0.3)).current;

  // Cycle thinking phrases
  useEffect(() => {
    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();

      setTimeout(() => {
        setStepIndex((prev) => (prev + 1) % THOUGHT_STEPS.length);
      }, 250);
    }, 2400);

    return () => clearInterval(interval);
  }, [fadeAnim]);

  // Pulse animation for the brain icon
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  // Pulsing dots animation
  useEffect(() => {
    const animateDot = (anim: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.3,
            duration: 400,
            useNativeDriver: true,
          }),
        ])
      );
    };

    const d1 = animateDot(dot1Anim, 0);
    const d2 = animateDot(dot2Anim, 200);
    const d3 = animateDot(dot3Anim, 400);

    d1.start();
    d2.start();
    d3.start();

    return () => {
      d1.stop();
      d2.stop();
      d3.stop();
    };
  }, [dot1Anim, dot2Anim, dot3Anim]);

  const currentStep = THOUGHT_STEPS[stepIndex];

  return (
    <View style={styles.container}>
      <View style={styles.bubble}>
        <Animated.Text style={[styles.icon, { transform: [{ scale: pulseAnim }] }]}>
          {currentStep.icon}
        </Animated.Text>
        
        <Animated.View style={[styles.textWrapper, { opacity: fadeAnim }]}>
          <Text style={styles.thinkingText}>{currentStep.text}</Text>
        </Animated.View>

        <View style={styles.dotsRow}>
          <Animated.View style={[styles.dot, { opacity: dot1Anim }]} />
          <Animated.View style={[styles.dot, { opacity: dot2Anim }]} />
          <Animated.View style={[styles.dot, { opacity: dot3Anim }]} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    marginLeft: 4,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  icon: {
    fontSize: 14,
  },
  textWrapper: {
    minWidth: 160,
  },
  thinkingText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '500',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 2,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#8B5CF6',
  },
});
