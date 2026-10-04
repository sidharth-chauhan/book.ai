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
  accent: '#2F4A43', // deep ink-green
  accentSoft: '#DCE5DF',
  danger: '#9B3B2E',
};
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Iowan Old Style", "Times New Roman", serif' });
const SANS = Platform.select({ ios: 'System', android: 'sans-serif', default: '-apple-system, "Segoe UI", Roboto, Helvetica, sans-serif' });

const shadow = (o = 0.08, r = 16, y = 6) =>
  Platform.select({
    web: { boxShadow: `0px ${y}px ${r}px rgba(60,40,10,${o})` } as any,
    default: { shadowColor: '#3C280A', shadowOpacity: o, shadowRadius: r / 2, shadowOffset: { width: 0, height: y / 2 }, elevation: 3 },
  });

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

/* ---------- Skeleton loader ---------- */
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

function BookSkeleton() {
  return (
    <View>
      <View style={[styles.overview, shadow()]}>
        <Pulse style={{ height: 30, width: '75%', marginBottom: 12 }} />
        <Pulse style={{ height: 16, width: '35%', marginBottom: 24 }} />
        <Pulse style={{ height: 13, width: '100%', marginBottom: 8 }} />
        <Pulse style={{ height: 13, width: '96%', marginBottom: 8 }} />
        <Pulse style={{ height: 13, width: '70%' }} />
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.chapterCard, shadow(0.05, 10, 3)]}>
          <Pulse style={{ width: 40, height: 40, borderRadius: 20, marginRight: 16 }} />
          <View style={{ flex: 1 }}>
            <Pulse style={{ height: 16, width: '60%', marginBottom: 10 }} />
            <Pulse style={{ height: 12, width: '95%' }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ---------- Chat modal ---------- */
function ReadModal({ book, chapter, onClose }: { book: Book; chapter: Chapter | null; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [asking, setAsking] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);

  const playAudio = async (text: string, id: string) => {
    if (playingId) return;
    setPlayingId(id);
    try {
      const res = await fetch(`${API}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      
      if (!res.ok) throw new Error('Audio fetch failed');
      
      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      audio.onended = () => setPlayingId(null);
      audio.play();
    } catch (e) {
      setPlayingId(null);
    }
  };

  useEffect(() => {
    setQuestion('');
    setMessages([]);
    setAsking(false);
  }, [chapter?.title]);

  if (!chapter) return null;

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
      setMessages((m) => [...m, { id: `a${Date.now()}`, role: 'ai', text: data.answer || 'No answer was returned.' }]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { id: `e${Date.now()}`, role: 'ai', error: true, text: 'Could not reach the local AI. Check that the server is running on port 5001, then ask again.' },
      ]);
    } finally {
      setAsking(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.sheetBook} numberOfLines={1}>{book.title}</Text>
                <Text style={styles.sheetTitle}>{chapter.title}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={scroller}
              style={styles.chat}
              contentContainerStyle={{ padding: 20, paddingBottom: 8 }}
              onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.chapterNote}>
                <Text style={styles.chapterNoteText}>{chapter.summary}</Text>
              </View>

              {messages.length === 0 && (
                <Text style={styles.emptyChat}>
                  Ask anything about this chapter: its argument, its characters, a passage you found hard to follow.
                </Text>
              )}

              {messages.map((m) =>
                m.role === 'user' ? (
                  <View key={m.id} style={[styles.bubbleUser, shadow(0.12, 8, 3)]}>
                    <Text style={styles.bubbleUserText}>{m.text}</Text>
                  </View>
                ) : (
                  <View key={m.id} style={[styles.bubbleAi, shadow(0.06, 10, 3), m.error && { borderColor: C.danger }]}>
                    {m.error ? <Text style={[styles.mdText, { color: C.danger }]}>{m.text}</Text> : <Markdown text={m.text} />}
                    {!m.error && (
                      <TouchableOpacity onPress={() => playAudio(m.text, m.id)} style={styles.playBtn}>
                        <Text style={styles.playBtnText}>{playingId === m.id ? '🔊 Playing...' : '🔈 Read Aloud'}</Text>
                      </TouchableOpacity>
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
          </View>
        </KeyboardAvoidingView>
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

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.paper} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.column}>
          {/* Hero */}
          <View style={[styles.hero, compact && { paddingTop: 28, paddingBottom: 24 }]}>
            <Text style={[styles.brand, compact && { fontSize: 20 }]}>Marginalia</Text>
            {!compact && (
              <Text style={styles.tagline}>
                A reading companion that runs entirely on your device. Name a book and talk through it, chapter by chapter.
              </Text>
            )}

            <View style={[styles.searchBox, shadow(0.1, 20, 8)]}>
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
                disabled={loading || !query.trim()}
                style={[styles.exploreBtn, (loading || !query.trim()) && { opacity: 0.5 }]}
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
          </View>

          {loading && <BookSkeleton />}

          {book && !loading && (
            <View>
              <View style={[styles.overview, shadow()]}>
                <Text style={styles.bookTitle}>{book.title}</Text>
                <Text style={styles.bookAuthor}>by {book.author}</Text>
                <View style={styles.rule} />
                <Text style={styles.bookSummary}>{book.summary}</Text>
              </View>

              <Text style={styles.sectionTitle}>Chapters</Text>
              <Text style={styles.sectionHint}>Tap a chapter to discuss it.</Text>

              {book.chapters.map((ch, i) => (
                <TouchableOpacity
                  key={`${ch.title}-${i}`}
                  activeOpacity={0.8}
                  onPress={() => setActive(ch)}
                  style={[styles.chapterCard, shadow(0.06, 12, 4)]}
                  accessibilityRole="button"
                  accessibilityLabel={`Discuss ${ch.title}`}
                >
                  <View style={styles.chapterBadge}>
                    <Text style={styles.chapterBadgeText}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chapterTitle}>{ch.title}</Text>
                    <Text style={styles.chapterSummary} numberOfLines={3}>{ch.summary}</Text>
                    <Text style={styles.chapterCta}>Discuss this chapter</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {!book && !loading && !error && (
            <Text style={styles.footnote}>Private by design. Nothing you read or ask ever leaves this machine.</Text>
          )}
        </View>
      </ScrollView>

      {book && <ReadModal book={book} chapter={active} onClose={() => setActive(null)} />}
    </SafeAreaView>
  );
}

/* ---------- Styles ---------- */
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20, paddingBottom: 60 },
  column: { width: '100%', maxWidth: 720 },

  hero: { alignItems: 'center', paddingTop: 96, paddingBottom: 48 },
  brand: { fontFamily: SERIF, fontSize: 46, fontWeight: '700', color: C.ink, letterSpacing: -0.5, marginBottom: 14 },
  tagline: { fontFamily: SERIF, fontSize: 18, lineHeight: 28, color: C.inkSoft, textAlign: 'center', maxWidth: 460, marginBottom: 36 },

  searchBox: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.line,
    padding: 8,
  },
  searchInput: { flex: 1, fontFamily: SERIF, fontSize: 17, color: C.ink, paddingHorizontal: 14, paddingVertical: 12, minWidth: 0 },
  exploreBtn: { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 20, height: 48, minWidth: 130, alignItems: 'center', justifyContent: 'center' },
  exploreText: { fontFamily: SANS, color: '#FFF', fontSize: 15, fontWeight: '600' },

  errorBox: { marginTop: 18, backgroundColor: '#F7E3DE', borderRadius: 12, padding: 14, width: '100%' },
  errorText: { fontFamily: SANS, color: C.danger, fontSize: 14, lineHeight: 20 },

  overview: { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.line, padding: 28, marginBottom: 36 },
  bookTitle: { fontFamily: SERIF, fontSize: 32, lineHeight: 40, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  bookAuthor: { fontFamily: SERIF, fontSize: 17, fontStyle: 'italic', color: C.inkSoft, marginTop: 6 },
  rule: { height: 1, backgroundColor: C.line, marginVertical: 20 },
  bookSummary: { fontFamily: SERIF, fontSize: 16.5, lineHeight: 27, color: C.ink },

  sectionTitle: { fontFamily: SERIF, fontSize: 24, fontWeight: '700', color: C.ink, marginBottom: 4 },
  sectionHint: { fontFamily: SANS, fontSize: 14, color: C.inkFaint, marginBottom: 18 },

  chapterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 18,
    marginBottom: 12,
  },
  chapterBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  chapterBadgeText: { fontFamily: SERIF, fontSize: 16, fontWeight: '700', color: C.accent },
  chapterTitle: { fontFamily: SERIF, fontSize: 18, fontWeight: '700', color: C.ink, marginBottom: 4 },
  chapterSummary: { fontFamily: SERIF, fontSize: 14.5, lineHeight: 21, color: C.inkSoft },
  chapterCta: { fontFamily: SANS, fontSize: 13, fontWeight: '600', color: C.accent, marginTop: 10 },
  chevron: { fontSize: 30, color: C.inkFaint, marginLeft: 10, marginTop: -4 },

  footnote: { fontFamily: SERIF, fontStyle: 'italic', fontSize: 14, color: C.inkFaint, textAlign: 'center', marginTop: 12 },

  /* modal */
  backdrop: { flex: 1, backgroundColor: 'rgba(42,33,24,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  sheetWrap: { width: '100%', maxWidth: 760, height: '90%' },
  sheet: { flex: 1, backgroundColor: C.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.line },
  sheetBook: { fontFamily: SANS, fontSize: 13, color: C.inkFaint, marginBottom: 4 },
  sheetTitle: { fontFamily: SERIF, fontSize: 23, lineHeight: 30, fontWeight: '700', color: C.ink },
  closeBtn: { backgroundColor: C.sunken, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  closeText: { fontFamily: SANS, fontSize: 14, fontWeight: '600', color: C.ink },

  chat: { flex: 1 },
  chapterNote: { backgroundColor: C.sunken, borderRadius: 14, padding: 16, marginBottom: 18 },
  chapterNoteText: { fontFamily: SERIF, fontSize: 14.5, lineHeight: 22, fontStyle: 'italic', color: C.inkSoft },
  emptyChat: { fontFamily: SERIF, fontSize: 15.5, lineHeight: 24, color: C.inkFaint, textAlign: 'center', paddingVertical: 24, paddingHorizontal: 12 },

  bubbleUser: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: C.accent, borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 14 },
  bubbleUserText: { fontFamily: SERIF, fontSize: 16, lineHeight: 23, color: '#FFF' },
  bubbleAi: { alignSelf: 'flex-start', maxWidth: '92%', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 20, borderBottomLeftRadius: 6, paddingHorizontal: 18, paddingVertical: 14, marginBottom: 14 },
  playBtn: { marginTop: 12, alignSelf: 'flex-start', backgroundColor: C.sunken, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  playBtnText: { fontFamily: SANS, fontSize: 13, color: C.inkSoft, fontWeight: '600' },

  composer: { flexDirection: 'row', alignItems: 'flex-end', padding: 14, paddingBottom: Platform.OS === 'ios' ? 28 : 14, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.paper },
  composerInput: { flex: 1, minHeight: 48, maxHeight: 120, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 13, fontFamily: SERIF, fontSize: 16, color: C.ink, marginRight: 10 },
  askBtn: { backgroundColor: C.accent, borderRadius: 14, height: 48, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  askText: { fontFamily: SANS, color: '#FFF', fontSize: 15, fontWeight: '600' },

  /* markdown */
  mdText: { fontFamily: SERIF, fontSize: 16, lineHeight: 25, color: C.ink },
  mdHeading: { fontFamily: SERIF, fontSize: 18, fontWeight: '700', color: C.ink, marginTop: 6, marginBottom: 4 },
  mdRow: { flexDirection: 'row', marginVertical: 2 },
  mdBullet: { fontFamily: SERIF, fontSize: 16, lineHeight: 25, color: C.accent, width: 22, fontWeight: '700' },
  mdCode: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'Menlo, Consolas, monospace' }), fontSize: 14, backgroundColor: C.sunken, color: C.accent },
});