/**
 * VoiceMode.tsx — Nova Voice Mode Overlay
 *
 * Full-screen animated overlay for voice conversation with Nova.
 * Features:
 *   - Animated waveform/orb that reacts to voice state
 *   - Real-time transcript display (scrolling)
 *   - Mute toggle
 *   - Voice picker (Kore, Aoede, Charon, Fenrir, Puck)
 *   - Swipe down or tap × to exit
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVoiceSession, VoiceSessionState } from '../hooks/useVoiceSession';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ── Orb colours per state ─────────────────────────────────────────────────────
const STATE_COLORS: Record<VoiceSessionState, string[]> = {
  idle:        ['#1a1a2e', '#16213e'],
  connecting:  ['#0f3460', '#533483'],
  listening:   ['#6C63FF', '#4834D4'],
  processing:  ['#F7971E', '#FFD200'],
  speaking:    ['#11998e', '#38ef7d'],
  error:       ['#FF416C', '#FF4B2B'],
};

const STATE_LABELS: Record<VoiceSessionState, string> = {
  idle:        'Tap to start talking',
  connecting:  'Connecting to Nova...',
  listening:   'Listening...',
  processing:  'Nova is thinking...',
  speaking:    'Nova is speaking...',
  error:       'Connection issue',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface VoiceModeProps {
  visible: boolean;
  onClose: () => void;
  language?: 'en' | 'hi' | 'auto';
}

export function VoiceMode({ visible, onClose, language = 'auto' }: VoiceModeProps) {
  const insets = useSafeAreaInsets();
  const {
    state,
    transcript,
    availableVoices,
    selectedVoice,
    errorMessage,
    startSession,
    prefetchSession,
    prefetchState,
    endSession,
    mute,
    unmute,
    isMuted,
    selectVoice,
    isNativeAvailable,
  } = useVoiceSession();

  // Animation refs
  const orbScale   = useRef(new Animated.Value(1)).current;
  const orbOpacity = useRef(new Animated.Value(0.8)).current;
  const wave1      = useRef(new Animated.Value(1)).current;
  const wave2      = useRef(new Animated.Value(1)).current;
  const wave3      = useRef(new Animated.Value(1)).current;
  const slideUp    = useRef(new Animated.Value(SCREEN_H)).current;

  const transcriptRef = useRef<ScrollView>(null);
  const [showVoicePicker, setShowVoicePicker] = useState(false);

  // Slide in on open + prefetch session as soon as screen opens
  useEffect(() => {
    if (visible) {
      Animated.spring(slideUp, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 120,
      }).start();
      // Kick off backend prefetch immediately — warms up Render + caches session
      prefetchSession();
    } else {
      Animated.timing(slideUp, {
        toValue: SCREEN_H,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  // Orb pulse animations per state
  useEffect(() => {
    let anim: Animated.CompositeAnimation | undefined;

    if (state === 'listening') {
      anim = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(orbScale,   { toValue: 1.08, duration: 800, useNativeDriver: true }),
            Animated.timing(orbOpacity, { toValue: 1,    duration: 800, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(orbScale,   { toValue: 0.95, duration: 800, useNativeDriver: true }),
            Animated.timing(orbOpacity, { toValue: 0.75, duration: 800, useNativeDriver: true }),
          ]),
        ])
      );
    } else if (state === 'speaking') {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(orbScale, { toValue: 1.15, duration: 350, useNativeDriver: true }),
          Animated.timing(orbScale, { toValue: 0.92, duration: 350, useNativeDriver: true }),
        ])
      );
    } else if (state === 'processing') {
      anim = Animated.loop(
        Animated.timing(orbScale, { toValue: 1.05, duration: 1200, useNativeDriver: true })
      );
    } else {
      orbScale.setValue(1);
      orbOpacity.setValue(0.8);
    }

    anim?.start();
    return () => anim?.stop();
  }, [state]);

  // Wave ring animations (decorative concentric rings)
  useEffect(() => {
    if (state === 'listening' || state === 'speaking') {
      const makeWave = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, { toValue: 1.4, duration: 1200, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 1,   duration: 600,  useNativeDriver: true }),
          ])
        );
      const waves = [makeWave(wave1, 0), makeWave(wave2, 400), makeWave(wave3, 800)];
      waves.forEach(w => w.start());
      return () => waves.forEach(w => w.stop());
    } else {
      wave1.setValue(1); wave2.setValue(1); wave3.setValue(1);
    }
  }, [state]);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcript.length > 0) {
      setTimeout(() => transcriptRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [transcript]);

  // Do NOT auto-start — user taps the orb to connect.
  // Prefetch is already running from the visible useEffect above.

  const handleClose = async () => {
    await endSession();
    onClose();
  };

  const colors = STATE_COLORS[state];
  const label = state === 'idle'
    ? prefetchState === 'loading' ? 'Getting Nova ready...'
    : prefetchState === 'ready'   ? 'Tap to talk with Nova ✓'
    : prefetchState === 'error'   ? 'Tap to connect (may take a moment)'
    : 'Tap to start talking'
    : STATE_LABELS[state];

  // If native audio isn't available in this build, show an informative screen
  if (!isNativeAvailable) {
    return (
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10, 8, 20, 0.97)', justifyContent: 'center', alignItems: 'center', padding: 32, zIndex: 1000 }]}>
          <Text style={{ fontSize: 56, marginBottom: 24 }}>🎙️</Text>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>Voice Mode Coming Soon</Text>
          <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>
            {'Nova Voice requires the latest native app build. Please download the latest APK from the Play Store or Expo, then restart the app.'}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={{ backgroundColor: '#8B5CF6', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14 }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Got It</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.container, { transform: [{ translateY: slideUp }] }]}>

        {/* Dark background overlay */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10, 8, 20, 0.96)' }]} />
        <View style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Nova Voice</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Orb + Wave Rings */}
          <View style={styles.orbContainer}>
            {/* Wave rings */}
            {[wave1, wave2, wave3].map((w, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.waveRing,
                  {
                    width: 200 + i * 30,
                    height: 200 + i * 30,
                    borderRadius: (200 + i * 30) / 2,
                    borderColor: colors[0] + '40',
                    transform: [{ scale: w }],
                    opacity: state === 'listening' || state === 'speaking' ? 0.5 - i * 0.1 : 0,
                  },
                ]}
              />
            ))}

            {/* Main orb — tap to start/end session */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                if (state === 'idle' || state === 'error') {
                  startSession(selectedVoice);
                } else if (state === 'listening' || state === 'speaking' || state === 'processing') {
                  handleClose();
                }
              }}
            >
              <Animated.View
                style={[
                  styles.orb,
                  {
                    backgroundColor: colors[0],
                    shadowColor: colors[0],
                    transform: [{ scale: orbScale }],
                    opacity: orbOpacity,
                  },
                ]}
              >
                {state === 'connecting' ? (
                  <ActivityIndicator size="large" color="#fff" />
                ) : (
                  <Text style={styles.orbIcon}>
                    {state === 'error' ? '⚠️' :
                     state === 'idle' ? '🎙️' :
                     isMuted ? '🔇' :
                     state === 'speaking' ? '🔊' : '🎙️'}
                  </Text>
                )}
              </Animated.View>
            </TouchableOpacity>
          </View>

          {/* State Label */}
          <Text style={styles.stateLabel}>{isMuted ? 'Muted — tap to unmute' : label}</Text>
          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          {/* Transcript */}
          <ScrollView
            ref={transcriptRef}
            style={styles.transcript}
            contentContainerStyle={styles.transcriptContent}
            showsVerticalScrollIndicator={false}
          >
            {transcript.length === 0 && state === 'listening' ? (
              <Text style={styles.transcriptPlaceholder}>Start speaking — Nova is listening...</Text>
            ) : null}
            {transcript.map((entry, idx) => (
              <View
                key={idx}
                style={[
                  styles.transcriptBubble,
                  entry.role === 'nova' ? styles.novaBubble : styles.userBubble,
                ]}
              >
                <Text style={styles.transcriptRole}>{entry.role === 'nova' ? 'Nova' : 'You'}</Text>
                <Text style={styles.transcriptText}>{entry.text}</Text>
              </View>
            ))}
          </ScrollView>

          {/* Controls */}
          <View style={styles.controls}>

            {/* Voice Picker Button */}
            <TouchableOpacity
              style={styles.controlBtn}
              onPress={() => setShowVoicePicker(true)}
            >
              <Text style={styles.controlBtnIcon}>🎤</Text>
              <Text style={styles.controlBtnLabel}>{selectedVoice}</Text>
            </TouchableOpacity>

            {/* Mute Toggle */}
            <TouchableOpacity
              style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
              onPress={isMuted ? unmute : mute}
            >
              <Text style={styles.controlBtnIcon}>{isMuted ? '🔇' : '🎙️'}</Text>
              <Text style={styles.controlBtnLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
            </TouchableOpacity>

            {/* End Session */}
            <TouchableOpacity style={[styles.controlBtn, styles.endBtn]} onPress={handleClose}>
              <Text style={styles.controlBtnIcon}>📴</Text>
              <Text style={styles.controlBtnLabel}>End</Text>
            </TouchableOpacity>
          </View>

        </View>

        {/* Voice Picker Modal */}
        <Modal visible={showVoicePicker} transparent animationType="slide">
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerSheet}>
              <Text style={styles.pickerTitle}>Choose Nova's Voice</Text>
              <FlatList
                data={availableVoices.length > 0 ? availableVoices : [
                  { id: 'Kore',   label: 'Kore',   description: 'Warm & expressive (great for Hindi)' },
                  { id: 'Aoede',  label: 'Aoede',  description: 'Smooth & natural (great for English)' },
                  { id: 'Charon', label: 'Charon', description: 'Deep & calm' },
                  { id: 'Fenrir', label: 'Fenrir', description: 'Clear & precise' },
                  { id: 'Puck',   label: 'Puck',   description: 'Bright & energetic' },
                ]}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.voiceOption, selectedVoice === item.id && styles.voiceOptionSelected]}
                    onPress={() => {
                      selectVoice(item.id);
                      setShowVoicePicker(false);
                    }}
                  >
                    <Text style={styles.voiceOptionLabel}>{item.label}</Text>
                    <Text style={styles.voiceOptionDesc}>{item.description}</Text>
                    {selectedVoice === item.id && <Text style={styles.voiceOptionCheck}>✓</Text>}
                  </TouchableOpacity>
                )}
              />
              <TouchableOpacity style={styles.pickerClose} onPress={() => setShowVoicePicker(false)}>
                <Text style={styles.pickerCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

      </Animated.View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
  },
  overlay: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  orbContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 280,
    marginVertical: 8,
  },
  waveRing: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  orb: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 20,
  },
  orbIcon: {
    fontSize: 52,
  },
  stateLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '500',
    marginBottom: 4,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  transcript: {
    flex: 1,
    marginVertical: 12,
  },
  transcriptContent: {
    paddingVertical: 8,
    gap: 8,
  },
  transcriptPlaceholder: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 20,
  },
  transcriptBubble: {
    borderRadius: 16,
    padding: 12,
    maxWidth: '85%',
  },
  novaBubble: {
    backgroundColor: 'rgba(108,99,255,0.3)',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  transcriptRole: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  transcriptText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 21,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    paddingTop: 8,
  },
  controlBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 12,
    minWidth: 80,
    gap: 4,
  },
  controlBtnActive: {
    backgroundColor: 'rgba(255,107,107,0.25)',
  },
  endBtn: {
    backgroundColor: 'rgba(255,65,108,0.3)',
  },
  controlBtnIcon: {
    fontSize: 24,
  },
  controlBtnLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '600',
  },
  // Voice picker
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  pickerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  voiceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  voiceOptionSelected: {
    backgroundColor: 'rgba(108,99,255,0.3)',
    borderWidth: 1,
    borderColor: '#6C63FF',
  },
  voiceOptionLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  voiceOptionDesc: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    flex: 2,
  },
  voiceOptionCheck: {
    color: '#6C63FF',
    fontSize: 18,
    fontWeight: '700',
  },
  pickerClose: {
    marginTop: 8,
    padding: 16,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
  },
  pickerCloseText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 16,
    fontWeight: '600',
  },
});
