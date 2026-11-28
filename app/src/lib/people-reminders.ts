/**
 * The Rolodex's reminders, scheduled as local notifications on this phone (owner 2026-11-28): birthdays and other dates at
 * 9 in the morning, and when someone becomes due a catch-up. The server keeps no reminder times or time zone; each
 * time People loads or changes, Circlo's reminders are replaced with the soonest 50 (iOS keeps 64 per app). They
 * follow the phone's notification permission (never asked for here) and can be turned off for this phone in
 * Settings → Notifications. Sign-out cancels them.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance, SchedulableTriggerInputTypes } from 'expo-notifications';
import { Platform } from 'react-native';

import { reminders, type Contact } from './people';
import { getItem, setItem } from './storage';

const CHANNEL = 'people';
const OFF_KEY = 'circlo.people-reminders-off';
const PREFIX = 'kit:';

export async function peopleRemindersOn(): Promise<boolean> {
  return (await getItem(OFF_KEY)) !== '1';
}

export async function setPeopleRemindersOn(on: boolean, people: Contact[]): Promise<void> {
  await setItem(OFF_KEY, on ? '0' : '1');
  await schedulePeopleReminders(people);
}

/** Cancels Circlo's People reminders (sign-out, or turned off). */
export async function cancelPeopleReminders(): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(all.filter((n) => n.identifier.startsWith(PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

/** Replaces the scheduled reminders with these people's. */
export async function schedulePeopleReminders(people: Contact[]): Promise<void> {
  await cancelPeopleReminders();
  if (!(await peopleRemindersOn())) return;
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Birthdays and catch-ups', importance: AndroidImportance.DEFAULT });
  }
  for (const r of reminders(people, new Date())) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: { type: 'people', contactId: r.url.split('/').pop() } },
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: r.date, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
    });
  }
}
