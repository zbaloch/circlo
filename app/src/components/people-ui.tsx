import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { circlesLine } from '@/components/circle-choice';
import { Button } from '@/components/form';
import { PersonRow } from '@/components/person-row';
import { ChoiceChips, Sheet } from '@/components/sheet';
import { Icon } from '@/components/ui/icon';
import { Text, TextInput } from '@/components/ui/text';
import { circlesOf } from '@/lib/circles';
import type { AddressBook } from '@/lib/addressbook';
import type { Connection } from '@/lib/friends';
import { comingUp, personKey, rhythmLabel, rowLine, type Contact, type ContactDate } from '@/lib/people';
import { addPersonNow } from '@/lib/people-store';
import { showToast } from '@/lib/toast';
import { displayName } from '@/lib/use-connections';
import { usePalette } from '@/theme/use-palette';

const FIELD = 'rounded-lg border border-border px-4 py-3 text-[15px] text-ink focus:border-primary dark:border-border-dark dark:text-ink-dark';

/** Opens a person's page: their entry, or (a connection I haven't written about) by account. */
export function openPerson(c: Contact) {
  router.push({ pathname: '/people/[id]', params: { id: personKey(c) } });
}

/**
 * People in the People tab (owner 2026-11-28): Coming up (catch-ups due, then dates in the next two weeks), then
 * everyone A–Z, my connections and the people I added who aren't on Circlo. A connection opens their profile (with
 * my private card on it); anyone else opens their page. Under each, one line only I see: a date soon, a catch-up
 * due, or (for a connection) the circles I put them in.
 */
export function PeopleList({ people, friends, book, today }: { people: Contact[]; friends: Connection[]; book: AddressBook | null; today: Date }) {
  const palette = usePalette();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const byUser = useMemo(() => new Map(friends.map((f) => [f.userId, f])), [friends]);
  const soon = comingUp(people, today);
  const q = query.trim().toLowerCase();
  const shown = q ? people.filter((c) => c.name.toLowerCase().includes(q) || (c.person?.username ?? '').toLowerCase().includes(q)) : people;

  return (
    <View className="gap-5">
      {soon.length > 0 ? (
        <View className="gap-1">
          <Text accessibilityRole="header" className="text-lg font-bold text-ink dark:text-ink-dark">Coming up</Text>
          {soon.map((s) => (
            <Pressable
              key={s.key}
              accessibilityRole="button"
              accessibilityLabel={`${s.entry.name}, ${s.text}`}
              onPress={() => openPerson(s.entry)}
              className="flex-row items-center gap-3 py-2 active:opacity-60">
              <Avatar id={s.entry.person?.userId ?? s.entry.contactId ?? s.entry.name} name={s.entry.name} uri={s.entry.person?.avatarUrl} size="sm" />
              <View className="flex-1">
                <Text numberOfLines={1} className="font-bold text-ink dark:text-ink-dark">{s.entry.name}</Text>
                <Text numberOfLines={1} className="text-muted dark:text-muted-dark">{s.text}</Text>
              </View>
              <Icon name={s.key.endsWith(':due') ? 'chatbubble-outline' : 'cake-outline'} size={18} color={palette.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View className="flex-row items-center gap-3">
        {people.length > 8 ? (
          <TextInput
            accessibilityLabel="Find someone"
            placeholder="Find someone"
            placeholderTextColor={palette.muted}
            value={query}
            onChangeText={setQuery}
            className="flex-1 rounded-full bg-surface-raised px-4 py-2 text-[15px] text-ink dark:bg-surface-raised-dark dark:text-ink-dark"
          />
        ) : (
          <Text className="flex-1 text-muted dark:text-muted-dark">Add people who aren’t on Circlo too. Only you see this.</Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add someone"
          onPress={() => setAdding(true)}
          className="flex-row items-center gap-1 rounded-full border border-border px-3.5 py-1.5 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
          <Icon name="add" size={18} color={palette.ink} />
          <Text className="font-semibold text-ink dark:text-ink-dark">Add</Text>
        </Pressable>
      </View>

      <View>
        {shown.map((c) => {
          const f = c.person ? byUser.get(c.person.userId) : undefined;
          const mine = rowLine(c, today);
          if (c.person) {
            const circles = book && f ? circlesLine(book, circlesOf(book, book.contacts[f.userId])) : '';
            return (
              <PersonRow
                key={personKey(c)}
                id={c.person.userId}
                name={f ? displayName(f) : c.person.name}
                handle={f?.profile.handle ?? c.person.username}
                bio={f?.profile.bio}
                note={[mine, circles].filter(Boolean).join(' · ') || undefined}
                avatarUrl={f?.profile.avatarUrl ?? c.person.avatarUrl}
                onPress={() => router.push({ pathname: '/friend/[id]', params: { id: c.person!.userId } })}
              />
            );
          }
          return <PersonRow key={personKey(c)} id={c.contactId ?? c.name} name={c.name} note={mine || 'Not on Circlo'} onPress={() => openPerson(c)} />;
        })}
        {q && shown.length === 0 ? <Text className="py-3 text-muted dark:text-muted-dark">No one called that.</Text> : null}
      </View>

      <NameSheet
        visible={adding}
        title="Add someone"
        initial=""
        onClose={() => setAdding(false)}
        onSave={async (name) => {
          try {
            const made = await addPersonNow(name);
            openPerson(made);
          } catch {
            showToast('Couldn’t add them. Try again.');
          }
        }}
      />
    </View>
  );
}

/** Asks for a person's name (adding someone, or renaming). */
export function NameSheet({ visible, title, initial, onSave, onClose }: {
  visible: boolean;
  title: string;
  initial: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {visible ? <NameForm initial={initial} onSave={onSave} onClose={onClose} /> : null}
    </Sheet>
  );
}

function NameForm({ initial, onSave, onClose }: { initial: string; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const palette = usePalette();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(name.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-4 px-5 pt-1">
      <TextInput
        accessibilityLabel="Name"
        autoFocus
        placeholder="Their name"
        placeholderTextColor={palette.muted}
        value={name}
        onChangeText={setName}
        onSubmitEditing={() => void save()}
        maxLength={200}
        className={FIELD}
      />
      <Button label="Save" onPress={() => void save()} loading={busy} disabled={!name.trim()} />
    </View>
  );
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Adds or edits a day to remember: Birthday, Anniversary or my own words; month and day; the year if I know it. */
export function DateSheet({ visible, initial, onSave, onDelete, onClose }: {
  visible: boolean;
  initial: ContactDate | null;
  onSave: (d: ContactDate) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title={initial ? 'Edit date' : 'Add a date'} onClose={onClose}>
      {visible ? <DateForm initial={initial} onSave={onSave} onDelete={onDelete} onClose={onClose} /> : null}
    </Sheet>
  );
}

function DateForm({ initial, onSave, onDelete, onClose }: {
  initial: ContactDate | null;
  onSave: (d: ContactDate) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const preset = (l: string) => (l === 'Birthday' || l === 'Anniversary' ? l : 'Other');
  const [kind, setKind] = useState(initial ? preset(initial.label) : 'Birthday');
  const [other, setOther] = useState(initial && preset(initial.label) === 'Other' ? initial.label : '');
  const [month, setMonth] = useState(initial ? String(initial.month) : '');
  const [day, setDay] = useState(initial ? String(initial.day) : '');
  const [year, setYear] = useState(initial?.year ? String(initial.year) : '');
  const [busy, setBusy] = useState(false);
  const label = kind === 'Other' ? other.trim() : kind;
  const m = Number(month);
  const d = Number(day);
  const y = year.trim() ? Number(year) : null;
  const valid =
    !!label && m >= 1 && m <= 12 && Number.isInteger(d) && d >= 1 && d <= DAYS_IN[m - 1] && (y === null || (Number.isInteger(y) && y >= 1900 && y <= new Date().getFullYear()));
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSave({ label, month: m, day: d, year: y });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-4 px-5 pt-1">
      <ChoiceChips label="What" selected={kind} onSelect={setKind} options={['Birthday', 'Anniversary', 'Other'].map((v) => ({ value: v, label: v }))} />
      {kind === 'Other' ? (
        <TextInput accessibilityLabel="What it is" placeholder="Name day, Moved to London…" placeholderTextColor={palette.muted} value={other} onChangeText={setOther} maxLength={40} className={FIELD} />
      ) : null}
      <ChoiceChips label="Month" selected={month} onSelect={setMonth} options={MONTHS_SHORT.map((n, i) => ({ value: String(i + 1), label: n }))} />
      <View className="flex-row gap-3">
        <TextInput accessibilityLabel="Day" placeholder="Day" placeholderTextColor={palette.muted} keyboardType="number-pad" value={day} onChangeText={setDay} maxLength={2} className={`flex-1 ${FIELD}`} />
        <TextInput accessibilityLabel="Year (if you know it)" placeholder="Year (optional)" placeholderTextColor={palette.muted} keyboardType="number-pad" value={year} onChangeText={setYear} maxLength={4} className={`flex-1 ${FIELD}`} />
      </View>
      <Button label="Save" onPress={() => void save()} loading={busy} disabled={!valid} />
      {onDelete ? <Button label="Delete date" variant="outline" onPress={() => { onClose(); onDelete(); }} /> : null}
    </View>
  );
}

/** "Caught up": when (today, or a day before) and a few words if I like. */
export function CatchUpSheet({ visible, onSave, onClose }: { visible: boolean; onSave: (body: string, daysAgo: number) => Promise<void>; onClose: () => void }) {
  return (
    <Sheet visible={visible} title="Caught up" onClose={onClose}>
      {visible ? <CatchUpForm onSave={onSave} onClose={onClose} /> : null}
    </Sheet>
  );
}

function CatchUpForm({ onSave, onClose }: { onSave: (body: string, daysAgo: number) => Promise<void>; onClose: () => void }) {
  const palette = usePalette();
  const [daysAgo, setDaysAgo] = useState(0);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const whenText = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(body.trim(), daysAgo);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-4 px-5 pt-1">
      <View className="flex-row items-center justify-between">
        <Pressable accessibilityRole="button" accessibilityLabel="A day earlier" hitSlop={10} onPress={() => setDaysAgo((n) => Math.min(n + 1, 365))} className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised dark:active:bg-surface-raised-dark">
          <Icon name="chevron-back" size={22} color={palette.ink} />
        </Pressable>
        <Text accessibilityLabel={`When: ${whenText}`} className="text-base font-bold text-ink dark:text-ink-dark">{whenText}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="A day later"
          hitSlop={10}
          disabled={daysAgo === 0}
          onPress={() => setDaysAgo((n) => Math.max(n - 1, 0))}
          className={`h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised dark:active:bg-surface-raised-dark ${daysAgo === 0 ? 'opacity-30' : ''}`}>
          <Icon name="chevron-forward" size={22} color={palette.ink} />
        </Pressable>
      </View>
      <TextInput
        accessibilityLabel="What you talked about (optional)"
        placeholder="What you talked about (optional)"
        placeholderTextColor={palette.muted}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={10_000}
        className={`max-h-32 ${FIELD}`}
      />
      <Button label="Save" onPress={() => void save()} loading={busy} />
    </View>
  );
}

/** Links an entry to one of my connections (someone I knew before they joined): connections without an entry. */
export function LinkSheet({ visible, people, onPick, onClose }: { visible: boolean; people: Contact[]; onPick: (userId: string) => void; onClose: () => void }) {
  const choices = people.filter((c) => !c.contactId && c.person);
  return (
    <Sheet visible={visible} title="Which connection is this?" onClose={onClose}>
      <View className="px-5">
        {choices.length === 0 ? <Text className="py-3 text-muted dark:text-muted-dark">Everyone you’re connected to already has their own entry.</Text> : null}
        {choices.map((c) => (
          <PersonRow key={c.person!.userId} id={c.person!.userId} name={c.person!.name} handle={c.person!.username} avatarUrl={c.person!.avatarUrl} onPress={() => { onClose(); onPick(c.person!.userId); }} />
        ))}
      </View>
    </Sheet>
  );
}

/**
 * On a connection's profile, only for me: what I keep about them (a date soon, the rhythm, notes), opening their page.
 */
export function KeepInTouchCard({ entry, today }: { entry: Contact; today: Date }) {
  const palette = usePalette();
  const parts = [
    rowLine(entry, today),
    entry.keepInTouchDays ? rhythmLabel(entry.keepInTouchDays) : '',
    entry.noteCount ? `${entry.noteCount} ${entry.noteCount === 1 ? 'note' : 'notes'}` : '',
  ].filter(Boolean);
  const empty = parts.length === 0 && entry.dates.length === 0;
  const line = empty ? 'Add a birthday, notes or how often to catch up' : parts.join(' · ') || `${entry.dates.length} ${entry.dates.length === 1 ? 'date' : 'dates'}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Your notes about ${entry.name}: ${line}. Only you see this`}
      onPress={() => openPerson(entry)}
      className="flex-row items-center gap-3 rounded-2xl border border-border px-4 py-3 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
      <Icon name="lock-closed-outline" size={18} color={palette.muted} />
      <View className="flex-1">
        <Text className="font-semibold text-ink dark:text-ink-dark">Your notes</Text>
        <Text numberOfLines={2} className="text-muted dark:text-muted-dark">{line}</Text>
      </View>
      <Icon name="chevron-forward" size={18} color={palette.muted} />
    </Pressable>
  );
}
