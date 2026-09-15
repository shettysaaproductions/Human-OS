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

  // Call duration timer (WhatsApp style)
  const [callDuration, setCallDuration] = useState(0);
  useEffect(() => {
    let timer: any;
    if (state === 'listening' || state === 'speaking' || state === 'processing') {
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(timer);
  }, [state]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Auto-connect when modal opens
  useEffect(() => {
    if (visible && (state === 'idle' || state === 'error')) {
      const timer = setTimeout(() => {
        startSession(selectedVoice);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleClose = async () => {
    await endSession();
    onClose();
  };

  const colors = STATE_COLORS[state];

  // Latest conversation turns for live caption preview
  const latestNova = [...transcript].reverse().find((t) => t.role === 'nova');
  const latestUser = [...transcript].reverse().find((t) => t.role === 'user');

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

        {/* WhatsApp dark background overlay */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0B141B' }]} />
        <View style={[styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>

          {/* Top WhatsApp-style Call Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose} style={styles.minimizeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.minimizeBtnText}>↓</Text>
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.callTypeTitle}>Nova Voice Call</Text>
              <View style={styles.encryptionRow}>
                <Text style={styles.encryptionIcon}>🔒</Text>
                <Text style={styles.encryptionText}>End-to-end living brain</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => setShowVoicePicker(true)} style={styles.voicePickerHeaderBtn}>
              <Text style={{ fontSize: 18 }}>🗣️</Text>
            </TouchableOpacity>
          </View>

          {/* Contact Identity & Call Status */}
          <View style={styles.identitySection}>
            <Text style={styles.contactName}>Nova</Text>
            <Text style={styles.callStatusText}>
              {state === 'connecting' ? 'Calling...' :
               state === 'listening' ? formatDuration(callDuration) :
               state === 'speaking' ? `Nova speaking • ${formatDuration(callDuration)}` :
               state === 'processing' ? 'Thinking...' :
               state === 'error' ? (errorMessage || 'Connection issue') :
               'Tap to start call'}
            </Text>
          </View>

          {/* Glowing Orb & Concentric Pulse Rings */}
          <View style={styles.orbContainer}>
            {[wave1, wave2, wave3].map((w, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.waveRing,
                  {
                    width: 220 + i * 40,
                    height: 220 + i * 40,
                    borderRadius: (220 + i * 40) / 2,
                    borderColor: colors[0] + '40',
                    transform: [{ scale: w }],
                    opacity: state === 'listening' || state === 'speaking' ? 0.45 - i * 0.1 : 0,
                  },
                ]}
              />
            ))}

            <TouchableOpacity
              activeOpacity={0.88}
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
                  <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={styles.orbLetter}>N</Text>
                    <Text style={styles.orbSubStatus}>
                      {isMuted ? '🔇' : state === 'speaking' ? '🔊' : '🎙️'}
                    </Text>
                  </View>
                )}
              </Animated.View>
            </TouchableOpacity>
          </View>

          {/* Live Subtitle Transcript Area (WhatsApp Live Captions Style) */}
          <View style={styles.liveCaptionsContainer}>
            <ScrollView
              ref={transcriptRef}
              style={styles.transcriptScroll}
              contentContainerStyle={styles.transcriptContent}
              showsVerticalScrollIndicator={false}
            >
              {transcript.length === 0 && state === 'listening' ? (
                <Text style={styles.transcriptPlaceholder}>Go ahead, Nova is listening to you...</Text>
              ) : null}
              {transcript.slice(-4).map((entry, idx) => (
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
          </View>

          {/* WhatsApp-style Bottom Action Dock */}
          <View style={styles.bottomDock}>
            {/* Mute Mic */}
            <TouchableOpacity
              style={[styles.dockBtn, isMuted && styles.dockBtnActive]}
              onPress={isMuted ? unmute : mute}
              activeOpacity={0.7}
            >
              <Text style={styles.dockIcon}>{isMuted ? '🔇' : '🎙️'}</Text>
              <Text style={styles.dockLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
            </TouchableOpacity>

            {/* End Call (Big Red Circle) */}
            <TouchableOpacity
              style={styles.endCallCircleBtn}
              onPress={handleClose}
              activeOpacity={0.8}
            >
              <Text style={styles.endCallIcon}>📞</Text>
            </TouchableOpacity>

            {/* Voice Pitch / Persona */}
            <TouchableOpacity
              style={styles.dockBtn}
              onPress={() => setShowVoicePicker(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.dockIcon}>🗣️</Text>
              <Text style={styles.dockLabel}>{selectedVoice}</Text>
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
                  { id: 'Kore',   label: 'Kore',   description: 'Warm & expressive (great for Hindi/Hinglish)' },
                  { id: 'Aoede',  label: 'Aoede',  description: 'Smooth & natural (great for English)' },
                  { id: 'Charon', label: 'Charon', description: 'Deep & calm' },
                  { id: 'Fenrir', label: 'Fenrir', description: 'Clear & precise' },
                  { id: 'Puck',   label: 'Puck',   description: 'Bright & energetic' },
                ]}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => {
                  const isSelected = item.id === selectedVoice;
                  return (
                    <TouchableOpacity
                      style={[styles.voiceOption, isSelected && styles.voiceOptionSelected]}
                      onPress={() => {
                        selectVoice(item.id);
                        setShowVoicePicker(false);
                      }}
                    >
                      <Text style={styles.voiceOptionLabel}>{item.label}</Text>
                      <Text style={styles.voiceOptionDesc}>{item.description}</Text>
                      {isSelected ? <Text style={styles.voiceOptionCheck}>✓</Text> : null}
                    </TouchableOpacity>
                  );
                }}
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
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  minimizeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  minimizeBtnText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  headerCenter: {
    alignItems: 'center',
  },
  callTypeTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  encryptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  encryptionIcon: {
    fontSize: 10,
  },
  encryptionText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    letterSpacing: 0.2,
  },
  voicePickerHeaderBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identitySection: {
    alignItems: 'center',
    marginVertical: 12,
  },
  contactName: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  callStatusText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    fontWeight: '500',
  },
  orbContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 240,
    marginVertical: 10,
  },
  waveRing: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  orb: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 32,
    elevation: 20,
  },
  orbLetter: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '800',
  },
  orbSubStatus: {
    fontSize: 20,
    marginTop: 2,
  },
  liveCaptionsContainer: {
    flex: 1,
    marginVertical: 12,
    maxHeight: 180,
  },
  transcriptScroll: {
    flex: 1,
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
    marginTop: 16,
  },
  transcriptBubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '85%',
  },
  novaBubble: {
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  transcriptRole: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  transcriptText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  bottomDock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 36,
    marginHorizontal: 12,
  },
  dockBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    gap: 4,
  },
  dockBtnActive: {
    opacity: 0.7,
  },
  dockIcon: {
    fontSize: 26,
  },
  dockLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '500',
  },
  endCallCircleBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  endCallIcon: {
    fontSize: 30,
    transform: [{ rotate: '135deg' }],
  },
  // Voice picker modal
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
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
    borderRadius: 14,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  voiceOptionSelected: {
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
    borderWidth: 1,
    borderColor: '#8B5CF6',
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
    color: '#8B5CF6',
    fontSize: 18,
    fontWeight: '700',
  },
  pickerClose: {
    marginTop: 10,
    padding: 16,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
  },
  pickerCloseText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 16,
    fontWeight: '600',
  },
});
