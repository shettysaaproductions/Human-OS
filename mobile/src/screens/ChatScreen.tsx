import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  View, Text, TextInput, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator,
  Pressable, ScrollView, TouchableWithoutFeedback, Animated, Dimensions, Image, Alert, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { useChatStore, Message } from '../store/useChatStore';
import { api } from '../services/api';
import { chatService } from '../services/chatService';
import { notificationService, setChatScreenActive } from '../services/notificationService';
import { presenceService } from '../services/presenceService';
import * as Notifications from 'expo-notifications';
import { ThoughtBubble } from '../components/ThoughtBubble';
import { LiveThinkingIndicator } from '../components/LiveThinkingIndicator';
import { useTheme } from '../theme/ThemeContext';
import { OfflineBanner } from '../components/EmptyState';
import NetInfo from '@react-native-community/netinfo';
import Markdown from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';
import { ScrollView as GHScrollView, Swipeable } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';

// Utility functions for WhatsApp-style formatting
const formatTime = (dateString?: string) => {
  const date = dateString ? new Date(dateString) : new Date();
  if (isNaN(date.getTime())) return '';
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const minutesStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutesStr} ${ampm}`;
};

const formatDateSeparator = (dateString?: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'TODAY';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'YESTERDAY';
  } else {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  }
};

// Silent telemetry helper
async function trackEvent(event_type: string, event_data?: object) {
  try {
    await api.post('/telemetry', { event_type, event_data, platform: Platform.OS, app_version: '0.2.5-beta' });
  } catch {}
}

// Helper to clean up raw markdown tokens for quoted reply previews
const cleanPreviewText = (text?: string): string => {
  if (!text) return '';
  return text
    .replace(/^#+\s+/gm, '') // strip markdown headings
    .replace(/^[\s]*[-*•]\s+/gm, '') // strip bullet markers
    .replace(/```[\s\S]*?```/g, '[Code]') // shorten code blocks
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/\s+/g, ' ') // collapse multi-lines
    .trim();
};

// Custom text rule to robustly handle bold text even if linebreaks break the parser, 
// or if AI forgets to close the bold tags in narrow table cells.
const customTextRule = (node: any, children: any, parent: any, styles: any) => {
  let content = node.content;
  if (!content) return <Text key={node.key} style={styles.text}>{content}</Text>;
  
  content = content.replace(/\\\*\\\*/g, '**');
  
  if (content.includes('**')) {
    const parts = content.split('**');
    return (
      <Text key={node.key} style={styles.text}>
        {parts.map((part: string, index: number) => {
          if (part.length === 0) return null;
          const isBold = index % 2 !== 0; 
          if (isBold) {
            return (
              <Text key={index} style={{ fontWeight: 'bold', color: styles.body?.color || '#000' }}>
                {part}
              </Text>
            );
          }
          return <Text key={index}>{part}</Text>;
        })}
      </Text>
    );
  }
  return <Text key={node.key} style={styles.text}>{content}</Text>;
};

// ─── Custom Markdown Table Parser ───────────────────────────────────────────
// Splits raw markdown into segments: either plain text or detected table blocks.
// This avoids relying on react-native-markdown-display's buggy table renderer.
type Segment = { type: 'markdown'; content: string } | { type: 'table'; headers: string[]; rows: string[][] };

function parseMarkdownWithTables(raw: string): Segment[] {
  const lines = raw.split('\n');
  const segments: Segment[] = [];
  let i = 0;
  let mdBuffer: string[] = [];

  const flushMd = () => {
    if (mdBuffer.length > 0) {
      segments.push({ type: 'markdown', content: mdBuffer.join('\n') });
      mdBuffer = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    // A table line is one that starts and ends with a pipe (after trim)
    const isTableLine = (l: string) => l.trim().startsWith('|') && l.trim().endsWith('|');
    const isSeparatorLine = (l: string) => /^\|[\s|:-]+\|$/.test(l.trim());

    if (isTableLine(line) && i + 1 < lines.length && isSeparatorLine(lines[i + 1])) {
      flushMd();
      // Parse header
      const headerCells = line.trim().slice(1, -1).split('|').map(c => c.trim());
      const tableRows: string[][] = [];
      i += 2; // skip header and separator
      while (i < lines.length && isTableLine(lines[i])) {
        const rowCells = lines[i].trim().slice(1, -1).split('|').map(c => c.trim());
        tableRows.push(rowCells);
        i++;
      }
      segments.push({ type: 'table', headers: headerCells, rows: tableRows });
    } else {
      mdBuffer.push(line);
      i++;
    }
  }
  flushMd();
  return segments;
}

// Renders a single cell's text content, handling **bold** markers
function CellText({ text, style }: { text: string; style: any }) {
  if (!text.includes('**')) {
    return <Text style={style}>{text}</Text>;
  }
  const parts = text.split('**');
  return (
    <Text style={style}>
      {parts.map((part, idx) =>
        idx % 2 !== 0
          ? <Text key={idx} style={[style, { fontWeight: 'bold' }]}>{part}</Text>
          : <Text key={idx}>{part}</Text>
      )}
    </Text>
  );
}

// Converts table data to plain text (tab-separated) for clipboard
function tableToPlainText(headers: string[], rows: string[][]): string {
  const headerLine = headers.join('\t');
  const rowLines = rows.map(row => row.join('\t'));
  return [headerLine, ...rowLines].join('\n');
}

// The beautiful custom table component — ChatGPT style with horizontal scroll + copy button
function CustomTable({ headers, rows, colors }: { headers: string[]; rows: string[][]; colors: any }) {
  const [copied, setCopied] = React.useState(false);
  const COL_MIN_WIDTH = 130;
  const colWidth = Math.max(COL_MIN_WIDTH, 180);
  const tableWidth = headers.length * colWidth;

  const handleCopy = async () => {
    await Clipboard.setStringAsync(tableToPlainText(headers, rows));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const scrollX = React.useRef(new Animated.Value(0)).current;
  const [widths, setWidths] = React.useState({ content: 1, view: 1 });

  const { content: cw, view: vw } = widths;
  const showScrollbar = cw > vw;
  const thumbWidth = Math.max((vw / cw) * vw, 30);
  const maxScrollX = cw - vw;
  const maxThumbX = vw - thumbWidth;
  
  const thumbTranslateX = scrollX.interpolate({
    inputRange: [0, Math.max(maxScrollX, 1)],
    outputRange: [0, Math.max(maxThumbX, 0)],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ marginVertical: 10 }}>
      {/* Copy button row above the table */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4, paddingRight: 2 }}>
        <TouchableOpacity
          onPress={handleCopy}
          activeOpacity={0.7}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 10,
            paddingVertical: 4,
            backgroundColor: copied ? 'rgba(34,197,94,0.15)' : 'rgba(139,92,246,0.12)',
            borderRadius: 6,
            borderWidth: 1,
            borderColor: copied ? 'rgba(34,197,94,0.4)' : 'rgba(139,92,246,0.3)',
          }}
        >
          <Text style={{ fontSize: 11, marginRight: 4 }}>{copied ? '✅' : '📋'}</Text>
          <Text style={{
            fontSize: 11,
            fontWeight: '700',
            color: copied ? '#22C55E' : '#8B5CF6',
          }}>
            {copied ? 'Copied!' : 'Copy table'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Horizontally scrollable table — nestedScrollEnabled fixes FlatList conflict */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
        nestedScrollEnabled={true}
        directionalLockEnabled={false}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ flexDirection: 'column' }}

        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })}
        onContentSizeChange={(w) => setWidths(prev => ({ ...prev, content: w }))}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          setWidths(prev => ({ ...prev, view: w }));
        }}
      >
        <View style={{
          width: tableWidth,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
        }}>
          {/* Header Row */}
          <View style={{ flexDirection: 'row', backgroundColor: 'rgba(139,92,246,0.12)' }}>
            {headers.map((h, ci) => (
              <View key={ci} style={{
                width: colWidth,
                borderRightWidth: ci < headers.length - 1 ? 1 : 0,
                borderRightColor: colors.border,
                borderBottomWidth: 2,
                borderBottomColor: colors.border,
                padding: 10,
              }}>
                <CellText text={h} style={{ fontWeight: 'bold', fontSize: 14, color: colors.assistantText }} />
              </View>
            ))}
          </View>
          {/* Data Rows */}
          {rows.map((row, ri) => (
            <View key={ri} style={{
              flexDirection: 'row',
              backgroundColor: ri % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.03)',
            }}>
              {headers.map((_, ci) => (
                <View key={ci} style={{
                  width: colWidth,
                  borderRightWidth: ci < headers.length - 1 ? 1 : 0,
                  borderRightColor: colors.border,
                  borderBottomWidth: ri < rows.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                  padding: 10,
                }}>
                  <CellText text={row[ci] ?? ''} style={{ fontSize: 14, color: colors.assistantText, lineHeight: 20 }} />
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Custom Table Scrollbar */}
      {showScrollbar && (
        <View style={{ height: 6, width: '100%', backgroundColor: colors.background === '#1A1A1A' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 3, marginTop: 8 }}>
          <Animated.View style={{
            height: '100%',
            width: thumbWidth,
            backgroundColor: colors.background === '#1A1A1A' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
            borderRadius: 3,
            transform: [{ translateX: thumbTranslateX }]
          }} />
        </View>
      )}
    </View>
  );
}

// Converts Nova's custom <NOVA_TABLE> format to standard markdown tables.
// Mirrors backend convertNovaTable exactly — runs on frontend as safety net.
function convertNovaTable(raw: string): string {
  return raw.replace(/<NOVA_TABLE>([\s\S]*?)<\/NOVA_TABLE>/gi, (_, tableContent: string) => {
    const lines = tableContent.split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);
    if (lines.length < 2) return tableContent;
    const headers = lines[0].split('|').map((h: string) => h.trim()).filter(Boolean);
    const separator = headers.map(() => '---');
    const mdLines = [
      '| ' + headers.join(' | ') + ' |',
      '| ' + separator.join(' | ') + ' |',
      ...lines.slice(1).map((line: string) => {
        const cells = line.split('|').map((c: string) => c.trim());
        while (cells.length < headers.length) cells.push('');
        return '| ' + cells.slice(0, headers.length).join(' | ') + ' |';
      })
    ];
    return mdLines.join('\n');
  });
}

// Cleans a single table cell — mirrors backend sanitizeTableCell exactly.
// Also converts Wikipedia Yes/No icon images to actual 'Yes' / 'No' text.
function sanitizeTableCell(cell: string): string {
  let c = cell;
  // Step 0: Convert known Yes/No icon image URLs to plain text BEFORE stripping.
  // The AI uses Wikipedia checkmark/X icons — we decode them to readable text.
  c = c.replace(/!?\s*\[[^\]]*\]\(https?:\/\/[^)]*(?:green|yes|check|tick|correct)[^)]*\)/gi, 'Yes');
  c = c.replace(/!?\s*\[[^\]]*\]\(https?:\/\/[^)]*(?:red|nope|\bno\b|x_icon|wrong|false|cross)[^)]*\)/gi, 'No');
  c = c.replace(/!?\s*\[[^\]]*\]\(https?:\/\/[^)]*(?:question|unknown|maybe|partial)[^)]*\)/gi, 'Partial');
  // Step 1. Remove remaining markdown images/links
  c = c.replace(/!?\s*\[[^\]]*\]\([^)]*\)/g, '');
  // Step 2. Remove bare URLs
  c = c.replace(/https?:\/\/\S+/g, '');
  // Step 3. Remove HTML tags including UNCLOSED (e.g. <img src=" has no closing >)
  c = c.replace(/<[a-zA-Z/][^>]*/g, '');
  c = c.replace(/>/g, ''); // stray closing >
  // Step 4. Remove all backslashes
  c = c.replace(/\\/g, '');
  // Step 5. Remove lone !
  c = c.replace(/!/g, '');
  // Step 6. Remove empty brackets and parens
  c = c.replace(/\[\s*\]/g, '').replace(/\(\s*\)/g, '');
  // Step 7. Normalize whitespace
  return c.replace(/\s+/g, ' ').trim();
}


// Client-side last-resort sanitizer — cell-by-cell approach, immune to unclosed HTML.
function sanitizeContent(raw: string): string {
  // Step 0: Convert <NOVA_TABLE> format to standard markdown (frontend safety net)
  const converted = convertNovaTable(raw);
  return converted
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('|')) {
        const parts = line.split('|');
        const sanitizedParts = parts.map(cell => sanitizeTableCell(cell));
        return '| ' + sanitizedParts.filter((_, i) => i > 0 && i < parts.length - 1).join(' | ') + ' |';
      }
      return line
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[a-zA-Z\/][^>]*>/g, '') // catches valid HTML tags safely without stripping bare '>'
        .replace(/<[a-zA-Z\/][^>]*$/g, '') // catches trailing unclosed HTML tags
        .replace(/\\\|/g, '|');
    })
    .join('\n');
}



// Top-level SmartMarkdown component that splits content into table/non-table segments
function SmartMarkdown({ content, mdStyle, mdRules, colors, onLongPress, onPress }: { content: string; mdStyle: any; mdRules: any; colors: any; onLongPress?: () => void; onPress?: () => void }) {
  const segments = useMemo(() => parseMarkdownWithTables(sanitizeContent(content)), [content]);
  return (
    <View>
      {segments.map((seg, idx) => {
        if (seg.type === 'table') {
          return <CustomTable key={idx} headers={seg.headers} rows={seg.rows} colors={colors} />;
        }
        if (seg.content.trim() === '') return null;
        return (
          <Pressable key={idx} onLongPress={onLongPress} onPress={onPress} delayLongPress={150}>
            <Markdown style={mdStyle} rules={mdRules}>
              {seg.content}
            </Markdown>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Branded Nova Loader — shown on cold start before cache hydrates ───────────
function NovaLoader() {
  const pulse = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: '#0D0D0D', alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{
        width: 72, height: 72, borderRadius: 36,
        backgroundColor: '#8B5CF6',
        alignItems: 'center', justifyContent: 'center',
        transform: [{ scale: pulse }],
        shadowColor: '#8B5CF6', shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8, shadowRadius: 24, elevation: 20,
      }}>
        <Text style={{ color: '#fff', fontSize: 32, fontWeight: 'bold' }}>N</Text>
      </Animated.View>
      <Text style={{ color: 'rgba(255,255,255,0.5)', marginTop: 24, fontSize: 14, letterSpacing: 1 }}>
        Connecting to Nova...
      </Text>
    </View>
  );
}

// ── Lifestyle Tracks for Autonomous Smart Living Companion ────────────────────
interface LifestylePrompt {
  id: string;
  category: string;
  emoji: string;
  title: string;
  description: string;
  prompt: string;
  badge: string;
  color: string;
}

const LIFESTYLE_TRACKS: LifestylePrompt[] = [
  {
    id: 'fitness',
    category: 'Fitness',
    emoji: '🏋️',
    title: 'Fitness & Health',
    description: 'Log workout, meals & health routine',
    prompt: "Let's log my workout and diet today. Keep me accountable on my fitness goals!",
    badge: 'Fitness',
    color: '#10B981',
  },
  {
    id: 'student',
    category: 'Student',
    emoji: '🎓',
    title: 'Student & Learning',
    description: 'Exam prep, study routines & concepts',
    prompt: "Help me create an exam study schedule for this week with deep work blocks.",
    badge: 'Learning',
    color: '#3B82F6',
  },
  {
    id: 'work',
    category: 'Work',
    emoji: '💼',
    title: 'Work & Productivity',
    description: 'Daily standup, priorities & sprint focus',
    prompt: "Plan my top 3 high-impact focus blocks and action items for today.",
    badge: 'Career',
    color: '#8B5CF6',
  },
  {
    id: 'pet',
    category: 'Pet Parent',
    emoji: '🐾',
    title: 'Pet Parent',
    description: 'Feeding times, walks & vet tracking',
    prompt: "Help me track my pet's feeding routine, walking times, and vet checkups.",
    badge: 'Pet Care',
    color: '#F59E0B',
  },
  {
    id: 'creative',
    category: 'Creative',
    emoji: '🎨',
    title: 'Creative & Ideas',
    description: 'Brainstorming, drafting & new angles',
    prompt: "Brainstorm 5 innovative concepts and fresh angles for my new creative project.",
    badge: 'Creative',
    color: '#EC4899',
  },
  {
    id: 'habits',
    category: 'Habits',
    emoji: '🧘',
    title: 'Habits & Mindset',
    description: 'Morning rituals & evening reflection',
    prompt: "Set up a high-energy morning routine and a quick evening reflection for my habits.",
    badge: 'Mindset',
    color: '#6366F1',
  },
];

const QUICK_ACTION_CHIPS = [
  { id: 'remind', icon: '⏰', label: 'Remind', prefix: 'Remind me to ' },
  { id: 'goal', icon: '🎯', label: 'Goal', prefix: 'My goal is: ' },
  { id: 'workout', icon: '💪', label: 'Workout', prefix: 'Log workout / nutrition: ' },
  { id: 'study', icon: '📚', label: 'Study', prefix: 'Explain simply & quiz me on: ' },
  { id: 'work', icon: '💼', label: 'Work', prefix: 'Action items & plan for: ' },
  { id: 'habit', icon: '🧘', label: 'Habit', prefix: 'Track habit / streak: ' },
  { id: 'finance', icon: '💰', label: 'Finance', prefix: 'Log expense / budget: ' },
  { id: 'pet', icon: '🐾', label: 'Pet Care', prefix: 'Log pet routine / symptom: ' },
  { id: 'creative', icon: '✨', label: 'Idea', prefix: 'Brainstorm 5 creative ideas for: ' },
  { id: 'routine', icon: '🌿', label: 'Routine', prefix: 'My routine today is: ' },
  { id: 'note', icon: '📝', label: 'Note', prefix: 'Note: ' },
  { id: 'brain', icon: '🧠', label: 'Brain Galaxy', isNavigation: true },
];

function LifestyleOnboardingHub({
  colors,
  onSelectPrompt,
  onCustomize,
}: {
  colors: any;
  onSelectPrompt: (text: string) => void;
  onCustomize: (text: string) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const categories = ['All', 'Fitness', 'Student', 'Work', 'Pet Parent', 'Creative', 'Habits'];

  const filtered = selectedCategory === 'All'
    ? LIFESTYLE_TRACKS
    : LIFESTYLE_TRACKS.filter(t => t.category === selectedCategory);

  return (
    <View style={[s.lifestyleHubContainer, { transform: [{ scaleY: -1 }] }]}>
      {/* Hero Avatar & Mindset */}
      <View style={s.lifestyleHero}>
        <View style={s.lifestyleAvatarOrb}>
          <Text style={s.lifestyleAvatarText}>N</Text>
        </View>
        <Text style={[s.lifestyleTitle, { color: colors.textPrimary }]}>Meet Nova</Text>
        <Text style={[s.lifestyleSubtitle, { color: colors.textSecondary }]}>
          Your autonomous living companion • Connected to memory & cognitive mind
        </Text>
        <View style={s.lifestyleStatusPill}>
          <View style={s.onlineDotPulse} />
          <Text style={s.lifestyleStatusText}>Ready to empower your lifestyle</Text>
        </View>
      </View>

      {/* Category Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled={true}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.categoryScrollContent}
        style={s.categoryScroll}
      >
        {categories.map(cat => {
          const isActive = selectedCategory === cat;
          return (
            <TouchableOpacity
              key={cat}
              style={[
                s.catPill,
                { borderColor: isActive ? '#8B5CF6' : colors.border },
                isActive && { backgroundColor: 'rgba(139, 92, 246, 0.2)' }
              ]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text
                style={[
                  s.catPillText,
                  { color: isActive ? '#A78BFA' : colors.textSecondary }
                ]}
              >
                {cat}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Lifestyle Cards */}
      <View style={s.tracksGrid}>
        {filtered.map(track => (
          <View
            key={track.id}
            style={[
              s.trackCard,
              { backgroundColor: 'rgba(255, 255, 255, 0.03)', borderColor: colors.border }
            ]}
          >
            <View style={s.trackCardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 20 }}>{track.emoji}</Text>
                <Text style={[s.trackTitle, { color: colors.textPrimary }]}>{track.title}</Text>
              </View>
              <View style={[s.trackBadge, { backgroundColor: `${track.color}20`, borderColor: `${track.color}40` }]}>
                <Text style={[s.trackBadgeText, { color: track.color }]}>{track.badge}</Text>
              </View>
            </View>

            <Text style={[s.trackDesc, { color: colors.textSecondary }]}>
              {track.description}
            </Text>

            <View style={s.promptBox}>
              <Text style={s.promptPreview} numberOfLines={2}>
                "{track.prompt}"
              </Text>
            </View>

            <View style={s.trackActionsRow}>
              <TouchableOpacity
                style={[s.trackActionBtn, { backgroundColor: '#8B5CF6' }]}
                onPress={() => onSelectPrompt(track.prompt)}
                activeOpacity={0.7}
              >
                <Text style={s.trackActionBtnText}>Send Now ↑</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.trackCustomizeBtn, { borderColor: colors.border }]}
                onPress={() => onCustomize(track.prompt)}
                activeOpacity={0.7}
              >
                <Text style={[s.trackCustomizeBtnText, { color: colors.textSecondary }]}>Edit ✏️</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function SwipeableBubble({ item, children, onReply }: { item: Message, children: React.ReactNode, onReply: (msg: Message) => void }) {
  const swipeRef = useRef<any>(null);
  return (
    <Swipeable
      ref={swipeRef}
      renderLeftActions={() => (
        <View style={{ justifyContent: 'center', paddingLeft: 16, width: 60 }}>
          <Text style={{ fontSize: 24, transform: [{ scaleX: -1 }] }}>↩️</Text>
        </View>
      )}
      onSwipeableOpen={() => {
        onReply(item);
        setTimeout(() => swipeRef.current?.close(), 50);
      }}
      overshootLeft={false}
      friction={2}
    >
      {children}
    </Swipeable>
  );
}

export function ChatScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { messages, isTyping, isHydrated, hydrateMessages, sendMessage, abortGeneration, retryMessage, diagnostics, developerMode, loadOlderMessages, isLoadingMore, hasMoreMessages, checkProactiveMessages, replyingTo, setReplyingTo, updateMessageReaction, switchMessageVersion, regenerateBranch } = useChatStore();
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);
  const [inputText, setInputText] = useState('');
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [versionModalMessage, setVersionModalMessage] = useState<Message | null>(null);
  const [fullScreenImageUri, setFullScreenImageUri] = useState<string | null>(null);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copyToastText, setCopyToastText] = useState<string | null>(null);
  const [newMessagesWhileScrolled, setNewMessagesWhileScrolled] = useState(0);
  const lastSendTimestampRef = useRef(0);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const [mainWidths, setMainWidths] = React.useState({ content: 1, view: 1 });
  const mainScrollY = React.useRef(new Animated.Value(0)).current;
  const [selectedImage, setSelectedImage] = useState<{ uri: string, base64: string } | null>(null);
  const isFocused = useIsFocused();
  const [isOffline, setIsOffline] = useState(false);

  const isSelectionMode = selectedMessageIds.length > 0;

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCopyToast = useCallback((msg: string = 'Copied to clipboard') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setCopyToastText(msg);
    toastTimerRef.current = setTimeout(() => {
      setCopyToastText(null);
      toastTimerRef.current = null;
    }, 2200);
  }, []);

  const displayedMessages = useMemo(() => {
    if (!isSearchActive || !searchQuery.trim()) {
      return reversedMessages;
    }
    const q = searchQuery.toLowerCase().trim();
    return reversedMessages.filter(m => m.content && m.content.toLowerCase().includes(q));
  }, [reversedMessages, isSearchActive, searchQuery]);
  
  const toggleSelectMessage = useCallback((id: string) => {
    setSelectedMessageIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(item => item !== id);
      } else {
        return [...prev, id];
      }
    });
  }, []);
  const didTrackOpen = useRef(false);
  const isNearBottomRef = useRef(true);
  const isInitialScrollRef = useRef(true);
  const currentOffsetRef = useRef(0);
  
  const [showScrollDown, setShowScrollDown] = useState(false);
  const showScrollDownRef = useRef(false);

  const handleScroll = useRef(
    Animated.event(
      [{ nativeEvent: { contentOffset: { y: mainScrollY } } }],
      {
        useNativeDriver: false,
        listener: (e: any) => {
          presenceService.onUserActivity();
          const y = e.nativeEvent?.contentOffset?.y ?? 0;
          currentOffsetRef.current = y;
          isNearBottomRef.current = y < 100;
          if (y < 100) {
            setNewMessagesWhileScrolled(0);
          }
          const shouldShow = y > 250;
          if (shouldShow !== showScrollDownRef.current) {
            showScrollDownRef.current = shouldShow;
            setShowScrollDown(shouldShow);
          }
        }
      }
    )
  ).current;

  const logEvent = (eventName: string, explicitOffset?: number) => {
    const offset = explicitOffset !== undefined ? explicitOffset : currentOffsetRef.current;
    console.log(`[DIAGNOSTIC] ${new Date().toISOString()} | ${eventName} | messages.length: ${messages.length} | contentOffset: ${offset}`);
  };

  useEffect(() => {
    logEvent('MESSAGES_COUNT');
    if (!isNearBottomRef.current && messages.length > 0) {
      setNewMessagesWhileScrolled(prev => prev + 1);
    }
  }, [messages.length]);

  useEffect(() => {
    if (isHydrated) {
      logEvent('HYDRATION_COMPLETE');
    }
  }, [isHydrated]);

  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: !isSelectionMode,
    });
  }, [navigation, isSelectionMode]);

  useEffect(() => {
    presenceService.onChatOpen();
  }, []);

  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(!(state.isConnected && state.isInternetReachable !== false));
    });
    return () => unsub();
  }, []);

  const hasRenderedList = useRef(false);
  if (!hasRenderedList.current && isHydrated) {
    hasRenderedList.current = true;
    logEvent('FLATLIST_FIRST_RENDER');
  }


  
  const [stickyDate, setStickyDate] = useState<string | null>(null);

  // Diagnostics — dev mode only
  useEffect(() => {
    if (developerMode && messages.length > 0) {
      console.log('Messages stored in Zustand:', messages.length);
      console.log('Oldest message:', messages[0]?.timestamp);
      console.log('Newest message:', messages[messages.length - 1]?.timestamp);
    }
  }, [developerMode, messages.length]);
  useEffect(() => {
    logEvent('COMPONENT_MOUNT');
    hydrateMessages();

    // Read receipt: opening the chat means Nova's pending messages are now seen.
    // Fires the seen-signal so Nova's situation brief reflects "read" (not left-on-read).
    chatService.markMessagesRead();

    // Presence heartbeat: ping online every 30s while on chat screen.
    // Fixes stale presence contradiction ("AWAY" + "ACTIVE_CHATTING" at the same time).
    chatService.updatePresence('online');
    const presenceHeartbeat = setInterval(() => {
      chatService.updatePresence('online');
    }, 30_000);

    // Suppress push notification banners while user is on chat screen (WhatsApp-style)
    setChatScreenActive(true);

    if (!didTrackOpen.current) {
      didTrackOpen.current = true;
      trackEvent('app_open');
    }

    // ── Clear notification tray when chat is opened (WhatsApp-style) ────────
    const clearNotifications = () => {
      Notifications.dismissAllNotificationsAsync().catch(() => {});
      Notifications.setBadgeCountAsync(0).catch(() => {});
    };
    clearNotifications();

    // ── Push notification → immediate message fetch ──────────────────────────
    notificationService.setOnNovaReplyCallback(() => {
      // Small delay so the DB connection can re-hydrate if the OS fully closed the app
      setTimeout(() => {
        checkProactiveMessages();
      }, 500);
    });

    // ── AppState listener: fallback refresh + queue rescue when app returns to foreground ──
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        clearNotifications(); // Clear tray every time user comes back to chat
        checkProactiveMessages();
        // Read receipt: user came back and is viewing the chat — mark Nova's messages seen
        chatService.markMessagesRead();
        // Kick queue in case it got stuck while app was backgrounded
        useChatStore.getState().processQueue();
        // Update presence when app comes to foreground
        chatService.updatePresence('online');
      } else if (nextState === 'background') {
        chatService.updatePresence('away');
      }
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
      clearInterval(presenceHeartbeat);
      chatService.updatePresence('away');
      // Restore notification banners when user leaves chat screen
      setChatScreenActive(false);
      // Clear the callback on unmount to avoid stale closures
      notificationService.setOnNovaReplyCallback(() => {});
    };
  }, []);

  // ── Focus tracking: set the banner-suppress flag from the actual screen focus.
  // Without this, pushing a stack screen (Settings/Brain/...) kept ChatScreen mounted
  // and _isChatScreenActive true, so every notification banner/sound was suppressed
  // on those screens. Now pushing a screen re-enables banners, popping back re-suppresses.
  useEffect(() => {
    setChatScreenActive(isFocused);
  }, [isFocused]);

  const handleSend = useCallback((overrideText?: string) => {
    const now = Date.now();
    if (now - lastSendTimestampRef.current < 400) {
      console.log('[CHAT] Discarding rapid duplicate send');
      return;
    }
    lastSendTimestampRef.current = now;

    const textToEvaluate = typeof overrideText === 'string' ? overrideText : inputText;
    if (!textToEvaluate.trim() && !selectedImage) return;
    
    presenceService.onMessageSent();
    
    // If only image is sent with no text, use a meaningful placeholder so backend min(1) passes
    const textToSend = textToEvaluate.trim() || '📷 (image attached)';
    sendMessage(textToSend, selectedImage?.base64, selectedImage?.uri);
    if (typeof overrideText !== 'string') {
      setInputText('');
    }
    setSelectedImage(null);
    isNearBottomRef.current = true;
    setNewMessagesWhileScrolled(0);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [inputText, selectedImage, sendMessage]);

  const handlePickImage = useCallback(() => {
    Alert.alert(
      "Share Image",
      "Choose a photo to share with Nova",
      [
        {
          text: "Camera",
          onPress: async () => {
            const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
            if (permissionResult.granted === false) {
              Alert.alert("Permission required", "You need to allow camera access to take a photo.");
              return;
            }
            const result = await ImagePicker.launchCameraAsync({
              base64: true,
              quality: 0.5,
            });
            if (!result.canceled && result.assets[0].base64) {
              setSelectedImage({ uri: result.assets[0].uri, base64: result.assets[0].base64 });
            }
          }
        },
        {
          text: "Gallery",
          onPress: async () => {
            const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (permissionResult.granted === false) {
              Alert.alert("Permission required", "You need to allow gallery access to pick a photo.");
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              base64: true,
              quality: 0.5,
            });
            if (!result.canceled && result.assets[0].base64) {
              setSelectedImage({ uri: result.assets[0].uri, base64: result.assets[0].base64 });
            }
          }
        },
        { text: "Cancel", style: "cancel" }
      ]
    );
  }, []);

  const renderItem = useCallback(({ item, index }: { item: Message, index: number }) => {
    const isUser = item.role === 'user';
    
    let StatusIcon = null;
    if (isUser) {
      if (item.status === 'sending') {
        StatusIcon = <Text style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 4 }}>🕒</Text>;
      } else if (item.status === 'error' || item.status === 'failed') {
        StatusIcon = (
          <TouchableOpacity onPress={() => retryMessage(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 10, color: '#EF4444', marginLeft: 4 }}>❌</Text>
          </TouchableOpacity>
        );
      } else if (item.status === 'responded') {
        StatusIcon = <Text style={{ fontSize: 10, color: '#3B82F6', marginLeft: 4 }}>✓✓</Text>;
      } else {
        // 'sent' — delivered
        StatusIcon = <Text style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 4 }}>✓</Text>;
      }
    }
    
    let showDateSeparator = false;
    if (index === reversedMessages.length - 1) {
      showDateSeparator = true;
    } else {
      const prevMessage = reversedMessages[index + 1];
      if (prevMessage && item.timestamp) {
        const currentDate = new Date(item.timestamp).toDateString();
        const prevDate = new Date(prevMessage.timestamp || new Date().toISOString()).toDateString();
        if (currentDate !== prevDate) {
          showDateSeparator = true;
        }
      }
    }
    
    if (developerMode && showDateSeparator && item.timestamp) {
      console.log("Date separator:", formatDateSeparator(item.timestamp));
    }

    return (
      <View>
        {showDateSeparator && item.timestamp && (
          <View style={s.dateSeparatorContainer}>
            <Text style={[s.dateSeparatorText, { backgroundColor: colors.border, color: colors.textSecondary }]}>
              {formatDateSeparator(item.timestamp)}
            </Text>
          </View>
        )}
        <SwipeableBubble item={item} onReply={setReplyingTo}>
          <View style={s.bubbleContainer}>
          {selectedMessageIds.includes(item.id) && (
            <View 
              pointerEvents="none" 
              style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(139, 92, 246, 0.15)', zIndex: 10 }]} 
            />
          )}
          <View style={[s.bubble, item.isSystemMessage ? { backgroundColor: 'transparent', alignSelf: 'center', maxWidth: '90%' } : isUser ? s.userBubble : s.novaBubble]}>
          {!isUser && (
            <View style={s.avatarDot} />
          )}
          <View style={[
            s.bubbleInner,
            isUser
              ? { backgroundColor: colors.userBubble, borderBottomRightRadius: 4, maxWidth: '80%' }
              : { backgroundColor: colors.assistantBubble, borderBottomLeftRadius: 4, maxWidth: '95%', minWidth: '60%', overflow: 'visible' }
          ]}>
            {item.reply_to_content && (
              <View style={{
                backgroundColor: 'rgba(0,0,0,0.15)',
                padding: 8,
                borderRadius: 4,
                marginBottom: 8,
                borderLeftWidth: 3,
                borderLeftColor: '#8B5CF6'
              }}>
                <Text style={{ color: isUser ? colors.buttonText : colors.assistantText, fontSize: 13, opacity: 0.9, fontWeight: '500' }} numberOfLines={1}>
                  {'↩ '}{cleanPreviewText(item.reply_to_content)}
                </Text>
              </View>
            )}
            {/* Attached Image Preview */}
            {(() => {
              const imageUri = item.image_uri 
                || (item.image_base64 ? (item.image_base64.startsWith('data:') ? item.image_base64 : `data:image/jpeg;base64,${item.image_base64}`) : undefined)
                || item.meta?.image_url;
              if (!imageUri) return null;
              return (
                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={() => setFullScreenImageUri(imageUri)}
                  style={s.bubbleImageWrapper}
                >
                  <Image
                    source={{ uri: imageUri }}
                    style={s.bubbleAttachedImage}
                    resizeMode="cover"
                  />
                  <View style={s.bubbleImageZoomPill}>
                    <Text style={{ fontSize: 10, color: '#fff', fontWeight: '700' }}>🔍 Tap to zoom</Text>
                  </View>
                </TouchableOpacity>
              );
            })()}
            {item.isSystemMessage ? (
              <Text style={{ color: '#888', fontSize: 13, fontStyle: 'italic', textAlign: 'center', paddingHorizontal: 8, paddingVertical: 4 }}>
                {item.content}
              </Text>
            ) : !isUser ? (
              <SmartMarkdown
                content={item.content}
                colors={colors}
                onLongPress={() => toggleSelectMessage(item.id)}
                onPress={() => {
                  if (isSelectionMode) {
                    toggleSelectMessage(item.id);
                  } else if (item.meta?.is_corrected || (item.meta?.versions && item.meta.versions.length > 1)) {
                    setVersionModalMessage(item);
                  }
                }}
                mdStyle={{
                  body: { color: colors.assistantText, fontSize: 16, lineHeight: 22 },
                  heading1: { color: colors.assistantText, fontSize: 24, fontWeight: 'bold', marginVertical: 12 },
                  heading2: { color: colors.assistantText, fontSize: 20, fontWeight: 'bold', marginVertical: 10 },
                  heading3: { color: colors.assistantText, fontSize: 18, fontWeight: 'bold', marginVertical: 8 },
                  strong: { fontWeight: 'bold', color: colors.assistantText },
                  em: { fontStyle: 'italic', color: colors.assistantText },
                  u: { textDecorationLine: 'underline' },
                  blockquote: { backgroundColor: 'rgba(139, 92, 246, 0.1)', borderLeftWidth: 4, borderLeftColor: '#8B5CF6', paddingHorizontal: 12, paddingVertical: 8, marginVertical: 8, borderRadius: 4 },
                  code_block: { backgroundColor: 'rgba(0,0,0,0.1)', padding: 10, borderRadius: 8, marginVertical: 8, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: colors.assistantText },
                  hr: { backgroundColor: colors.border, height: 1, marginVertical: 12 },
                  list_item: { flexShrink: 1 },
                  bullet_list_content: { flexShrink: 1 },
                  ordered_list_content: { flexShrink: 1 },
                }}
                mdRules={{
                  fence: (node: any, _c: any, _p: any, _s: any) => {
                    const content = node.content;
                    const language = node.sourceInfo;
                    const isCopyable = language === 'copyable';
                    return (
                      <View key={node.key} style={s.fenceContainer}>
                        <View style={s.fenceHeader}>
                          <Text style={s.fenceLanguage}>{isCopyable ? 'Content' : (language || 'Code')}</Text>
                          <TouchableOpacity
                            style={s.copyButton}
                            onPress={async () => {
                              await Clipboard.setStringAsync(content);
                              showCopyToast('Code copied to clipboard');
                            }}
                          >
                            <Text style={s.copyButtonText}>Copy</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={s.fenceContent}>
                          {isCopyable ? (
                            <SmartMarkdown
                              content={content}
                              colors={colors}
                              mdStyle={{
                                body: { color: colors.assistantText, fontSize: 16, lineHeight: 24 },
                                strong: { fontWeight: 'bold' },
                                em: { fontStyle: 'italic' },
                                heading1: { color: colors.assistantText, fontSize: 24, fontWeight: 'bold', marginVertical: 8 },
                                heading2: { color: colors.assistantText, fontSize: 20, fontWeight: 'bold', marginVertical: 8 },
                                heading3: { color: colors.assistantText, fontSize: 18, fontWeight: 'bold', marginVertical: 8 },
                                blockquote: { backgroundColor: 'rgba(139, 92, 246, 0.1)', borderLeftWidth: 4, borderLeftColor: '#8B5CF6', paddingHorizontal: 12, paddingVertical: 8, marginVertical: 8, borderRadius: 4 },
                              }}
                              mdRules={{ text: customTextRule }}
                            />
                          ) : (
                            <Text style={{ color: colors.assistantText, fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                              {content}
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  },
                  textgroup: (node: any, children: any, _p: any, styles: any) => (
                    <Text key={node.key} style={styles.textgroup}>{children}</Text>
                  ),
                  text: customTextRule,
                }}
              />
            ) : (
              (() => {
                const isImageOnlyPlaceholder = (
                  item.content === '📷 (image attached)' ||
                  item.content === '📷 [Photo]' ||
                  item.content === '📷 [Image]' ||
                  item.content.trim() === ''
                );
                const hasImage = !!(
                  item.image_uri ||
                  item.image_base64 ||
                  item.meta?.image_url
                );
                if (hasImage && isImageOnlyPlaceholder) return null;

                return (
                  <Pressable
                    onLongPress={() => toggleSelectMessage(item.id)}
                    onPress={() => {
                      if (isSelectionMode) {
                        toggleSelectMessage(item.id);
                      }
                    }}
                  >
                    <Text style={[
                      s.messageText,
                      { color: colors.buttonText }
                    ]}>
                      {item.content}
                    </Text>
                  </Pressable>
                );
              })()
            )}
            <View style={s.timestampContainer}>
              {!isUser && (item.meta?.is_corrected || (item.meta?.versions && item.meta.versions.length > 1)) && (
                <TouchableOpacity
                  onPress={() => setVersionModalMessage(item)}
                  style={s.versionBadge}
                  activeOpacity={0.7}
                >
                  <Text style={s.versionBadgeText}>
                    ✨ Aligned {item.meta?.versions && item.meta.versions.length > 1 ? `(v${item.meta.versions.length})` : ''}
                  </Text>
                </TouchableOpacity>
              )}
              {item.chunkIndex && item.chunkTotal && (
                <Text style={[
                  s.chunkIndicatorText,
                  isUser ? { color: colors.buttonText, opacity: 0.5 } : { color: colors.assistantText, opacity: 0.4 }
                ]}>
                  {item.chunkIndex}/{item.chunkTotal}
                </Text>
              )}
              <Text style={[
                s.timestampText,
                isUser ? { color: colors.buttonText, opacity: 0.7 } : { color: colors.assistantText, opacity: 0.6 }
              ]}>
                {formatTime(item.timestamp)}
              </Text>
              {isUser && StatusIcon}
            </View>
            {isUser && (item.status === 'error' || item.status === 'failed') && (
              <TouchableOpacity
                style={s.retryButton}
                onPress={() => retryMessage(item.id)}
                activeOpacity={0.7}
              >
                <Text style={s.retryText}>↺ Tap to retry</Text>
              </TouchableOpacity>
            )}
            </View>
          </View>
          
          {/* Nova's Mind - Thoughts Panel */}
          {!isUser && item.hasThoughts && (
            <View style={{ marginLeft: 14 }}>
              <ThoughtBubble messageId={item.id} />
            </View>
          )}

          {item.user_reaction && (
            <View style={[s.reactionBadge, { marginLeft: 14 }]}>
              <Text style={s.reactionText}>
                {item.user_reaction === 'THUMBS_UP' ? '👍' : item.user_reaction === 'THUMBS_DOWN' ? '👎' : '❤️'}
              </Text>
            </View>
          )}
          
          {item.options && item.options.length > 0 && !isUser && index <= 1 && (
            <View style={s.optionsContainer}>
              {item.options.map((option, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={s.optionChip}
                  onPress={() => handleSend(option)}
                  activeOpacity={0.7}
                >
                  <Text style={s.optionText}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          </View>
        </SwipeableBubble>
      </View>
    );
  }, [retryMessage, colors, reversedMessages, developerMode, selectedMessageIds, isSelectionMode, toggleSelectMessage, handleSend, setReplyingTo, setVersionModalMessage]);

  if (!isHydrated) {
    return (
      <View style={[s.centerContainer, { backgroundColor: colors.background }]}>
        <NovaLoader />
      </View>
    );
  }

  return (
    <SafeAreaView style={[s.safeArea, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={[s.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <OfflineBanner visible={isOffline} />
        {/* Header */}
        {isSelectionMode ? (
          <View style={[s.header, { borderBottomColor: colors.border, backgroundColor: 'rgba(139, 92, 246, 0.1)' }]}>
            <View style={s.headerLeft}>
              <TouchableOpacity onPress={() => setSelectedMessageIds([])} style={s.headerBtn}>
                <Text style={[s.headerBtnText, { color: colors.textPrimary }]}>✕</Text>
              </TouchableOpacity>
              <Text style={[s.headerTitle, { color: colors.textPrimary, marginLeft: 8 }]}>{selectedMessageIds.length} Selected</Text>
            </View>
            <View style={s.headerRight}>
              <TouchableOpacity onPress={async () => {
                const selectedMsgs = messages
                  .filter(m => selectedMessageIds.includes(m.id))
                  .map(m => m.content)
                  .join('\n\n');
                if (selectedMsgs) {
                  await Clipboard.setStringAsync(selectedMsgs);
                  const count = selectedMessageIds.length;
                  setSelectedMessageIds([]);
                  showCopyToast(`${count} ${count === 1 ? 'message' : 'messages'} copied`);
                }
              }} style={s.headerBtn}>
                <Text style={s.headerBtnText}>📋</Text>
              </TouchableOpacity>
              {selectedMessageIds.length === 1 && (
                <TouchableOpacity onPress={() => {
                  const msg = messages.find(m => m.id === selectedMessageIds[0]);
                  if (msg) {
                    setReplyingTo(msg);
                    inputRef.current?.focus();
                  }
                  setSelectedMessageIds([]);
                }} style={s.headerBtn}>
                  <Text style={s.headerBtnText}>↩️</Text>
                </TouchableOpacity>
              )}
              {selectedMessageIds.length === 1 && (
                <View style={{ flexDirection: 'row', marginLeft: 8 }}>
                  {['👍', '👎', '❤️'].map(reaction => (
                    <TouchableOpacity
                      key={reaction}
                      onPress={() => {
                        const rMap: any = { '👍': 'THUMBS_UP', '👎': 'THUMBS_DOWN', '❤️': 'LIKE' };
                        updateMessageReaction(selectedMessageIds[0], rMap[reaction]);
                        setSelectedMessageIds([]);
                      }}
                      style={[s.headerBtn, { paddingHorizontal: 6 }]}
                    >
                      <Text style={s.headerBtnText}>{reaction}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {selectedMessageIds.length === 1 && (
                <TouchableOpacity onPress={() => {
                  const msg = messages.find(m => m.id === selectedMessageIds[0]);
                  if (msg) {
                    setInputText(msg.content);
                  }
                  setSelectedMessageIds([]);
                }} style={s.headerBtn}>
                  <Text style={s.headerBtnText}>✏️</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <View style={[s.header, { borderBottomColor: colors.border }]}>
            <View style={s.headerLeft}>
              <View style={s.novaAvatar}>
                <Text style={s.novaAvatarText}>N</Text>
              </View>
              <View>
                <Text style={[s.headerTitle, { color: colors.textPrimary }]}>Nova</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <Text style={[s.headerSubtitle, { color: colors.textSecondary, marginRight: 6 }]}>Your AI companion</Text>
                  {/* Nova's presence is the SERVER's availability. `presenceService` only tracks
                      the user's own local app state — the old code rendered the user's own
                      typing/online/away as Nova's, which was always wrong. Show static 'online'. */}
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E', marginRight: 4 }} />
                  <Text style={{ fontSize: 10, color: colors.textSecondary }}>online</Text>
                </View>
              </View>
            </View>
            <View style={s.headerRight}>
              <TouchableOpacity
                onPress={() => {
                  setIsSearchActive(prev => !prev);
                  if (isSearchActive) setSearchQuery('');
                }}
                style={[s.headerBtn, isSearchActive && { backgroundColor: 'rgba(139, 92, 246, 0.2)', borderRadius: 8 }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.headerBtnText}>🔍</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => {
                Alert.alert(
                  "New Chat",
                  "Start a fresh conversation? Your old messages are safely saved.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Start", onPress: () => useChatStore.getState().startNewConversation() }
                  ]
                );
              }} style={s.headerBtn}>
                <Text style={s.headerBtnText}>✨</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('Brain')} style={s.headerBtn}>
                <Text style={s.headerBtnText}>🧠</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={s.headerBtn}>
                <Text style={s.headerBtnText}>⚙️</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Live In-Chat Search Bar */}
        {isSearchActive && (
          <View style={[s.searchBarContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <Text style={{ fontSize: 14, marginRight: 6 }}>🔍</Text>
            <TextInput
              style={[s.searchInput, { color: colors.textPrimary }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search chat (workout, notes, schedule)..."
              placeholderTextColor={colors.placeholder}
              autoFocus
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[s.searchBadge, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                  <Text style={{ fontSize: 11, color: '#8B5CF6', fontWeight: '700' }}>
                    {displayedMessages.length} {displayedMessages.length === 1 ? 'match' : 'matches'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ padding: 4 }}
                >
                  <Text style={{ fontSize: 14, color: colors.textSecondary }}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity
              onPress={() => {
                setIsSearchActive(false);
                setSearchQuery('');
              }}
              style={{ marginLeft: 8, paddingVertical: 4, paddingHorizontal: 6 }}
            >
              <Text style={{ fontSize: 13, color: '#8B5CF6', fontWeight: '600' }}>Close</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Diagnostics Card */}
        {developerMode && diagnostics && (
          <View style={{
            position: 'absolute', top: 80, right: 16, zIndex: 100,
            backgroundColor: 'rgba(0,0,0,0.8)', padding: 10, borderRadius: 8,
            borderWidth: 1, borderColor: '#8B5CF6'
          }}>
            <Text style={{ color: '#0f0', fontSize: 10, fontWeight: 'bold' }}>DEV DIAGNOSTICS</Text>
            <Text style={{ color: '#fff', fontSize: 10 }}>API: {diagnostics.apiCount}</Text>
            <Text style={{ color: '#fff', fontSize: 10 }}>Store: {diagnostics.storeCount}</Text>
            <Text style={{ color: '#fff', fontSize: 10 }}>Rendered: {messages.length}</Text>
            <Text style={{ color: '#fff', fontSize: 10 }}>Oldest: {diagnostics.oldestTimestamp ? new Date(diagnostics.oldestTimestamp).toDateString() : 'N/A'}</Text>
            <Text style={{ color: '#fff', fontSize: 10 }}>Newest: {diagnostics.newestTimestamp ? new Date(diagnostics.newestTimestamp).toDateString() : 'N/A'}</Text>
            <Text style={{ color: '#fff', fontSize: 8 }}>User: {diagnostics.activeUserId}</Text>
            <Text style={{ color: '#fff', fontSize: 8 }}>Conv: {diagnostics.activeConversationId}</Text>
          </View>
        )}
        {/* Messages Container */}
        <View style={{ flex: 1 }}>

          <FlatList
            ref={flatListRef}
            inverted
            data={displayedMessages}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            extraData={displayedMessages.length + (selectedMessageIds.length > 0 ? selectedMessageIds[0] : '') + (isTyping ? '1' : '0')}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={s.listContent}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onContentSizeChange={(w, h) => {
              setMainWidths(prev => ({ ...prev, content: h }));
              logEvent('ON_CONTENT_SIZE_CHANGE');
              if (isInitialScrollRef.current) {
                if (messages.length > 0) {
                  isInitialScrollRef.current = false;
                  logEvent('INITIAL_SCROLL_COMPLETED');
                }
              } else if (isNearBottomRef.current) {
                logEvent('SCROLL_TO_END_CALLED');
                flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
              }
            }}
            onLayout={(e) => {
              const layoutHeight = e.nativeEvent.layout.height;
              setMainWidths(prev => ({ ...prev, view: layoutHeight }));
              logEvent('ON_LAYOUT');
            }}
            removeClippedSubviews
            windowSize={10}
            initialNumToRender={15}
            maxToRenderPerBatch={5}
            updateCellsBatchingPeriod={50}
            onEndReached={() => {
              // In an inverted list, "end" is visually the TOP = oldest messages
              if (hasMoreMessages && !isLoadingMore && !isSearchActive) {
                loadOlderMessages();
              }
            }}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              isLoadingMore ? (
                <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color="#8B5CF6" />
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6 }}>Loading older messages...</Text>
                </View>
              ) : null
            }
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              isSearchActive && searchQuery.trim() ? (
                <View style={{ transform: [{ scaleY: -1 }], padding: 32, alignItems: 'center' }}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>🔍</Text>
                  <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
                    No messages found
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>
                    No messages matching "{searchQuery}". Try another keyword or clear search.
                  </Text>
                </View>
              ) : (
                <LifestyleOnboardingHub
                  colors={colors}
                  onSelectPrompt={(prompt) => handleSend(prompt)}
                  onCustomize={(prompt) => {
                    setInputText(prompt);
                    inputRef.current?.focus();
                  }}
                />
              )
            }
          />

          {/* Custom Main Chat Scrollbar */}
          {mainWidths.content > mainWidths.view && (
            <View style={{
              position: 'absolute',
              right: 2,
              top: 4,
              bottom: 4,
              width: 6,
              backgroundColor: colors.background === '#1A1A1A' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              borderRadius: 3,
              pointerEvents: 'none',
              zIndex: 10
            }}>
              <Animated.View style={{
                position: 'absolute',
                bottom: 0,
                width: '100%',
                height: Math.max((mainWidths.view / mainWidths.content) * mainWidths.view, 40),
                backgroundColor: colors.background === '#1A1A1A' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
                borderRadius: 3,
                transform: [{
                  translateY: mainScrollY.interpolate({
                    inputRange: [0, Math.max(mainWidths.content - mainWidths.view, 1)],
                    outputRange: [0, -Math.max(mainWidths.view - Math.max((mainWidths.view / mainWidths.content) * mainWidths.view, 40), 0)],
                    extrapolate: 'clamp',
                  })
                }]
              }} />
            </View>
          )}



          {/* Scroll to Bottom FAB */}
          {showScrollDown && (
            <Animated.View style={s.scrollDownFabContainer}>
              <TouchableOpacity
                onPress={() => {
                  setNewMessagesWhileScrolled(0);
                  flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
                }}
                style={[s.scrollDownFab, { backgroundColor: colors.background === '#1A1A1A' ? '#2A2A2A' : '#FFFFFF', borderColor: colors.border }]}
                activeOpacity={0.85}
              >
                <Text style={{ fontSize: 20, color: colors.textSecondary, marginTop: -2 }}>↓</Text>
                {newMessagesWhileScrolled > 0 && (
                  <View style={s.fabNewBadge}>
                    <Text style={s.fabNewBadgeText}>
                      {newMessagesWhileScrolled > 9 ? '9+' : newMessagesWhileScrolled}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>

        {/* Live Thinking & Typing indicator */}
        {isTyping && <LiveThinkingIndicator />}

        {/* Reply Preview */}
        {replyingTo && (
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.05)',
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            borderLeftWidth: 4,
            borderLeftColor: '#8B5CF6'
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#8B5CF6', fontSize: 12, fontWeight: 'bold', marginBottom: 2 }}>
                Replying to {replyingTo.role === 'user' ? 'Yourself' : 'Nova'}
              </Text>
              <Text style={{ color: colors.textPrimary, fontSize: 13, opacity: 0.8 }} numberOfLines={1}>
                {cleanPreviewText(replyingTo.content)}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setReplyingTo(null)} style={{ padding: 8 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Smart Quick Actions Bar */}
        <View style={s.quickActionsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.quickActionsScroll}
          >
            {QUICK_ACTION_CHIPS.map(chip => (
              <TouchableOpacity
                key={chip.id}
                style={[s.quickActionChip, { backgroundColor: 'rgba(139, 92, 246, 0.12)', borderColor: 'rgba(139, 92, 246, 0.28)' }]}
                onPress={() => {
                  if (chip.isNavigation) {
                    navigation.navigate('Brain');
                  } else if (chip.prefix) {
                    setInputText(prev => {
                      if (!prev.trim()) return chip.prefix;
                      if (prev.startsWith(chip.prefix)) return prev;
                      return `${chip.prefix}${prev.trim()}`;
                    });
                    presenceService.onTypingStart();
                    inputRef.current?.focus();
                  }
                }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 13, marginRight: 5 }}>{chip.icon}</Text>
                <Text style={[s.quickActionText, { color: '#C4B5FD' }]}>{chip.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Input */}
        <View style={{ paddingHorizontal: 8, paddingBottom: 8 }}>
          {selectedImage && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, marginLeft: 8 }}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setFullScreenImageUri(selectedImage.uri)}
                style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#8B5CF6' }}
              >
                <Image source={{ uri: selectedImage.uri }} style={{ width: 68, height: 68, borderRadius: 9 }} />
                <View style={{ position: 'absolute', bottom: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 }}>
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>🔍 Preview</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  marginLeft: 10,
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  borderColor: 'rgba(239, 68, 68, 0.4)',
                  borderWidth: 1,
                  borderRadius: 14,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
                onPress={() => setSelectedImage(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: 'bold' }}>✕ Remove</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={[s.inputContainer, { borderTopColor: colors.border }]}>
            <TouchableOpacity onPress={handlePickImage} style={{ padding: 10 }}>
              <Text style={{ fontSize: 24 }}>👁️</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, position: 'relative', justifyContent: 'center' }}>
              <TextInput
                ref={inputRef}
                style={[s.input, { color: colors.textPrimary, backgroundColor: colors.inputBg, marginLeft: 4, paddingRight: inputText ? 36 : 16 }]}
                value={inputText}
                onChangeText={(text) => {
                  setInputText(text);
                  presenceService.onTypingStart();
                }}
                placeholder="Message Nova..."
                placeholderTextColor={colors.placeholder}
                multiline
                maxLength={2000}
                textAlignVertical="center"
              />
              {inputText.length > 0 && (
                <TouchableOpacity
                  style={s.clearInputBtn}
                  onPress={() => setInputText('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: 14 }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            {inputText.length > 1800 && (
              <Text style={[s.charCountText, { color: inputText.length >= 2000 ? '#EF4444' : '#F59E0B' }]}>
                {inputText.length}/2000
              </Text>
            )}
            {isTyping && !inputText.trim() && !selectedImage ? (
              <TouchableOpacity
                style={[s.sendBtn, s.stopBtn]}
                onPress={() => abortGeneration()}
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <View style={s.stopIconSquare} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.sendBtn, !inputText.trim() && !selectedImage && s.sendBtnDisabled]}
                onPress={() => handleSend()}
                disabled={!inputText.trim() && !selectedImage}
              >
                <Text style={s.sendBtnText}>↑</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* ── Message Version History & Branching Modal ── */}
      <Modal
        visible={!!versionModalMessage}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setVersionModalMessage(null)}
      >
        <View style={s.versionModalOverlay}>
          <View style={[s.versionModalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Header */}
            <View style={s.versionModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 18 }}>✨</Text>
                <Text style={[s.versionModalTitle, { color: colors.textPrimary }]}>
                  Reply Version History
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setVersionModalMessage(null)}
                style={s.versionModalCloseBtn}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 16, fontWeight: 'bold' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Autonomous Green Seal Polish Indicator */}
            {versionModalMessage?.meta?.is_corrected && (
              <View style={s.versionAlertBox}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 16 }}>🛡️</Text>
                  <Text style={s.versionAlertTitle}>
                    Autonomous Tri-Pass Clearance & Green Seal
                  </Text>
                </View>
                <Text style={s.versionAlertDesc}>
                  Watchtower verified area memories, deep neural connections, and voice continuity.
                </Text>
              </View>
            )}

            {/* Versions List */}
            <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
              {(versionModalMessage?.meta?.versions || [
                {
                  version: 1,
                  content: versionModalMessage?.content || '',
                  timestamp: versionModalMessage?.timestamp || '',
                  reason: 'Current Reply'
                }
              ]).map((v, idx) => {
                const totalVersions = versionModalMessage?.meta?.versions?.length || 1;
                const activeIndex = versionModalMessage?.meta?.active_version_index ?? (totalVersions - 1);
                const isActive = activeIndex === idx;
                return (
                  <View
                    key={idx}
                    style={[
                      s.versionItemCard,
                      { borderColor: isActive ? '#8B5CF6' : colors.border },
                      isActive && { backgroundColor: 'rgba(139, 92, 246, 0.08)' }
                    ]}
                  >
                    <View style={s.versionItemHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={[s.versionBadgeChip, isActive ? { backgroundColor: '#8B5CF6', color: '#fff' } : { backgroundColor: colors.border, color: colors.textSecondary }]}>
                          v{v.version || idx + 1}
                        </Text>
                        <Text style={[s.versionItemLabel, { color: colors.textPrimary }]}>
                          {idx === 0 ? 'Initial Response' : 'Autonomously Aligned'}
                        </Text>
                      </View>
                      {isActive && (
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#8B5CF6' }}>
                          ACTIVE
                        </Text>
                      )}
                    </View>

                    <Text style={[s.versionItemContent, { color: colors.textPrimary }]}>
                      {v.content}
                    </Text>

                    {v.clean_label ? (
                      <Text style={[s.versionReasonText, { color: colors.textSecondary }]}>
                        ✨ {v.clean_label}
                      </Text>
                    ) : idx === 0 ? (
                      <Text style={[s.versionReasonText, { color: colors.textSecondary }]}>
                        ⚡ Initial Rapid Response
                      </Text>
                    ) : (
                      <Text style={[s.versionReasonText, { color: colors.textSecondary }]}>
                        ✨ Autonomous Tri-Pass Refinement (Green Seal)
                      </Text>
                    )}

                    {!isActive && (
                      <TouchableOpacity
                        style={[s.versionSwitchBtn, { borderColor: '#8B5CF6' }]}
                        onPress={async () => {
                          if (versionModalMessage) {
                            await switchMessageVersion(versionModalMessage.id, idx);
                            setVersionModalMessage(null);
                          }
                        }}
                      >
                        <Text style={{ color: '#8B5CF6', fontSize: 13, fontWeight: '600' }}>
                          Switch to this version
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            {/* Branching & Regenerate Footer */}
            <View style={s.versionModalFooter}>
              <TouchableOpacity
                style={[s.regenerateBranchBtn, { backgroundColor: '#8B5CF6' }]}
                onPress={async () => {
                  if (versionModalMessage) {
                    const targetId = versionModalMessage.id;
                    setVersionModalMessage(null);
                    await regenerateBranch(targetId);
                  }
                }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
                  🌱 Try Another Branch (Regenerate)
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Full-Screen Image Viewer Modal ── */}
      <Modal
        visible={!!fullScreenImageUri}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setFullScreenImageUri(null)}
      >
        <View style={s.fullScreenImageOverlay}>
          <SafeAreaView style={{ flex: 1, width: '100%' }}>
            <View style={s.fullScreenImageHeader}>
              <TouchableOpacity
                onPress={() => setFullScreenImageUri(null)}
                style={s.fullScreenImageCloseBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              {fullScreenImageUri && (
                <Image
                  source={{ uri: fullScreenImageUri }}
                  style={{ width: '92%', height: '82%', borderRadius: 12 }}
                  resizeMode="contain"
                />
              )}
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* ── Floating Copy Confirmation Toast ── */}
      {copyToastText && (
        <View pointerEvents="none" style={s.floatingToastContainer}>
          <View style={s.floatingToastInner}>
            <Text style={s.floatingToastText}>✓ {copyToastText}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)'
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  novaAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#8B5CF6',
    alignItems: 'center', justifyContent: 'center'
  },
  novaAvatarText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  headerTitle: { fontSize: 16, fontWeight: 'bold' },
  headerSubtitle: { fontSize: 11 },
  headerRight: { flexDirection: 'row', gap: 4 },
  headerBtn: { padding: 8 },
  headerBtnText: { fontSize: 20 },
  listContent: { padding: 16, paddingBottom: 8 },
  bubbleContainer: {
    paddingHorizontal: 16,
    paddingVertical: 2,
    marginHorizontal: -16,
  },
  bubble: { flexDirection: 'row', marginVertical: 2, alignItems: 'flex-end' },
  userBubble: { justifyContent: 'flex-end' },
  novaBubble: { justifyContent: 'flex-start', gap: 8 },
  avatarDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8B5CF6', marginBottom: 6 },
  bubbleInner: { padding: 12, borderRadius: 18 },
  messageText: { fontSize: 16, lineHeight: 22 },
  retryButton: { marginTop: 6 },
  retryText: { color: '#F59E0B', fontSize: 12, fontWeight: '600' },
  typingContainer: {
    flexDirection: 'row', gap: 4, paddingHorizontal: 24, paddingVertical: 8, alignItems: 'center'
  },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8B5CF6' },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 80 },
  emptyChatEmoji: { fontSize: 48, marginBottom: 16 },
  emptyChatText: { fontSize: 22, fontWeight: 'bold', marginBottom: 10 },
  emptyChatSubtext: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  inputContainer: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderTopWidth: 1,
    alignItems: 'flex-end', gap: 10
  },
  input: {
    flex: 1,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 16, maxHeight: 120, lineHeight: 22,
    textAlignVertical: 'center',
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#8B5CF6',
    alignItems: 'center', justifyContent: 'center'
  },
  sendBtnDisabled: {
    backgroundColor: '#333'
  },
  sendBtnText: {
    color: '#fff', fontSize: 20, fontWeight: 'bold'
  },
  dateSeparatorContainer: {
    alignItems: 'center',
    marginVertical: 16,
  },
  stickyDateContainer: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
  },
  dateSeparatorText: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: '500',
    overflow: 'hidden'
  },
  timestampContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
    marginLeft: 12,
  },
  timestampText: {
    fontSize: 10,
  },
  chunkIndicatorText: {
    fontSize: 10,
    marginRight: 6,
    fontWeight: '600',
  },
  fenceContainer: {
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 8,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    overflow: 'hidden',
    width: '100%',
  },
  fenceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  fenceLanguage: {
    fontSize: 12,
    color: '#888',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  copyButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 6,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  fenceContent: {
    padding: 12,
  },
  optionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    gap: 8,
  },
  optionChip: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  optionText: {
    color: '#8B5CF6',
    fontSize: 14,
    fontWeight: '600',
  },
  reactionBadge: {
    position: 'absolute',
    bottom: -10,
    right: 10,
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#333',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 1,
  },
  reactionText: {
    fontSize: 12,
  },
  // Version history & Refined badge styles
  versionBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    marginRight: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  versionBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8B5CF6',
  },
  versionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  versionModalCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  versionModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  versionModalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  versionModalCloseBtn: {
    padding: 6,
  },
  versionAlertBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  versionAlertTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10B981',
    marginBottom: 2,
  },
  versionAlertDesc: {
    fontSize: 12,
    color: '#6EE7B7',
    lineHeight: 16,
  },
  versionItemCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  versionItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  versionBadgeChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 'bold',
    overflow: 'hidden',
  },
  versionItemLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  versionItemContent: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  versionFlawText: {
    fontSize: 12,
    color: '#F59E0B',
    fontStyle: 'italic',
    marginTop: 2,
  },
  versionReasonText: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  versionSwitchBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  versionModalFooter: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  regenerateBranchBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Quick Actions Bar
  quickActionsContainer: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  quickActionsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  quickActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  clearInputBtn: {
    position: 'absolute',
    right: 12,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  charCountText: {
    fontSize: 10,
    fontWeight: '600',
    alignSelf: 'center',
    marginRight: 4,
  },
  // Lifestyle Onboarding Hub
  lifestyleHubContainer: {
    paddingHorizontal: 12,
    paddingVertical: 24,
    alignItems: 'center',
  },
  lifestyleHero: {
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  lifestyleAvatarOrb: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  lifestyleAvatarText: {
    color: '#fff',
    fontSize: 26,
    fontWeight: 'bold',
  },
  lifestyleTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginBottom: 6,
    textAlign: 'center',
  },
  lifestyleSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 10,
    maxWidth: 320,
  },
  lifestyleStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  onlineDotPulse: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
  },
  lifestyleStatusText: {
    color: '#6EE7B7',
    fontSize: 11,
    fontWeight: '600',
  },
  categoryScroll: {
    width: '100%',
    marginBottom: 16,
  },
  categoryScrollContent: {
    paddingHorizontal: 4,
    gap: 8,
  },
  catPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  catPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tracksGrid: {
    width: '100%',
    gap: 12,
  },
  trackCard: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  trackCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  trackTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  trackBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  trackBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  trackDesc: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 10,
  },
  promptBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#8B5CF6',
    marginBottom: 12,
  },
  promptPreview: {
    color: '#D1D5DB',
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  trackActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  trackActionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackActionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  trackCustomizeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackCustomizeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  bubbleImageWrapper: {
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 6,
    position: 'relative',
  },
  bubbleAttachedImage: {
    width: 220,
    height: 180,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  bubbleImageZoomPill: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  fullScreenImageOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImageHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  fullScreenImageCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  searchInput: {
    flex: 1,
    height: 36,
    fontSize: 14,
    paddingHorizontal: 8,
  },
  searchBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  stopBtn: {
    backgroundColor: '#EF4444',
  },
  stopIconSquare: {
    width: 14,
    height: 14,
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  scrollDownFabContainer: {
    position: 'absolute',
    bottom: 12,
    right: 16,
    zIndex: 100,
  },
  scrollDownFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
    borderWidth: 1,
  },
  fabNewBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#8B5CF6',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  fabNewBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  floatingToastContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
  },
  floatingToastInner: {
    backgroundColor: '#1E1E2E',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#8B5CF6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  floatingToastText: {
    color: '#E0E7FF',
    fontSize: 13,
    fontWeight: '600',
  },
});
