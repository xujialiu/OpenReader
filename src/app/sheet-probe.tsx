// THROWAWAY PROBE (branch xujialiu/highlight--sheet-probe), never merged.
// Presents @expo/ui 57's SwiftUI BottomSheet with presentationDetents(['medium','large'])
// so the sheet's chrome and its content can be measured from screenshots.
import { useState } from 'react';
import { PlatformColor, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View } from 'react-native';
import {
  BottomSheet, Button, ColorPicker, Form, Group, HStack, Host, Image, LabeledContent, List,
  NavigationDestination, NavigationLink, NavigationStack, Picker, RNHostView, Section, Spacer,
  Stepper, Text, Toggle, Toolbar,
} from '@expo/ui/swift-ui';
import {
  listStyle, navigationTitle, pickerStyle, presentationBackgroundInteraction,
  presentationDetents, presentationDragIndicator, tag,
} from '@expo/ui/swift-ui/modifiers';

type Content = 'form' | 'list' | 'rn-scroll' | 'text-input';
const CONTENTS: Content[] = ['form', 'list', 'rn-scroll', 'text-input'];
const ROWS = Array.from({ length: 40 }, (_, i) => `Row ${i + 1}`);

function log(...args: unknown[]) {
  console.log('PROBE', new Date().toISOString().slice(11, 23), ...args);
}

/** The rows of A (Form) and B (plain List). `stacked` means a NavigationStack encloses them. */
function Rows({ stacked }: { stacked: boolean }) {
  const [size, setSize] = useState(17);
  const [align, setAlign] = useState('left');
  const [cont, setCont] = useState(true);
  const [color, setColor] = useState('#FFD60A80');
  return <>
    <Section title="Appearance">
      <LabeledContent label="Voice"><Text>Ava</Text></LabeledContent>
      {stacked
        ? <NavigationLink value="font"><LabeledContent label="Font"><Text>Original</Text></LabeledContent></NavigationLink>
        : <HStack><Text>Font</Text><Spacer /><Text>Original</Text><Image systemName="chevron.right" size={13} color="gray" /></HStack>}
      <Stepper label={`Font Size ${size}`} value={size} step={1} min={10} max={40}
        onValueChange={(v) => { log('stepper', v); setSize(v); }} />
      <Picker label="Alignment" selection={align} modifiers={[pickerStyle('menu')]}
        onSelectionChange={(v: string) => { log('picker', v); setAlign(v); }}>
        <Text modifiers={[tag('left')]}>Left</Text>
        <Text modifiers={[tag('justify')]}>Justify</Text>
      </Picker>
    </Section>
    <Section>
      <Toggle label="Continuous" isOn={cont} onIsOnChange={(v) => { log('toggle', v); setCont(v); }} />
      <ColorPicker label="Highlight" selection={color} supportsOpacity
        onSelectionChange={(v) => { log('color', v); setColor(v); }} />
    </Section>
  </>;
}

function SheetBody({ content, toolbar }: { content: Content; toolbar: boolean }) {
  const [text, setText] = useState('A Short Test of Reading Aloud');
  let body;
  if (content === 'form') body = <Form modifiers={toolbar ? [navigationTitle('Appearance')] : []}><Rows stacked={toolbar} /></Form>;
  else if (content === 'list') body = <List modifiers={[listStyle('plain'), ...(toolbar ? [navigationTitle('Appearance')] : [])]}><Rows stacked={toolbar} /></List>;
  else if (content === 'rn-scroll') body = <Group modifiers={toolbar ? [navigationTitle('Contents')] : []}>
    <RNHostView>
      <View style={{ flex: 1 }} onLayout={(e) => log('rn-host-view layout', JSON.stringify(e.nativeEvent.layout))}>
        <ScrollView style={{ flex: 1 }} scrollEventThrottle={250}
          onLayout={(e) => log('rn-scroll layout', JSON.stringify(e.nativeEvent.layout))}
          onScroll={(e) => log('rn-scroll y', e.nativeEvent.contentOffset.y.toFixed(1))}>
          {ROWS.map((r) => <View key={r} style={styles.rnRow}><RNText style={styles.rnRowText}>{r}</RNText></View>)}
        </ScrollView>
      </View>
    </RNHostView>
  </Group>;
  else body = <Group modifiers={toolbar ? [navigationTitle('Rename')] : []}>
    <RNHostView>
      <View style={{ flex: 1, padding: 20 }} onLayout={(e) => log('text-input host layout', JSON.stringify(e.nativeEvent.layout))}>
        <TextInput value={text} onChangeText={setText} style={styles.input} accessibilityLabel="Display name"
          onFocus={() => log('text-input focus')} onBlur={() => log('text-input blur')} />
      </View>
    </RNHostView>
  </Group>;
  if (!toolbar) return body;
  return <NavigationStack onPathChange={(p) => log('path', JSON.stringify(p))}>
    <Toolbar>
      {body}
      <Toolbar.Content><Button role="close" onPress={() => { log('close pressed'); probeClose?.(); }} /></Toolbar.Content>
    </Toolbar>
    <NavigationDestination value="font">
      <Form modifiers={[navigationTitle('Font')]}>
        <Text>Original Book Font</Text><Text>Georgia</Text><Text>Palatino</Text>
      </Form>
    </NavigationDestination>
  </NavigationStack>;
}

let probeClose: (() => void) | undefined;

export function SheetProbe({ onExit }: { onExit(): void }) {
  const [presented, setPresented] = useState(false);
  const [content, setContent] = useState<Content>('form');
  const [toolbar, setToolbar] = useState(false);
  const [interact, setInteract] = useState(false);
  const [taps, setTaps] = useState(0);
  probeClose = () => setPresented(false);
  const modifiers = [
    presentationDetents(['medium', 'large'], { onSelectionChange: (d) => log('detent', JSON.stringify(d)) }),
    presentationDragIndicator('visible'),
    ...(interact ? [presentationBackgroundInteraction({ type: 'enabledUpThrough' as const, detent: 'medium' as const })] : []),
  ];
  return <View style={StyleSheet.absoluteFill}>
    <View style={[StyleSheet.absoluteFill, { backgroundColor: PlatformColor('systemBackground') }]} />
    {/* Known colours behind the sheet, independent of the appearance. */}
    <View style={styles.band}>
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />
      <View style={{ flex: 1, backgroundColor: '#000000' }} />
    </View>
    <Pressable accessibilityLabel={`Behind ${taps}`} onPress={() => { log('behind tapped', taps + 1); setTaps(taps + 1); }} style={styles.behind}>
      <RNText style={styles.behindText}>Behind: {taps}</RNText>
    </Pressable>
    <View style={styles.controls}>
      <RNText style={styles.label}>Content</RNText>
      <View style={styles.row}>{CONTENTS.map((c) =>
        <Pressable key={c} accessibilityLabel={`content ${c}`} onPress={() => setContent(c)} style={[styles.chip, content === c && styles.chipOn]}>
          <RNText style={styles.chipText}>{c}</RNText></Pressable>)}</View>
      <View style={styles.row}>
        <Pressable accessibilityLabel={`toolbar ${toolbar}`} onPress={() => setToolbar(!toolbar)} style={[styles.chip, toolbar && styles.chipOn]}>
          <RNText style={styles.chipText}>toolbar {toolbar ? 'on' : 'off'}</RNText></Pressable>
        <Pressable accessibilityLabel={`interact ${interact}`} onPress={() => setInteract(!interact)} style={[styles.chip, interact && styles.chipOn]}>
          <RNText style={styles.chipText}>bg interaction {interact ? 'on' : 'off'}</RNText></Pressable>
      </View>
      <View style={styles.row}>
        <Pressable accessibilityLabel="Open probe sheet" onPress={() => { log('open', content, 'toolbar', toolbar, 'interact', interact); setPresented(true); }} style={[styles.chip, styles.open]}>
          <RNText style={[styles.chipText, { color: 'white' }]}>Open sheet</RNText></Pressable>
        <Pressable accessibilityLabel="Exit probe" onPress={onExit} style={styles.chip}>
          <RNText style={styles.chipText}>Exit probe</RNText></Pressable>
      </View>
    </View>
    {/* The same ColorPicker outside any sheet, to tell a sheet problem from a tap problem. */}
    <Host style={styles.pagePicker}>
      <ColorPicker label="Page colour" selection="#FFD60A80" supportsOpacity
        onSelectionChange={(v) => log('page color', v)} />
    </Host>
    <Host style={styles.host}>
      <BottomSheet isPresented={presented}
        onIsPresentedChange={(v) => { log('isPresented', v); setPresented(v); }}
        onDismiss={() => log('dismissed')}>
        <Group modifiers={modifiers}>
          <SheetBody content={content} toolbar={toolbar} />
        </Group>
      </BottomSheet>
    </Host>
  </View>;
}

const styles = StyleSheet.create({
  band: { position: 'absolute', top: 120, left: 0, right: 0, height: 180, flexDirection: 'row' },
  behind: { position: 'absolute', top: 320, left: 100, width: 202, height: 50, borderRadius: 10, backgroundColor: '#808080', alignItems: 'center', justifyContent: 'center' },
  behindText: { color: 'white', fontSize: 17 },
  controls: { position: 'absolute', top: 520, left: 16, right: 16, gap: 12 },
  label: { color: PlatformColor('label'), fontSize: 15 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 18, backgroundColor: PlatformColor('tertiarySystemFill') },
  chipOn: { backgroundColor: PlatformColor('systemGreen') },
  open: { backgroundColor: PlatformColor('systemBlue') },
  chipText: { color: PlatformColor('label'), fontSize: 15 },
  pagePicker: { position: 'absolute', top: 70, left: 16, right: 16, height: 44 },
  host: { position: 'absolute', bottom: 0, right: 0, width: 4, height: 4 },
  rnRow: { height: 44, justifyContent: 'center', paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: PlatformColor('separator') },
  rnRowText: { fontSize: 17, color: PlatformColor('label') },
  input: { fontSize: 17, padding: 14, borderRadius: 10, color: PlatformColor('label'), backgroundColor: PlatformColor('tertiarySystemFill') },
});
