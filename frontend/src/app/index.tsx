import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

const API = 'http://localhost:5001/api/book';

type Chapter = { title: string; summary: string };
type Book = { title: string; author: string; summary: string; chapters: Chapter[] };
type Message = { id: string; role: 'user' | 'ai'; text: string; error?: boolean };

/* ---------- Design tokens ---------- */
const C = {
  paper: '#F6F0E4',
  card: '#FFFBF3',
  sunken: '#EFE7D6',
  ink: '#2A2118',
  inkSoft: '#6B5D4D',
  inkFaint: '#A09282',
  line: '#E3D8C3',
  accent: '#2F4A43',
  accentSoft: '#DCE5DF',
  danger: '#9B3B2E',
  gold: '#E8C872',
  live: '#4E8B6A',
};
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Iowan Old Style", "Times New Roman", serif' });
const SANS = Platform.select({ ios: 'System', android: 'sans-serif', default: '-apple-system, "Segoe UI", Roboto, Helvetica, sans-serif' });
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'Menlo, Consolas, monospace' });

const shadow = (o = 0.08, r = 16, y = 6) =>
  Platform.select({
    web: { boxShadow: `0 1px 2px rgba(60,40,10,0.05), 0 ${y}px ${r}px rgba(60,40,10,${o})` } as any,
    default: { shadowColor: '#3C280A', shadowOpacity: o, shadowRadius: r / 2, shadowOffset: { width: 0, height: y / 2 }, elevation: 3 },
  });

const webOnly = (s: object) => (Platform.OS === 'web' ? (s as any) : null);
const BACKDROP_BLUR = webOnly({ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' });
const NAV_GLASS = webOnly({ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', position: 'sticky', top: 0, zIndex: 20 });
const PANEL_GLASS = webOnly({
  backgroundColor: 'rgba(251,246,234,0.86)',
  backdropFilter: 'blur(28px) saturate(1.3)',
  WebkitBackdropFilter: 'blur(28px) saturate(1.3)',
  boxShadow: '-30px 0 80px rgba(42,33,24,0.22), 0 2px 6px rgba(42,33,24,0.08)',
});
const STICKY = webOnly({ position: 'sticky', top: 96 });

/* ---------- Display helpers (visual only; API calls always use the original strings) ---------- */
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);
const pretty = (s: string) =>
  s === s.toLowerCase()
    ? s.split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
    : s;
const cleanTitle = (s: string) => s.replace(/^(chapter|part|section)\s+[\w.]+\s*[:.\-–—]\s*/i, '');

const COVERS = ['#2F4A43', '#5B2A2A', '#25364F', '#4A2F45', '#5A4326', '#2E4A5A'];
const coverColor = (t: string) => {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return COVERS[h % COVERS.length];
};

const EXAMPLES = [
  { title: 'Meditations', author: 'Marcus Aurelius', w: 132, rot: '-7deg' },
  { title: 'Nineteen Eighty-Four', author: 'George Orwell', w: 156, rot: '0deg' },
  { title: 'Atomic Habits', author: 'James Clear', w: 132, rot: '7deg' },
];

/* ---------- Tiny markdown renderer (no dependencies) ---------- */
function Inline({ text, style }: { text: string; style: any }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((p, i) => {
        if (p.startsWith('**')) return <Text key={i} style={{ fontWeight: '700' }}>{p.slice(2, -2)}</Text>;
        if (p.startsWith('`')) return <Text key={i} style={styles.mdCode}>{p.slice(1, -1)}</Text>;
        if (p.startsWith('*')) return <Text key={i} style={{ fontStyle: 'italic' }}>{p.slice(1, -1)}</Text>;
        return p;
      })}
    </Text>
  );
}

function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  return (
    <View>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={{ height: 8 }} />;
        const h = line.match(/^#{1,4}\s+(.*)/);
        if (h) return <Inline key={i} text={h[1]} style={styles.mdHeading} />;
        const b = line.match(/^\s*[-*•]\s+(.*)/);
        if (b)
          return (
            <View key={i} style={styles.mdRow}>
              <Text style={styles.mdBullet}>•</Text>
              <Inline text={b[1]} style={[styles.mdText, { flex: 1 }]} />
            </View>
          );
        const n = line.match(/^\s*(\d+)[.)]\s+(.*)/);
        if (n)
          return (
            <View key={i} style={styles.mdRow}>
              <Text style={styles.mdBullet}>{n[1]}.</Text>
              <Inline text={n[2]} style={[styles.mdText, { flex: 1 }]} />
            </View>
          );
        return <Inline key={i} text={line} style={styles.mdText} />;
      })}
    </View>
  );
}

/* ---------- Small visual components ---------- */
function Pulse({ style }: { style: any }) {
  const v = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(v, { toValue: 0.45, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[{ backgroundColor: C.sunken, borderRadius: 8, opacity: v }, style]} />;
}

/** Generated book cover: the one memorable visual element of the app. */
function Cover({ title, author, width }: { title: string; author: string; width: number }) {
  return (
    <View style={[styles.cover, { width, height: width * 1.45, backgroundColor: coverColor(title) }, shadow(0.28, 30, 16)]}>
      <View style={styles.coverSpine} />
      <View style={{ flex: 1, padding: width * 0.1, paddingLeft: width * 0.17, justifyContent: 'space-between' }}>
        <View>
          <View style={styles.coverRule} />
          <Text style={[styles.coverTitle, { fontSize: width * 0.112, lineHeight: width * 0.138 }]} numberOfLines={5}>{pretty(title)}</Text>
        </View>
        <Text style={[styles.coverAuthor, { fontSize: width * 0.06 }]} numberOfLines={2}>{author}</Text>
      </View>
    </View>
  );
}

/** Animated bars shown while audio is playing. */
function Equalizer({ color }: { color: string }) {
  const bars = useRef([0, 1, 2, 3].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loops = bars.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 360 + i * 90, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(v, { toValue: 0.3, duration: 360 + i * 90, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bars]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: 14, marginRight: 9 }}>
      {bars.map((v, i) => (
        <Animated.View
          key={i}
          style={{ width: 3, borderRadius: 2, marginRight: 2, backgroundColor: color, height: v.interpolate({ inputRange: [0, 1], outputRange: [3, 14] }) }}
        />
      ))}
    </View>
  );
}

function BookSkeleton() {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const cw = isWide ? 240 : 170;
  return (
    <View style={isWide ? styles.split : undefined}>
      <View style={isWide ? styles.sideCol : { alignItems: 'center', marginBottom: 28 }}>
        <Pulse style={{ width: cw, height: cw * 1.45, borderRadius: 10 }} />
      </View>
      <View style={styles.mainCol}>
        <Pulse style={{ height: 24, width: 140, marginBottom: 18 }} />
        <View style={[styles.listCard, shadow(0.06, 14, 5)]}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.row, i < 4 && styles.rowBorder]}>
              <Pulse style={{ width: 28, height: 20, marginRight: 18 }} />
              <View style={{ flex: 1 }}>
                <Pulse style={{ height: 16, width: '50%', marginBottom: 10 }} />
                <Pulse style={{ height: 12, width: '85%' }} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/* ---------- Read panel (chat) ---------- */
function ReadModal({ book, chapter, onClose }: { book: Book; chapter: Chapter | null; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [asking, setAsking] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [autoRead, setAutoRead] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const audioRef = useRef<any>(null);
  const reqRef = useRef(0);
  const { width: winW } = useWindowDimensions();
  const isWide = winW >= 900;
  const slide = useRef(new Animated.Value(0)).current;

  const stopAudio = () => {
    reqRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  };

  const playAudio = async (text: string, id: string) => {
    if (playingId === id) {
      stopAudio();
      return;
    }
    if (playingId) stopAudio();
    const token = ++reqRef.current;
    setPlayingId(id);
    try {
      const res = await fetch(`${API}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error('Audio fetch failed');

      const blob = await res.blob();
      if (token !== reqRef.current) return;
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.onended = () => {
        audioRef.current = null;
        setPlayingId(null);
      };
      audio.play().catch(() => setPlayingId(null));
    } catch (e) {
      if (token === reqRef.current) setPlayingId(null);
    }
  };

  useEffect(() => {
    slide.setValue(0);
    Animated.timing(slide, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [chapter?.title, slide]);

  useEffect(() => {
    setQuestion('');
    setMessages([]);
    setAsking(false);
    stopAudio();
  }, [chapter?.title]);

  useEffect(() => () => stopAudio(), []);

  if (!chapter) return null;

  const close = () => {
    stopAudio();
    onClose();
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setQuestion('');
    setAsking(true);
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: 'user', text: q }]);
    try {
      const res = await fetch(`${API}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: book.title,
          chapter: chapter.title,
          question: `Regarding the book '${book.title}', specifically '${chapter.title}': ${q}`,
        }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      const answer = data.answer || 'No answer was returned.';
      const aid = `a${Date.now()}`;
      setMessages((m) => [...m, { id: aid, role: 'ai', text: answer }]);
      if (autoRead && data.answer) playAudio(answer, aid);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { id: `e${Date.now()}`, role: 'ai', error: true, text: 'Could not reach the local AI. Check that the server is running on port 5001, then ask again.' },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const onKey = (e: any) => {
    if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  return (
    <Modal visible animationType="fade" transparent onRequestClose={close}>
      <View style={[styles.backdrop, BACKDROP_BLUR]}>
        <TouchableOpacity activeOpacity={1} style={styles.dismiss} onPress={close} accessibilityLabel="Close panel" />
        <Animated.View
          style={[
            styles.panel,
            isWide ? styles.panelWide : styles.panelFull,
            PANEL_GLASS,
            { opacity: slide, transform: [{ [isWide ? 'translateX' : 'translateY']: slide.interpolate({ inputRange: [0, 1], outputRange: [isWide ? 56 : 48, 0] }) } as any] },
          ]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.sheetBook} numberOfLines={1}>{pretty(book.title)}</Text>
                <Text style={styles.sheetTitle} numberOfLines={2}>{chapter.title}</Text>
              </View>
              <TouchableOpacity onPress={close} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.toolbar}>
              <View style={styles.safePill}>
                <View style={styles.safeDot} />
                <Text style={styles.safeText}>Spoiler-free</Text>
              </View>
              <TouchableOpacity onPress={() => setAutoRead((v) => !v)} style={styles.autoRow} accessibilityRole="switch" accessibilityState={{ checked: autoRead }}>
                <Text style={[styles.autoText, autoRead && { color: C.accent }]}>Auto-read answers</Text>
                <View style={[styles.track, autoRead && styles.trackOn]}>
                  <View style={[styles.knob, autoRead && styles.knobOn]} />
                </View>
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={scroller}
              style={styles.chat}
              contentContainerStyle={{ padding: 24, paddingBottom: 8, flexGrow: 1 }}
              onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
              keyboardShouldPersistTaps="handled"
            >
              {messages.length === 0 && (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>What would you like to know?</Text>
                  <View style={styles.chips}>
                    {['Summarize this chapter', 'Key ideas', 'Explain it simply'].map((s) => (
                      <TouchableOpacity key={s} style={styles.chip} onPress={() => setQuestion(s)}>
                        <Text style={styles.chipText}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {messages.map((m) =>
                m.role === 'user' ? (
                  <View key={m.id} style={[styles.bubbleUser, shadow(0.14, 12, 4)]}>
                    <Text style={styles.bubbleUserText}>{m.text}</Text>
                  </View>
                ) : (
                  <View key={m.id} style={[styles.bubbleAi, shadow(0.07, 16, 5), m.error && { borderColor: C.danger }]}>
                    {m.error ? <Text style={[styles.mdText, { color: C.danger }]}>{m.text}</Text> : <Markdown text={m.text} />}
                    {!m.error && (
                      <View style={styles.bubbleFooter}>
                        <TouchableOpacity
                          onPress={() => playAudio(m.text, m.id)}
                          style={[styles.playBtn, playingId === m.id && styles.playBtnActive]}
                          accessibilityLabel="Read aloud"
                        >
                          {playingId === m.id ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Equalizer color="#FFF" />
                              <Text style={[styles.playBtnText, styles.playBtnTextActive]}>Playing... tap to stop</Text>
                            </View>
                          ) : (
                            <Text style={styles.playBtnText}>🔈 Read Aloud</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )
              )}

              {asking && (
                <View style={[styles.bubbleAi, { flexDirection: 'row', alignItems: 'center' }]}>
                  <ActivityIndicator size="small" color={C.accent} />
                  <Text style={[styles.mdText, { marginLeft: 10, color: C.inkSoft }]}>Reading the chapter…</Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.composer}>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder="Ask about this chapter"
                placeholderTextColor={C.inkFaint}
                style={[styles.composerInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
                multiline
                editable={!asking}
                onSubmitEditing={ask}
                onKeyPress={onKey}
                blurOnSubmit
              />
              <TouchableOpacity
                onPress={ask}
                disabled={asking || !question.trim()}
                style={[styles.askBtn, (asking || !question.trim()) && { opacity: 0.45 }]}
              >
                <Text style={styles.askText}>Ask</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ---------- App ---------- */
export default function App() {
  const [query, setQuery] = useState('');
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Chapter | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const explore = async () => {
    const title = query.trim();
    if (!title || loading) return;
    setLoading(true);
    setError(null);
    setBook(null);
    try {
      const res = await fetch(`${API}/explore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data: Book = await res.json();
      setBook({ ...data, chapters: data.chapters || [] });
    } catch (e: any) {
      setError('Could not load that book. Make sure the local server is running on port 5001 and try again.');
    } finally {
      setLoading(false);
    }
  };

  const compact = !!book || loading;
  const searchDisabled = loading || !query.trim();
  const coverW = isWide ? 240 : 170;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.paper} />

      {/* Top bar */}
      <View style={[styles.nav, NAV_GLASS]}>
        <View style={styles.navInner}>
          <View style={styles.brandRow}>
            <View style={styles.logoTile}>
              <Text style={styles.logoB}>b</Text>
              <View style={styles.logoSpark} />
            </View>
            <Text style={styles.brand}>
              book<Text style={styles.brandAi}>.ai</Text>
            </Text>
          </View>

          {compact && isWide && (
            <View style={styles.navSearch}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search another book"
                placeholderTextColor={C.inkFaint}
                style={[styles.navInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
                returnKeyType="search"
                onSubmitEditing={explore}
              />
              <TouchableOpacity onPress={explore} disabled={searchDisabled} style={[styles.navGo, searchDisabled && { opacity: 0.5 }]}>
                <Text style={styles.navGoText}>Explore</Text>
              </TouchableOpacity>
            </View>
          )}

          {width >= 1100 && (
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Gemma 2 running locally</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.column}>
          {/* Hero + search */}
          {(!compact || !isWide) && (
            <View style={[styles.hero, compact && styles.heroCompact]}>
              {!compact && (
                <Text style={[styles.headline, !isWide && styles.headlineNarrow]}>{'Read deeper.\nSpoil nothing.'}</Text>
              )}

              <View style={[styles.searchBox, shadow(0.12, 28, 12)]}>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Title of a book, e.g. Meditations"
                  placeholderTextColor={C.inkFaint}
                  style={[styles.searchInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
                  returnKeyType="search"
                  onSubmitEditing={explore}
                />
                <TouchableOpacity
                  onPress={explore}
                  disabled={searchDisabled}
                  style={[styles.exploreBtn, searchDisabled && { opacity: 0.5 }]}
                  accessibilityRole="button"
                >
                  {loading ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.exploreText}>Explore Book</Text>}
                </TouchableOpacity>
              </View>

              {error && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {!compact && isWide && (
                <View style={styles.shelf}>
                  {EXAMPLES.map((b) => (
                    <TouchableOpacity
                      key={b.title}
                      activeOpacity={0.85}
                      onPress={() => setQuery(b.title)}
                      accessibilityLabel={`Search ${b.title}`}
                      style={{ marginHorizontal: -10, transform: [{ rotate: b.rot }] }}
                    >
                      <Cover title={b.title} author={b.author} width={b.w} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}

          {loading && <BookSkeleton />}

          {book && !loading && (
            <View style={[isWide ? styles.split : undefined, !isWide && { paddingTop: 8 }]}>
              <View style={isWide ? [styles.sideCol, STICKY] : { alignItems: 'center', marginBottom: 32 }}>
                <Cover title={book.title} author={book.author} width={coverW} />
                <Text style={styles.stats}>{book.chapters.length} chapters</Text>
                <Text style={[styles.summary, !isWide && { textAlign: 'center', maxWidth: 520 }]} numberOfLines={isWide ? 7 : 4}>
                  {book.summary}
                </Text>
              </View>

              <View style={styles.mainCol}>
                <Text style={styles.sectionTitle}>Chapters</Text>
                <View style={[styles.listCard, shadow(0.07, 20, 8)]}>
                  {book.chapters.map((ch, i) => (
                    <TouchableOpacity
                      key={`${ch.title}-${i}`}
                      activeOpacity={0.7}
                      onPress={() => setActive(ch)}
                      style={[styles.row, i < book.chapters.length - 1 && styles.rowBorder]}
                      accessibilityRole="button"
                      accessibilityLabel={`Discuss ${ch.title}`}
                    >
                      <Text style={styles.rowNum}>{i + 1}</Text>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{cleanTitle(ch.title)}</Text>
                        <Text style={styles.rowSummary} numberOfLines={2}>{ch.summary}</Text>
                      </View>
                      <View style={styles.askPill}>
                        <Text style={styles.askPillText}>Ask</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {book && <ReadModal book={book} chapter={active} onClose={() => setActive(null)} />}
    </SafeAreaView>
  );
}

/* ---------- Styles ---------- */
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.paper,
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: 'radial-gradient(900px 420px at 50% 0%, #FCF8EE 0%, rgba(246,240,228,0) 100%)' } as any)
      : {}),
  },

  /* top bar */
  nav: { backgroundColor: 'rgba(246,240,228,0.9)', borderBottomWidth: 1, borderBottomColor: C.line, paddingHorizontal: 24 },
  navInner: { width: '100%', maxWidth: 1040, alignSelf: 'center', height: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  logoTile: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  logoB: { fontFamily: SERIF, fontSize: 21, fontWeight: '700', color: C.paper, marginTop: -2 },
  logoSpark: { position: 'absolute', top: 6, right: 6, width: 5, height: 5, borderRadius: 3, backgroundColor: C.gold },
  brand: { fontFamily: SERIF, fontSize: 22, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  brandAi: { color: C.accent },
  navSearch: { flex: 1, maxWidth: 440, marginHorizontal: 24, flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingLeft: 14, paddingRight: 4, height: 44 },
  navInput: { flex: 1, fontFamily: SANS, fontSize: 14.5, color: C.ink, minWidth: 0 },
  navGo: { backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 14, height: 34, alignItems: 'center', justifyContent: 'center' },
  navGoText: { fontFamily: SANS, fontSize: 13.5, fontWeight: '600', color: '#FFF' },
  statusPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.live, marginRight: 8 },
  statusText: { fontFamily: SANS, fontSize: 12.5, fontWeight: '500', color: C.inkSoft },

  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingBottom: 96 },
  column: { width: '100%', maxWidth: 1040 },

  /* hero */
  hero: { alignItems: 'center', paddingTop: 76, paddingBottom: 40 },
  heroCompact: { paddingTop: 28, paddingBottom: 24 },
  headline: { fontFamily: SERIF, fontSize: 64, lineHeight: 70, fontWeight: '700', color: C.ink, letterSpacing: -1.5, textAlign: 'center', marginBottom: 36 },
  headlineNarrow: { fontSize: 42, lineHeight: 48, letterSpacing: -1 },
  searchBox: { width: '100%', maxWidth: 640, flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 8 },
  searchInput: { flex: 1, fontFamily: SERIF, fontSize: 18, color: C.ink, paddingHorizontal: 16, paddingVertical: 14, minWidth: 0 },
  exploreBtn: { backgroundColor: C.accent, borderRadius: 14, paddingHorizontal: 22, height: 52, minWidth: 140, alignItems: 'center', justifyContent: 'center' },
  exploreText: { fontFamily: SANS, color: '#FFF', fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },
  errorBox: { marginTop: 18, backgroundColor: '#F7E3DE', borderRadius: 12, padding: 14, width: '100%', maxWidth: 640 },
  errorText: { fontFamily: SANS, color: C.danger, fontSize: 14, lineHeight: 20 },
  shelf: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginTop: 64 },

  /* covers */
  cover: { flexDirection: 'row', borderTopLeftRadius: 4, borderBottomLeftRadius: 4, borderTopRightRadius: 12, borderBottomRightRadius: 12, overflow: 'hidden' },
  coverSpine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '7%', backgroundColor: 'rgba(0,0,0,0.22)' },
  coverRule: { width: 28, height: 3, backgroundColor: C.gold, borderRadius: 2, marginBottom: 14 },
  coverTitle: { fontFamily: SERIF, fontWeight: '700', color: '#F6F0E4', letterSpacing: -0.3 },
  coverAuthor: { fontFamily: SANS, fontWeight: '500', color: 'rgba(246,240,228,0.75)' },

  /* book view */
  split: { flexDirection: 'row', paddingTop: 32, alignItems: 'flex-start' },
  sideCol: { width: 260, marginRight: 56, alignSelf: 'flex-start' },
  mainCol: { flex: 1, minWidth: 0 },
  stats: { fontFamily: SANS, fontSize: 13, fontWeight: '600', color: C.accent, marginTop: 24, marginBottom: 8 },
  summary: { fontFamily: SERIF, fontSize: 15.5, lineHeight: 24, color: C.inkSoft },

  sectionTitle: { fontFamily: SERIF, fontSize: 28, fontWeight: '700', color: C.ink, letterSpacing: -0.4, marginBottom: 18 },
  listCard: { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 20, paddingHorizontal: 24 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: C.line },
  rowNum: { fontFamily: SERIF, fontSize: 22, fontWeight: '700', color: C.inkFaint, width: 44 },
  rowTitle: { fontFamily: SERIF, fontSize: 18, fontWeight: '700', color: C.ink, marginBottom: 4 },
  rowSummary: { fontFamily: SERIF, fontSize: 14.5, lineHeight: 21, color: C.inkSoft },
  askPill: { backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  askPillText: { fontFamily: SANS, fontSize: 13.5, fontWeight: '600', color: C.accent },

  /* read panel */
  backdrop: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', backgroundColor: 'rgba(42,33,24,0.32)' },
  dismiss: { flex: 1 },
  panel: { overflow: 'hidden', backgroundColor: 'rgba(251,246,234,0.97)' },
  panelWide: { width: 560, maxWidth: '96%', marginVertical: 14, marginRight: 14, borderRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' },
  panelFull: { width: '100%' },

  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 28, paddingTop: 26, paddingBottom: 14 },
  sheetBook: { fontFamily: SANS, fontSize: 13, fontWeight: '500', color: C.inkFaint, marginBottom: 6 },
  sheetTitle: { fontFamily: SERIF, fontSize: 25, lineHeight: 31, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  closeBtn: { backgroundColor: 'rgba(255,251,243,0.9)', borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  closeText: { fontFamily: SANS, fontSize: 14, fontWeight: '600', color: C.ink },

  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(227,216,195,0.8)' },
  safePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  safeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent, marginRight: 7 },
  safeText: { fontFamily: SANS, fontSize: 12, fontWeight: '600', color: C.accent },
  autoRow: { flexDirection: 'row', alignItems: 'center' },
  autoText: { fontFamily: SANS, fontSize: 13, fontWeight: '500', color: C.inkSoft, marginRight: 10 },
  track: { width: 38, height: 22, borderRadius: 11, backgroundColor: '#D8CDB8', padding: 2, justifyContent: 'center' },
  trackOn: { backgroundColor: C.accent },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFF' },
  knobOn: { alignSelf: 'flex-end' },

  chat: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 24 },
  emptyTitle: { fontFamily: SERIF, fontSize: 20, fontWeight: '700', color: C.ink, marginBottom: 16, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  chip: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9, margin: 4 },
  chipText: { fontFamily: SANS, fontSize: 13.5, fontWeight: '500', color: C.ink },

  bubbleUser: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: C.accent, borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 18, paddingVertical: 13, marginBottom: 16 },
  bubbleUserText: { fontFamily: SERIF, fontSize: 16, lineHeight: 23, color: '#FFF' },
  bubbleAi: { alignSelf: 'flex-start', maxWidth: '94%', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 20, borderBottomLeftRadius: 6, paddingHorizontal: 20, paddingVertical: 16, marginBottom: 16 },
  bubbleFooter: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
  playBtn: { alignSelf: 'flex-start', backgroundColor: C.accentSoft, borderWidth: 1, borderColor: '#C6D6CD', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  playBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  playBtnText: { fontFamily: SANS, fontSize: 13.5, color: C.accent, fontWeight: '600' },
  playBtnTextActive: { color: '#FFF' },

  composer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingVertical: 16, paddingBottom: Platform.OS === 'ios' ? 28 : 16, borderTopWidth: 1, borderTopColor: 'rgba(227,216,195,0.8)' },
  composerInput: { flex: 1, minHeight: 52, maxHeight: 120, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 18, paddingTop: 15, paddingBottom: 15, fontFamily: SERIF, fontSize: 16, color: C.ink, marginRight: 10 },
  askBtn: { backgroundColor: C.accent, borderRadius: 16, height: 52, paddingHorizontal: 26, alignItems: 'center', justifyContent: 'center' },
  askText: { fontFamily: SANS, color: '#FFF', fontSize: 15, fontWeight: '600' },

  /* markdown */
  mdText: { fontFamily: SERIF, fontSize: 16, lineHeight: 25, color: C.ink },
  mdHeading: { fontFamily: SERIF, fontSize: 18, fontWeight: '700', color: C.ink, marginTop: 6, marginBottom: 4 },
  mdRow: { flexDirection: 'row', marginVertical: 2 },
  mdBullet: { fontFamily: SERIF, fontSize: 16, lineHeight: 25, color: C.accent, width: 22, fontWeight: '700' },
  mdCode: { fontFamily: MONO, fontSize: 14, backgroundColor: C.sunken, color: C.accent },
});